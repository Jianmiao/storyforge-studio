//! 渲染任务：固定步进离线渲染 + FFmpeg 编码；队列、进度、取消与临时文件清理。
//! 不依赖 GUI / 显示器；音频与视频时长严格一致（帧数 = 场景时长，音频按 N/fps 精确裁剪）。

use crate::audio::{load_audios, AudioMixer};
use crate::compositor::{load_images, Compositor};
use crate::encoder::{pcm_temp_path, Encoder, EncoderConfig};
use crate::model::Project;
use crate::timeline;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, thiserror::Error)]
pub enum RenderError {
    #[error("FFmpeg 未找到，无法导出（请在导出设置中指定路径）")]
    FfmpegNotFound,
    #[error("项目中没有场景")]
    NoScene,
    #[error("场景不存在: {0}")]
    NoSuchScene(String),
    #[error("编码错误: {0}")]
    Encoder(#[from] crate::encoder::EncoderError),
    #[error("合成错误: {0}")]
    Compositor(#[from] crate::compositor::CompositorError),
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("渲染已取消")]
    Cancelled,
}

#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpec {
    pub project: Project,
    pub project_dir: String,
    pub scene_id: Option<String>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub codec: String,
    pub crf: u32,
    pub preset: String,
    pub audio_bitrate_kbps: u32,
    pub output_path: String,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RenderJobStatus {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderJobInfo {
    pub id: String,
    pub status: RenderJobStatus,
    pub frame: u64,
    pub total: u64,
    pub eta_sec: Option<f64>,
    pub fps: Option<f64>,
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RenderProgressEvent {
    pub job_id: String,
    pub status: RenderJobStatus,
    pub frame: u64,
    pub total: u64,
    pub eta_sec: Option<f64>,
    pub fps: Option<f64>,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// 渲染执行
// ---------------------------------------------------------------------------

/// 渲染一个项目到 MP4。emit 回调用于进度事件（调用方负责线程安全转发）。
pub fn render_project(
    spec: &RenderSpec,
    job_id: &str,
    ffmpeg: &Path,
    cancel: &AtomicBool,
    emit: &dyn Fn(RenderProgressEvent),
) -> Result<PathBuf, RenderError> {
    if !ffmpeg.is_file() {
        return Err(RenderError::FfmpegNotFound);
    }
    let project = &spec.project;
    let project_dir = Path::new(&spec.project_dir);
    let scene = match &spec.scene_id {
        Some(id) => project.scenes.iter().find(|s| &s.id == id).ok_or_else(|| RenderError::NoSuchScene(id.clone()))?,
        None => project.scenes.first().ok_or(RenderError::NoScene)?,
    };
    let total = scene.duration_frames.max(1) as u64;
    let fps = spec.fps.max(1);
    let width = spec.width.max(2);
    let height = spec.height.max(2);
    let output = PathBuf::from(&spec.output_path);
    let part = crate::encoder::output_part_path(&output, job_id);
    let pcm = pcm_temp_path(&output, job_id);

    let start = Instant::now();

    // ---- 阶段 1：素材加载 + 全量音频混音 ----
    let images = load_images(project, project_dir);
    let audios = load_audios(project, project_dir);
    let mut mixer = AudioMixer::new(audios, fps, total as u32);
    {
        for frame in 0..total {
            if cancel.load(Ordering::Relaxed) {
                cleanup(&part, &pcm);
                return Err(RenderError::Cancelled);
            }
            let desc = timeline::evaluate(project, scene, frame as u32);
            mixer.add_frame(&desc, frame as u32);
        }
        mixer.write_s16le(&pcm)?;
    }

    // ---- 阶段 2：逐帧合成 + 编码 ----
    let mut encoder = Encoder::spawn(&EncoderConfig {
        ffmpeg: ffmpeg.to_path_buf(),
        width,
        height,
        fps,
        crf: spec.crf,
        preset: spec.preset.clone(),
        audio_bitrate_kbps: spec.audio_bitrate_kbps,
        pcm_path: pcm.clone(),
        output_part: part.clone(),
    })?;
    let mut compositor = Compositor::new(width, height, images);
    let mut frame_buf = vec![0_u8; (width * height * 3) as usize];

    for frame in 0..total {
        if cancel.load(Ordering::Relaxed) {
            encoder.kill();
            cleanup(&part, &pcm);
            return Err(RenderError::Cancelled);
        }
        let desc = timeline::evaluate(project, scene, frame as u32);
        compositor.composite(&desc, &mut frame_buf)?;
        encoder.write_frame(&frame_buf)?;
        if frame % 5 == 0 || frame + 1 == total {
            let elapsed = start.elapsed().as_secs_f64().max(1e-6);
            let done = frame + 1;
            let fps_now = done as f64 / elapsed;
            let eta = if done >= total { 0.0 } else { (total - done) as f64 / fps_now };
            emit(RenderProgressEvent {
                job_id: job_id.to_string(),
                status: RenderJobStatus::Running,
                frame: done,
                total,
                eta_sec: Some(eta),
                fps: Some(fps_now),
                error: None,
            });
        }
    }

    encoder.finish()?;
    // 完成：临时产物 → 最终文件
    std::fs::rename(&part, &output)?;
    let _ = std::fs::remove_file(&pcm);
    emit(RenderProgressEvent {
        job_id: job_id.to_string(),
        status: RenderJobStatus::Done,
        frame: total,
        total,
        eta_sec: Some(0.0),
        fps: Some(total as f64 / start.elapsed().as_secs_f64().max(1e-6)),
        error: None,
    });
    Ok(output)
}

fn cleanup(part: &Path, pcm: &Path) {
    let _ = std::fs::remove_file(part);
    let _ = std::fs::remove_file(pcm);
}

// ---------------------------------------------------------------------------
// 任务队列（串行执行，支持排队与取消）
// ---------------------------------------------------------------------------

enum QueueMsg {
    Submit(JobHandle),
    Cancel(String),
}

struct JobHandle {
    id: String,
    spec: RenderSpec,
    ffmpeg: PathBuf,
    cancel: Arc<AtomicBool>,
}

pub struct RenderQueue {
    tx: mpsc::Sender<QueueMsg>,
    jobs: Arc<Mutex<Vec<JobEntry>>>,
    seq: std::sync::atomic::AtomicU64,
}

struct JobEntry {
    id: String,
    status: Mutex<RenderJobStatus>,
    frame: Mutex<u64>,
    total: Mutex<u64>,
    eta_sec: Mutex<Option<f64>>,
    fps: Mutex<Option<f64>>,
    output_path: Mutex<Option<String>>,
    error: Mutex<Option<String>>,
    created_at: String,
    cancel: Arc<AtomicBool>,
}

impl RenderQueue {
    /// emit：进度事件转发（tauri 侧为 AppHandle.emit；CLI 侧为 println）。
    pub fn new(emit: impl Fn(RenderProgressEvent) + Send + Sync + 'static) -> Arc<Self> {
        let (tx, rx) = mpsc::channel::<QueueMsg>();
        let queue = Arc::new(RenderQueue {
            tx,
            jobs: Arc::new(Mutex::new(Vec::new())),
            seq: std::sync::atomic::AtomicU64::new(0),
        });
        let jobs = queue.jobs.clone();
        std::thread::Builder::new()
            .name("storyforge-render-worker".into())
            .spawn(move || {
                while let Ok(msg) = rx.recv() {
                    match msg {
                        QueueMsg::Cancel(id) => {
                            if let Ok(jobs) = jobs.lock() {
                                for j in jobs.iter() {
                                    if j.id == id {
                                        j.cancel.store(true, Ordering::Relaxed);
                                    }
                                }
                            }
                        }
                        QueueMsg::Submit(handle) => {
                            let id = handle.id.clone();
                            let total = handle
                                .spec
                                .project
                                .scenes
                                .iter()
                                .find(|s| Some(&s.id) == handle.spec.scene_id.as_ref())
                                .map(|s| s.duration_frames as u64)
                                .unwrap_or(0);
                            let entry = JobEntry {
                                id: id.clone(),
                                status: Mutex::new(RenderJobStatus::Running),
                                frame: Mutex::new(0),
                                total: Mutex::new(total),
                                eta_sec: Mutex::new(None),
                                fps: Mutex::new(None),
                                output_path: Mutex::new(Some(handle.spec.output_path.clone())),
                                error: Mutex::new(None),
                                created_at: handle.spec.output_path.clone(),
                                cancel: handle.cancel.clone(),
                            };
                            {
                                let mut jobs = jobs.lock().unwrap();
                                jobs.push(entry);
                            }
                            let on_progress = |e: RenderProgressEvent| {
                                if let Ok(jobs) = jobs.lock() {
                                    if let Some(j) = jobs.iter().find(|x| x.id == e.job_id) {
                                        *j.frame.lock().unwrap() = e.frame;
                                        *j.total.lock().unwrap() = e.total;
                                        *j.eta_sec.lock().unwrap() = e.eta_sec;
                                        *j.fps.lock().unwrap() = e.fps;
                                        if let Some(err) = &e.error {
                                            *j.error.lock().unwrap() = Some(err.clone());
                                        }
                                    }
                                }
                                emit(e);
                            };
                            let result = render_project(&handle.spec, &id, &handle.ffmpeg, &handle.cancel, &on_progress);
                            let (status, error, frame) = match result {
                                Ok(_) => (RenderJobStatus::Done, None, total),
                                Err(RenderError::Cancelled) => (RenderJobStatus::Cancelled, None, 0),
                                Err(e) => (RenderJobStatus::Failed, Some(e.to_string()), 0),
                            };
                            if let Ok(jobs) = jobs.lock() {
                                if let Some(j) = jobs.iter().find(|x| x.id == id) {
                                    *j.status.lock().unwrap() = status.clone();
                                    *j.frame.lock().unwrap() = frame;
                                    if let Some(err) = &error {
                                        *j.error.lock().unwrap() = Some(err.clone());
                                    }
                                }
                            }
                            emit(RenderProgressEvent {
                                job_id: id,
                                status,
                                frame,
                                total,
                                eta_sec: Some(0.0),
                                fps: None,
                                error,
                            });
                        }
                    }
                }
            })
            .expect("render worker 启动失败");
        queue
    }

    pub fn submit(&self, spec: RenderSpec, ffmpeg: PathBuf) -> String {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed);
        let id = format!("job_{}_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(), seq);
        let cancel = Arc::new(AtomicBool::new(false));
        // 入队即可见（queued）
        let entry = JobEntry {
            id: id.clone(),
            status: Mutex::new(RenderJobStatus::Queued),
            frame: Mutex::new(0),
            total: Mutex::new(0),
            eta_sec: Mutex::new(None),
            fps: Mutex::new(None),
            output_path: Mutex::new(Some(spec.output_path.clone())),
            error: Mutex::new(None),
            created_at: format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()),
            cancel: cancel.clone(),
        };
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.push(entry);
        }
        let _ = self.tx.send(QueueMsg::Submit(JobHandle { id: id.clone(), spec, ffmpeg, cancel }));
        id
    }

    pub fn cancel(&self, job_id: &str) {
        let _ = self.tx.send(QueueMsg::Cancel(job_id.to_string()));
        if let Ok(jobs) = self.jobs.lock() {
            for j in jobs.iter() {
                if j.id == job_id {
                    let mut st = j.status.lock().unwrap();
                    if *st == RenderJobStatus::Queued {
                        *st = RenderJobStatus::Cancelled;
                    }
                }
            }
        }
    }

    pub fn list(&self) -> Vec<RenderJobInfo> {
        let jobs = self.jobs.lock().unwrap();
        jobs.iter()
            .map(|j| RenderJobInfo {
                id: j.id.clone(),
                status: j.status.lock().unwrap().clone(),
                frame: *j.frame.lock().unwrap(),
                total: *j.total.lock().unwrap(),
                eta_sec: *j.eta_sec.lock().unwrap(),
                fps: *j.fps.lock().unwrap(),
                output_path: j.output_path.lock().unwrap().clone(),
                error: j.error.lock().unwrap().clone(),
                created_at: j.created_at.clone(),
            })
            .collect()
    }
}
