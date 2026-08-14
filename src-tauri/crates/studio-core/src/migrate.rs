//! 项目迁移链（与前端 src/domain/migrate.ts 同语义，各自测试）。
//! 当前：v0（历史夹具）→ v1。

use serde_json::{json, Value};

pub fn migrate_project(raw: &Value) -> Result<Value, String> {
    // v0 历史夹具无 formatVersion 字段：按 v0 处理
    let version = raw
        .get("formatVersion")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let current = crate::model::FORMAT_VERSION as u64;
    if version > current {
        return Err(format!("项目格式 v{version} 高于当前支持的 v{current}，请升级应用"));
    }
    let mut doc = raw.clone();
    let mut v = version;
    while v < current {
        match v {
            0 => {
                doc = migrate_v0_to_v1(doc)?;
                v = 1;
            }
            _ => return Err(format!("缺少从 v{v} 的迁移")),
        }
    }
    Ok(doc)
}

/// v0 → v1：补 formatVersion；assets[].fileName 去掉 assets/ 前缀；image clip 扁平字段 → props。
fn migrate_v0_to_v1(mut doc: Value) -> Result<Value, String> {
    doc["formatVersion"] = json!(1);
    if let Some(assets) = doc.get_mut("assets").and_then(|a| a.as_array_mut()) {
        for asset in assets {
            if let Some(name) = asset.get("fileName").and_then(|v| v.as_str()) {
                let stripped = name
                    .strip_prefix("assets/")
                    .or_else(|| name.strip_prefix("assets\\"))
                    .unwrap_or(name);
                asset["fileName"] = json!(stripped);
            }
        }
    }
    if let Some(scenes) = doc.get_mut("scenes").and_then(|s| s.as_array_mut()) {
        for scene in scenes {
            if let Some(tracks) = scene.get_mut("tracks").and_then(|t| t.as_array_mut()) {
                for track in tracks {
                    if let Some(clips) = track.get_mut("clips").and_then(|c| c.as_array_mut()) {
                        for clip in clips {
                            if clip.get("type").and_then(|t| t.as_str()) != Some("image") {
                                continue;
                            }
                            let transform = clip.get("transform").cloned().unwrap_or_else(|| json!({}));
                            let position = transform
                                .get("position")
                                .and_then(|v| v.as_array())
                                .map(|a| {
                                    (
                                        a.first().and_then(|x| x.as_f64()).unwrap_or(0.0),
                                        a.get(1).and_then(|x| x.as_f64()).unwrap_or(0.0),
                                    )
                                })
                                .unwrap_or((0.0, 0.0));
                            let scale = transform
                                .get("scale")
                                .and_then(|v| v.as_array())
                                .map(|a| {
                                    (
                                        a.first().and_then(|x| x.as_f64()).unwrap_or(1.0),
                                        a.get(1).and_then(|x| x.as_f64()).unwrap_or(1.0),
                                    )
                                })
                                .unwrap_or((1.0, 1.0));
                            let opacity = clip.get("opacity").and_then(|v| v.as_f64()).unwrap_or(1.0);
                            clip["props"] = json!({
                                "x": position.0,
                                "y": position.1,
                                "scaleX": scale.0,
                                "scaleY": scale.1,
                                "rotation": 0.0,
                                "opacity": opacity,
                                "tint": [255, 255, 255],
                                "blur": 0.0,
                                "crop": { "left": 0.0, "right": 0.0, "top": 0.0, "bottom": 0.0 },
                                "flipX": false
                            });
                            clip["actions"] = json!({ "enter": "none", "idle": "none", "exit": "none" });
                            let _ = clip.as_object_mut().map(|obj| {
                                obj.remove("transform");
                                obj.remove("opacity");
                            });
                        }
                    }
                }
            }
        }
    }
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v0_fixture() -> Value {
        json!({
            "meta": { "name": "旧项目" },
            "canvas": { "width": 1920, "height": 1080, "fps": 30 },
            "assets": [
                { "id": "ast_1", "kind": "image", "fileName": "assets/old.png", "hash": "abc", "width": 100, "height": 100 }
            ],
            "scenes": [
                {
                    "id": "scn_1", "name": "S", "durationFrames": 300,
                    "tracks": [
                        {
                            "id": "trk_1", "kind": "character", "name": "角色", "muted": false,
                            "clips": [
                                {
                                    "id": "clp_1", "type": "image", "name": "c", "assetId": "ast_1",
                                    "start": 0, "duration": 100, "keyframes": [],
                                    "transform": { "position": [100, 200], "scale": [2, 3] },
                                    "opacity": 0.5
                                }
                            ]
                        }
                    ]
                }
            ]
        })
    }

    #[test]
    fn v0_migrates_to_v1() {
        let doc = migrate_project(&v0_fixture()).unwrap();
        assert_eq!(doc["formatVersion"], 1);
        assert_eq!(doc["assets"][0]["fileName"], "old.png");
        let clip = &doc["scenes"][0]["tracks"][0]["clips"][0];
        assert_eq!(clip["props"]["x"], 100.0);
        assert_eq!(clip["props"]["scaleX"], 2.0);
        assert_eq!(clip["props"]["opacity"], 0.5);
        assert!(clip.get("transform").is_none());
        assert_eq!(clip["actions"]["enter"], "none");
    }

    #[test]
    fn newer_version_rejected() {
        let doc = json!({ "formatVersion": 99 });
        assert!(migrate_project(&doc).is_err());
    }

    #[test]
    fn current_version_passthrough() {
        let doc = json!({ "formatVersion": 1, "scenes": [] });
        let out = migrate_project(&doc).unwrap();
        assert_eq!(out["formatVersion"], 1);
    }
}
