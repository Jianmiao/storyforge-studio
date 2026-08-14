//! FFmpeg 检测：手动路径 → PATH → 常见安装目录；UI 明确显示缺失状态。

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub manual_path: Option<String>,
}

pub fn detect_ffmpeg(manual: Option<&str>) -> FfmpegInfo {
    if let Some(m) = manual {
        if !m.trim().is_empty() {
            let p = PathBuf::from(m);
            if let Some(version) = probe(&p) {
                return FfmpegInfo {
                    found: true,
                    path: Some(p.to_string_lossy().to_string()),
                    version: Some(version),
                    manual_path: Some(m.to_string()),
                };
            }
            return FfmpegInfo {
                found: false,
                path: None,
                version: None,
                manual_path: Some(m.to_string()),
            };
        }
    }

    // 环境变量
    if let Ok(env_path) = std::env::var("STORYFORGE_FFMPEG") {
        if !env_path.trim().is_empty() {
            let p = PathBuf::from(&env_path);
            if let Some(version) = probe(&p) {
                return FfmpegInfo {
                    found: true,
                    path: Some(p.to_string_lossy().to_string()),
                    version: Some(version),
                    manual_path: Some(env_path),
                };
            }
        }
    }

    // PATH 搜索
    if let Ok(paths) = std::env::var("PATH") {
        for dir in std::env::split_paths(&paths) {
            let exe = if std::env::consts::OS == "windows" {
                dir.join("ffmpeg.exe")
            } else {
                dir.join("ffmpeg")
            };
            if let Some(version) = probe(&exe) {
                return FfmpegInfo {
                    found: true,
                    path: Some(exe.to_string_lossy().to_string()),
                    version: Some(version),
                    manual_path: None,
                };
            }
        }
    }

    // 常见安装目录
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| home.clone());
    let candidates = [
        PathBuf::from(r"C:\ffmpeg\bin\ffmpeg.exe"),
        PathBuf::from(r"C:\Program Files\ffmpeg\bin\ffmpeg.exe"),
        PathBuf::from(r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe"),
        PathBuf::from(r"D:\ffmpeg\bin\ffmpeg.exe"),
        PathBuf::from(r"E:\ffmpeg\bin\ffmpeg.exe"),
        PathBuf::from(&local).join(r"ffmpeg\bin\ffmpeg.exe"),
        PathBuf::from(&home).join(r"ffmpeg\bin\ffmpeg.exe"),
        PathBuf::from(r"C:\tools\ffmpeg\bin\ffmpeg.exe"),
    ];
    for p in candidates {
        if let Some(version) = probe(&p) {
            return FfmpegInfo {
                found: true,
                path: Some(p.to_string_lossy().to_string()),
                version: Some(version),
                manual_path: None,
            };
        }
    }

    FfmpegInfo {
        found: false,
        path: None,
        version: None,
        manual_path: None,
    }
}

fn probe(exe: &Path) -> Option<String> {
    if !exe.is_file() {
        return None;
    }
    let out = Command::new(exe).arg("-version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next().map(|s| s.trim().to_string()).unwrap_or_default();
    if first.is_empty() {
        None
    } else {
        Some(first)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_invalid_path_reports_not_found() {
        let info = detect_ffmpeg(Some(r"C:\definitely\missing\ffmpeg.exe"));
        assert!(!info.found);
        assert_eq!(info.manual_path.as_deref(), Some(r"C:\definitely\missing\ffmpeg.exe"));
    }
}
