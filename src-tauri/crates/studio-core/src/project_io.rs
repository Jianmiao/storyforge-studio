//! 项目持久化：原子写入（tmp + fsync + rename）、轮换备份（bak1..3）、崩溃恢复、残留清理。

use crate::model::Project;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum IoError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),
    #[error("项目格式不受支持: {0}")]
    Format(String),
    #[error("项目文件损坏且无可用备份: {0}")]
    Corrupt(String),
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub path: String,
    pub backups: Vec<String>,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub project: Project,
    pub project_path: String,
    pub recovered_from: Option<String>,
    pub warnings: Vec<String>,
}

/// 原子保存：写 <path>.tmp-<pid> → fsync → rename（同卷原子替换）；保存前轮换备份。
pub fn save_project_atomic(path: &Path, project: &Project, keep_backups: usize) -> Result<SaveResult, IoError> {
    let json = serde_json::to_string_pretty(project)?;
    let backups = rotate_backups(path, keep_backups)?;

    let tmp = tmp_path_for(path);
    {
        let mut f = std::fs::File::create(&tmp)?;
        std::io::Write::write_all(&mut f, json.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(SaveResult {
        path: path.to_string_lossy().to_string(),
        backups,
    })
}

/// 备份轮换：copy(path → bak1)，旧 bak1 → bak2 → bak3。
fn rotate_backups(path: &Path, keep: usize) -> Result<Vec<String>, IoError> {
    let mut backups = Vec::new();
    if keep == 0 || !path.exists() {
        return Ok(backups);
    }
    for i in (1..keep).rev() {
        let src = backup_path(path, i);
        let dst = backup_path(path, i + 1);
        if src.exists() {
            let _ = std::fs::remove_file(&dst);
            std::fs::rename(&src, &dst)?;
            backups.push(dst.to_string_lossy().to_string());
        }
    }
    let bak1 = backup_path(path, 1);
    std::fs::copy(path, &bak1)?;
    backups.push(bak1.to_string_lossy().to_string());
    Ok(backups)
}

pub fn backup_path(path: &Path, i: usize) -> PathBuf {
    PathBuf::from(format!("{}.bak{}", path.to_string_lossy(), i))
}

fn tmp_path_for(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.tmp-{}", path.to_string_lossy(), std::process::id()))
}

/// 打开项目：解析主文件；损坏时依次尝试 bak1..3；清理残留 tmp。
pub fn open_project(path: &Path) -> Result<OpenResult, IoError> {
    cleanup_stale_tmp(path)?;
    let raw = std::fs::read(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            IoError::Corrupt(format!("项目文件不存在: {}", path.display()))
        } else {
            IoError::Io(e)
        }
    })?;
    let text = String::from_utf8_lossy(&raw);
    match parse_and_migrate(&text) {
        Ok(project) => Ok(OpenResult {
            project,
            project_path: path.to_string_lossy().to_string(),
            recovered_from: None,
            warnings: Vec::new(),
        }),
        Err(first_err) => {
            // 主文件损坏 → 备份恢复
            for i in 1..=3 {
                let bak = backup_path(path, i);
                if let Ok(raw) = std::fs::read(&bak) {
                    let text = String::from_utf8_lossy(&raw);
                    if let Ok(project) = parse_and_migrate(&text) {
                        return Ok(OpenResult {
                            project,
                            project_path: path.to_string_lossy().to_string(),
                            recovered_from: Some(bak.to_string_lossy().to_string()),
                            warnings: vec![format!("主文件损坏，已从备份恢复: {}", bak.display())],
                        });
                    }
                }
            }
            Err(IoError::Corrupt(format!("{}；主解析错误: {first_err}", path.display())))
        }
    }
}

fn parse_and_migrate(text: &str) -> Result<Project, IoError> {
    let value: serde_json::Value = serde_json::from_str(text)?;
    let migrated = crate::migrate::migrate_project(&value).map_err(IoError::Format)?;
    let project: Project = serde_json::from_value(migrated)?;
    Ok(project)
}

/// 清理上次崩溃残留的 <path>.tmp-* 文件。
pub fn cleanup_stale_tmp(path: &Path) -> Result<usize, IoError> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let prefix = format!("{}.tmp-", path.to_string_lossy());
    let mut removed = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) {
                let _ = std::fs::remove_file(entry.path());
                removed += 1;
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CanvasConfig, Meta, Project};

    fn test_project(name: &str) -> Project {
        Project {
            format_version: 1,
            meta: Meta {
                name: name.into(),
                created_at: "2026-01-01T00:00:00Z".into(),
                updated_at: "2026-01-01T00:00:00Z".into(),
            },
            canvas: CanvasConfig { width: 1920, height: 1080, fps: 30 },
            assets: vec![],
            script: crate::model::ScriptGraph { nodes: vec![], entry_node_id: None },
            scenes: vec![],
            export: crate::model::ExportConfig {
                width: 1920,
                height: 1080,
                fps: 30,
                video_codec: "h264".into(),
                crf: 18,
                preset: "veryfast".into(),
                audio_bitrate_kbps: 192,
            },
        }
    }

    #[test]
    fn atomic_save_roundtrip() {
        let dir = std::env::temp_dir().join(format!("sf-io-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("project.storyforge");
        let result = save_project_atomic(&path, &test_project("p1"), 3).unwrap();
        assert!(path.exists());
        assert_eq!(result.backups.len(), 0); // 首次保存无备份
        let opened = open_project(&path).unwrap();
        assert_eq!(opened.project.meta.name, "p1");
        assert!(opened.recovered_from.is_none());

        // 第二次保存产生备份
        save_project_atomic(&path, &test_project("p2"), 3).unwrap();
        assert!(backup_path(&path, 1).exists());
        let opened = open_project(&path).unwrap();
        assert_eq!(opened.project.meta.name, "p2");

        // 第三次保存轮换
        save_project_atomic(&path, &test_project("p3"), 3).unwrap();
        assert!(backup_path(&path, 2).exists());

        // 无 tmp 残留
        cleanup_stale_tmp(&path).unwrap();
        assert!(!tmp_path_for(&path).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_main_file_recovers_from_backup() {
        let dir = std::env::temp_dir().join(format!("sf-io-test2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("project.storyforge");
        // 保存两次：第二次保存会生成 bak1（第一次的内容）
        save_project_atomic(&path, &test_project("good"), 3).unwrap();
        save_project_atomic(&path, &test_project("good2"), 3).unwrap();
        assert!(backup_path(&path, 1).exists());
        // 损坏主文件
        std::fs::write(&path, "{ not json !!!").unwrap();
        let opened = open_project(&path).unwrap();
        assert_eq!(opened.project.meta.name, "good");
        assert!(opened.recovered_from.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_file_is_corrupt_error() {
        let dir = std::env::temp_dir().join(format!("sf-io-test3-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("nope.storyforge");
        let err = open_project(&path).unwrap_err();
        assert!(matches!(err, IoError::Corrupt(_)));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
