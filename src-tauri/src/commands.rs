//! Tauri 命令层：把 studio-core 能力暴露给前端 IPC。
//! 全部长任务（渲染）在 worker 线程执行，不阻塞主线程。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use studio_core::assets::{self, AssetStatus, ImportResult};
use studio_core::demo::{self, DemoCreateResult};
use studio_core::ffmpeg::{self, FfmpegInfo};
use studio_core::model::Project;
use studio_core::project_io::{self, OpenResult, SaveResult};
use studio_core::render::{RenderJobInfo, RenderProgressEvent, RenderQueue, RenderSpec};
use studio_core::timeline::SceneDescriptor;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub struct AppState {
    pub queue: Mutex<Option<std::sync::Arc<RenderQueue>>>,
    pub ffmpeg_cache: Mutex<Option<FfmpegInfo>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            queue: Mutex::new(None),
            ffmpeg_cache: Mutex::new(None),
        }
    }
}

fn queue<R: Runtime>(state: &State<'_, AppState>, app: &AppHandle<R>) -> std::sync::Arc<RenderQueue> {
    let mut guard = state.queue.lock().unwrap();
    if guard.is_none() {
        let app = app.clone();
        let q = RenderQueue::new(move |e: RenderProgressEvent| {
            let _ = app.emit("render-progress", e);
        });
        *guard = Some(q);
    }
    guard.as_ref().unwrap().clone()
}

#[tauri::command]
pub fn ffmpeg_detect(manual_path: Option<String>, state: State<'_, AppState>) -> FfmpegInfo {
    let info = ffmpeg::detect_ffmpeg(manual_path.as_deref());
    *state.ffmpeg_cache.lock().unwrap() = Some(info.clone());
    info
}

#[tauri::command]
pub fn project_save(path: String, doc: Project) -> Result<SaveResult, String> {
    project_io::save_project_atomic(Path::new(&path), &doc, 3).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn project_open(path: String) -> Result<OpenResult, String> {
    project_io::open_project(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn demo_create<R: Runtime>(dir: Option<String>, app: AppHandle<R>) -> Result<DemoCreateResult, String> {
    let base = match dir.filter(|d| !d.is_empty() && !d.starts_with("mock://")) {
        Some(d) => PathBuf::from(d),
        None => app
            .path()
            .app_data_dir()
            .map(|p| p.join("demo-projects"))
            .unwrap_or_else(|_| std::env::temp_dir().join("storyforge-demo")),
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let dir = base.join(format!("demo-{ts}"));
    demo::create_demo(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn assets_import(project_dir: String, sources: Vec<String>) -> Result<ImportResult, String> {
    assets::import_assets(Path::new(&project_dir), &sources).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn assets_relocate(
    project_dir: String,
    asset_id: String,
    new_path: String,
) -> Result<studio_core::model::AssetRecord, String> {
    assets::relocate_asset(Path::new(&project_dir), &asset_id, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn assets_check(project_dir: String, project: Project) -> Result<Vec<AssetStatus>, String> {
    Ok(assets::check_assets(Path::new(&project_dir), &project))
}

#[tauri::command]
pub fn preview_frame(
    project: Project,
    path: Vec<String>,
    frame: u32,
) -> Result<SceneDescriptor, String> {
    // 剧本图优先（v2）；无剧本图回退时间轴（v1 迁移项目）
    if project.script.entry_node_id.is_some() && !project.script.nodes.is_empty() {
        let path = if path.is_empty() {
            studio_core::graph::linearize_default_path(&project.script)
        } else {
            path
        };
        return Ok(studio_core::graph::evaluate(&project, &path, frame));
    }
    let scene = project
        .scenes
        .first()
        .ok_or_else(|| "项目既无剧本图也无场景".to_string())?
        .clone();
    Ok(studio_core::timeline::evaluate(&project, &scene, frame))
}

#[tauri::command]
pub fn render_start<R: Runtime>(
    spec: RenderSpec,
    state: State<'_, AppState>,
    app: AppHandle<R>,
) -> Result<String, String> {
    // 解析 FFmpeg 路径（优先缓存检测结果）
    let ffmpeg_path = {
        let cached = state.ffmpeg_cache.lock().unwrap().clone();
        match cached {
            Some(info) if info.found => info.path.map(PathBuf::from),
            _ => ffmpeg::detect_ffmpeg(None)
                .found
                .then(|| ffmpeg::detect_ffmpeg(None).path)
                .flatten()
                .map(PathBuf::from),
        }
    }
    .ok_or_else(|| "FFmpeg 未找到，无法导出（请在导出设置中指定路径）".to_string())?;
    let q = queue(&state, &app);
    let id = q.submit(spec, ffmpeg_path);
    Ok(id)
}

#[tauri::command]
pub fn render_cancel<R: Runtime>(
    job_id: String,
    state: State<'_, AppState>,
    app: AppHandle<R>,
) -> Result<(), String> {
    let q = queue(&state, &app);
    q.cancel(&job_id);
    Ok(())
}

#[tauri::command]
pub fn render_list<R: Runtime>(
    state: State<'_, AppState>,
    app: AppHandle<R>,
) -> Result<Vec<RenderJobInfo>, String> {
    let q = queue(&state, &app);
    Ok(q.list())
}
