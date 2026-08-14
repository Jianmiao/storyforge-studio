//! 素材管理：导入（复制 + SHA-256 + 元数据）、缺失检测、重新定位。

use crate::model::{AssetKind, AssetRecord, Project};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum AssetError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("不支持的文件类型: {0}")]
    UnsupportedType(String),
    #[error("图像解析失败: {0}")]
    Image(String),
    #[error("音频解析失败: {0}")]
    Audio(String),
    #[error("找不到素材: {0}")]
    NotFound(String),
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub assets: Vec<AssetRecord>,
    pub failed: Vec<String>,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssetStatus {
    pub asset_id: String,
    pub missing: bool,
}

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];
const AUDIO_EXTS: &[&str] = &["wav", "mp3", "ogg", "flac", "m4a", "aac", "wma"];

fn ext_of(path: &Path) -> Option<String> {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
}

fn kind_of(ext: &str) -> Option<AssetKind> {
    if IMAGE_EXTS.contains(&ext) {
        Some(AssetKind::Image)
    } else if AUDIO_EXTS.contains(&ext) {
        Some(AssetKind::Audio)
    } else {
        None
    }
}

pub fn assets_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("assets")
}

fn random_id() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
    (0..8).map(|_| chars[rng.gen_range(0..chars.len())]).collect()
}

/// 导入素材：复制进项目 assets/ 目录（文件名 = hash 前 16 位），提取元数据。
pub fn import_assets(project_dir: &Path, sources: &[String]) -> Result<ImportResult, AssetError> {
    let dir = assets_dir(project_dir);
    std::fs::create_dir_all(&dir)?;
    let mut assets = Vec::new();
    let mut failed = Vec::new();

    for src in sources {
        match import_one(project_dir, src) {
            Ok(asset) => assets.push(asset),
            Err(e) => failed.push(format!("{src}: {e}")),
        }
    }
    Ok(ImportResult { assets, failed })
}

fn import_one(project_dir: &Path, src: &str) -> Result<AssetRecord, AssetError> {
    let src_path = Path::new(src);
    let ext = ext_of(src_path).ok_or_else(|| AssetError::UnsupportedType(src.to_string()))?;
    let kind = kind_of(&ext).ok_or_else(|| AssetError::UnsupportedType(ext.clone()))?;
    let data = std::fs::read(src_path)?;
    let hash = sha256_hex(&data);
    let short = &hash[..16];
    let dest_name = format!("{short}.{ext}");
    let dest = assets_dir(project_dir).join(&dest_name);
    if !dest.exists() {
        std::fs::write(&dest, &data)?;
    }

    let mut record = AssetRecord {
        id: format!("ast_{}", random_id()),
        kind,
        file_name: dest_name,
        original_path: src.to_string(),
        hash,
        width: None,
        height: None,
        duration_ms: None,
        missing: None,
    };
    match record.kind {
        AssetKind::Image => {
            let img = image::load_from_memory(&data).map_err(|e| AssetError::Image(e.to_string()))?;
            record.width = Some(img.width());
            record.height = Some(img.height());
        }
        AssetKind::Audio => {
            record.duration_ms = Some(
                crate::audio::decode_audio_file(&dest)
                    .map(|a| a.duration_ms)
                    .map_err(|e| AssetError::Audio(e.to_string()))?,
            );
        }
    }
    Ok(record)
}

/// 缺失检测：assets/<fileName> 不存在 → missing。
pub fn check_assets(project_dir: &Path, project: &Project) -> Vec<AssetStatus> {
    project
        .assets
        .iter()
        .map(|a| AssetStatus {
            asset_id: a.id.clone(),
            missing: !assets_dir(project_dir).join(&a.file_name).exists(),
        })
        .collect()
}

/// 重新定位素材：复制新文件到 assets/，更新记录（hash / 文件名 / 原始路径 / 元数据）。
pub fn relocate_asset(project_dir: &Path, asset_id: &str, new_path: &str) -> Result<AssetRecord, AssetError> {
    let new_src = Path::new(new_path);
    let ext = ext_of(new_src).ok_or_else(|| AssetError::UnsupportedType(new_path.to_string()))?;
    let data = std::fs::read(new_src)?;
    let hash = sha256_hex(&data);
    let dest_name = format!("{}.{ext}", &hash[..16]);
    let dest = assets_dir(project_dir).join(&dest_name);
    if !dest.exists() {
        std::fs::write(&dest, &data)?;
    }
    let mut record = AssetRecord {
        id: asset_id.to_string(),
        kind: kind_of(&ext).ok_or_else(|| AssetError::UnsupportedType(ext.clone()))?,
        file_name: dest_name,
        original_path: new_path.to_string(),
        hash,
        width: None,
        height: None,
        duration_ms: None,
        missing: Some(false),
    };
    match record.kind {
        AssetKind::Image => {
            let img = image::load_from_memory(&data).map_err(|e| AssetError::Image(e.to_string()))?;
            record.width = Some(img.width());
            record.height = Some(img.height());
        }
        AssetKind::Audio => {
            record.duration_ms = Some(
                crate::audio::decode_audio_file(&dest)
                    .map(|a| a.duration_ms)
                    .map_err(|e| AssetError::Audio(e.to_string()))?,
            );
        }
    }
    Ok(record)
}

pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_vector() {
        // 空字符串的 SHA-256
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn unsupported_extension_rejected() {
        let dir = std::env::temp_dir().join(format!("sf-asset-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bad = dir.join("evil.exe");
        std::fs::write(&bad, b"MZ").unwrap();
        let result = import_assets(&dir, &[bad.to_string_lossy().to_string()]).unwrap();
        assert!(result.assets.is_empty());
        assert_eq!(result.failed.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
