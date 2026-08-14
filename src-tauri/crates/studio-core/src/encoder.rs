//! FFmpeg 进程管理：rawvideo(RGB24) 走 stdin 管道 + s16le PCM 文件双输入 → MP4。
//! 支持取消（kill + 清理临时文件）与失败原因捕获（stderr 尾部）。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};

#[derive(Debug, thiserror::Error)]
pub enum EncoderError {
    #[error("FFmpeg 未找到或不可执行: {0}")]
    Spawn(String),
    #[error("写帧失败: {0}")]
    Write(#[from] std::io::Error),
    #[error("FFmpeg 退出码 {code}: {detail}")]
    Failed { code: i32, detail: String },
    #[error("渲染已取消")]
    Cancelled,
}

pub struct EncoderConfig {
    pub ffmpeg: PathBuf,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub crf: u32,
    pub preset: String,
    pub audio_bitrate_kbps: u32,
    pub pcm_path: PathBuf,
    /// 输出（渲染期间为 .part 临时文件，成功后 rename）。
    pub output_part: PathBuf,
}

pub struct Encoder {
    child: Child,
    stdin: Option<ChildStdin>,
    stderr: Vec<u8>,
}

impl Encoder {
    pub fn spawn(cfg: &EncoderConfig) -> Result<Encoder, EncoderError> {
        let mut cmd = Command::new(&cfg.ffmpeg);
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            &format!("{}x{}", cfg.width, cfg.height),
            "-r",
            &cfg.fps.to_string(),
            "-i",
            "pipe:0",
            "-f",
            "s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-i",
        ])
        .arg(&cfg.pcm_path)
        .args([
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-c:v",
            "libx264",
            "-preset",
            &cfg.preset,
            "-crf",
            &cfg.crf.to_string(),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            &format!("{}k", cfg.audio_bitrate_kbps),
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
        ])
        .arg(&cfg.output_part)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| EncoderError::Spawn(format!("{}: {e}", cfg.ffmpeg.display())))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| EncoderError::Spawn("无法获取 stdin".into()))?;
        Ok(Encoder {
            child,
            stdin: Some(stdin),
            stderr: Vec::new(),
        })
    }

    /// 写入一帧 RGB24。
    pub fn write_frame(&mut self, rgb: &[u8]) -> Result<(), EncoderError> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| EncoderError::Write(std::io::Error::other("stdin 已关闭")))?;
        if let Err(e) = stdin.write_all(rgb) {
            // FFmpeg 可能已退出：附带其 stderr 便于诊断
            let detail = self.read_stderr_tail();
            return Err(EncoderError::Failed {
                code: -1,
                detail: format!("写帧失败: {e}\n{detail}"),
            });
        }
        Ok(())
    }

    /// 结束输入并等待 FFmpeg 退出，校验退出码。
    pub fn finish(mut self) -> Result<(), EncoderError> {
        self.stdin.take();
        let status = self
            .child
            .wait()
            .map_err(|e| EncoderError::Failed { code: -1, detail: e.to_string() })?;
        if !status.success() {
            let code = status.code().unwrap_or(-1);
            let detail = self.read_stderr_tail();
            return Err(EncoderError::Failed { code, detail });
        }
        Ok(())
    }

    /// 取消：强杀 FFmpeg。
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    fn read_stderr_tail(&mut self) -> String {
        if let Some(mut stderr) = self.child.stderr.take() {
            use std::io::Read;
            let mut buf = Vec::new();
            let _ = stderr.read_to_end(&mut buf);
            self.stderr = buf;
        }
        let text = String::from_utf8_lossy(&self.stderr);
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        let tail = lines.iter().rev().take(8).rev().cloned().collect::<Vec<_>>().join("\n");
        if tail.is_empty() {
            "(无 FFmpeg 输出)".to_string()
        } else {
            tail
        }
    }
}

/// 渲染输出的临时文件命名（<out>.part-<jobId>.tmp）。
pub fn output_part_path(output: &Path, job_id: &str) -> PathBuf {
    let mut name = output
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output.mp4".to_string());
    name.push_str(&format!(".part-{job_id}.tmp"));
    output.with_file_name(name)
}

/// 混音临时 PCM 文件（<out>.audio-<jobId>.tmp）。
pub fn pcm_temp_path(output: &Path, job_id: &str) -> PathBuf {
    let mut name = output
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output.mp4".to_string());
    name.push_str(&format!(".audio-{job_id}.tmp"));
    output.with_file_name(name)
}
