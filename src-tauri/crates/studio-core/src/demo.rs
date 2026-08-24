//! 演示项目生成（v2 节点式剧本）：全部素材在本地程序化合成（渐变背景 / 角色剪影 / 正弦 BGM / 提示音），
//! 不下载、不捆绑任何第三方素材。用于离线渲染验收样例。

use crate::model::{
    AssetKind, AssetRecord, CanvasConfig, CharacterLineRef, ExportConfig, GraphNode, GraphNodeType,
    Meta, Project, ScriptGraph, ScriptLine,
};
use crate::project_io::save_project_atomic;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum DemoError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("项目保存失败: {0}")]
    Save(#[from] crate::project_io::IoError),
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DemoCreateResult {
    pub project_dir: String,
    pub project: Project,
}

const DEMO_FPS: u32 = 30;

fn line(
    id: &str,
    text: &str,
    speaker: &str,
    characters: Vec<CharacterLineRef>,
    bg_asset_id: Option<&str>,
    bg_effect: &str,
    bgm_asset_id: Option<&str>,
    voice_asset_id: Option<&str>,
    sound_asset_id: Option<&str>,
    transition: &str,
    duration_frames: i64,
    place_text: &str,
) -> ScriptLine {
    ScriptLine {
        id: id.into(),
        text: text.into(),
        speaker: speaker.into(),
        club_name: if speaker.is_empty() { String::new() } else { "StoryForge".into() },
        characters,
        bg_asset_id: bg_asset_id.map(|s| s.into()),
        bg_effect: bg_effect.into(),
        bgm_asset_id: bgm_asset_id.map(|s| s.into()),
        voice_asset_id: voice_asset_id.map(|s| s.into()),
        sound_asset_id: sound_asset_id.map(|s| s.into()),
        transition: transition.into(),
        duration_frames,
        place_text: place_text.into(),
    }
}

fn char_ref(asset_id: &str, slot: i64, action: &str) -> CharacterLineRef {
    CharacterLineRef {
        asset_id: asset_id.into(),
        slot,
        action: action.into(),
        scale: 1.0,
        start_slot: None,
        end_slot: None,
        appear: None,
        move_duration_frames: None,
        move_easing: None,
        highlighted: None,
        luminance: None,
        on_top: false,
        closeup: false,
        face_id: None,
        shape_override: None,
    }
}

fn presentation_char_ref(slot: i64, highlighted: bool, scale: f64) -> CharacterLineRef {
    let mut character = char_ref("ast_char", (slot - 1).clamp(0, 2), if slot == 2 || slot == 5 { "sway" } else { "none" });
    character.end_slot = Some(slot);
    character.highlighted = Some(highlighted);
    character.on_top = highlighted;
    character.scale = scale;
    character
}

/// 创建演示项目目录 + 素材 + 项目文件（节点式剧本，默认路径 360 帧 = 12 秒）。
pub fn create_demo(project_dir: &Path) -> Result<DemoCreateResult, DemoError> {
    std::fs::create_dir_all(project_dir.join("assets"))?;

    // 1) 渐变背景 1920x1080
    let bg = gradient_png(1920, 1080, [36, 52, 71], [106, 90, 205], [255, 140, 105]);
    std::fs::write(project_dir.join("assets").join("demo-bg.png"), &bg)?;

    // 2) 角色剪影 480x720（透明背景）
    let char_img = character_png(480, 720);
    std::fs::write(project_dir.join("assets").join("demo-char.png"), &char_img)?;

    // 3) BGM 220Hz 12s 正弦
    let bgm = tone_wav(220.0, 12_000, 0.5);
    std::fs::write(project_dir.join("assets").join("demo-bgm.wav"), &bgm)?;

    // 4) 提示音 880Hz 0.6s
    let sfx = tone_wav(880.0, 600, 0.8);
    std::fs::write(project_dir.join("assets").join("demo-sfx.wav"), &sfx)?;

    let hash = |data: &[u8]| crate::assets::sha256_hex(data);

    let assets = vec![
        AssetRecord {
            id: "ast_bg".into(),
            kind: AssetKind::Image,
            file_name: "demo-bg.png".into(),
            original_path: String::new(),
            hash: hash(&bg),
            width: Some(1920),
            height: Some(1080),
            duration_ms: None,
            missing: None,
        },
        AssetRecord {
            id: "ast_char".into(),
            kind: AssetKind::Image,
            file_name: "demo-char.png".into(),
            original_path: String::new(),
            hash: hash(&char_img),
            width: Some(480),
            height: Some(720),
            duration_ms: None,
            missing: None,
        },
        AssetRecord {
            id: "ast_bgm".into(),
            kind: AssetKind::Audio,
            file_name: "demo-bgm.wav".into(),
            original_path: String::new(),
            hash: hash(&bgm),
            width: None,
            height: None,
            duration_ms: Some(12_000),
            missing: None,
        },
        AssetRecord {
            id: "ast_sfx".into(),
            kind: AssetKind::Audio,
            file_name: "demo-sfx.wav".into(),
            original_path: String::new(),
            hash: hash(&sfx),
            width: None,
            height: None,
            duration_ms: Some(600),
            missing: None,
        },
    ];

    let now = iso_now();
    let project = Project {
        format_version: crate::model::FORMAT_VERSION,
        meta: Meta {
            name: "演示项目".into(),
            created_at: now.clone(),
            updated_at: now,
        },
        canvas: CanvasConfig { width: 1920, height: 1080, fps: DEMO_FPS },
        assets,
        script: demo_graph(),
        scenes: vec![],
        export: ExportConfig {
            width: 1920,
            height: 1080,
            fps: DEMO_FPS,
            video_codec: "h264".into(),
            crf: 18,
            preset: "veryfast".into(),
            audio_bitrate_kbps: 192,
        },
    };

    save_project_atomic(&project_dir.join("project.storyforge"), &project, 3)?;

    Ok(DemoCreateResult {
        project_dir: project_dir.to_string_lossy().to_string(),
        project,
    })
}

fn demo_graph() -> ScriptGraph {
    ScriptGraph {
        entry_node_id: Some("nd_entry".into()),
        nodes: vec![
            GraphNode {
                id: "nd_entry".into(),
                node_type: GraphNodeType::Entry,
                x: 60.0,
                y: 260.0,
                title: "开场".into(),
                header: Some("演示剧本".into()),
                end_text: None,
                lines: None,
                options: None,
                next: vec!["nd_open".into()],
            },
            GraphNode {
                id: "nd_open".into(),
                node_type: GraphNodeType::Script,
                x: 300.0,
                y: 260.0,
                title: "开场演出".into(),
                header: None,
                end_text: None,
                lines: Some(vec![line(
                    "ln_open",
                    "夜色降临，故事开始。",
                    "",
                    vec![char_ref("ast_char", 1, "sway")],
                    Some("ast_bg"),
                    "none",
                    Some("ast_bgm"),
                    None,
                    None,
                    "fade",
                    120,
                    "小镇广场",
                )]),
                options: None,
                next: vec!["nd_dialog".into()],
            },
            GraphNode {
                id: "nd_dialog".into(),
                node_type: GraphNodeType::Script,
                x: 540.0,
                y: 260.0,
                title: "第一段对话".into(),
                header: None,
                end_text: None,
                lines: Some(vec![line(
                    "ln_d1",
                    "欢迎来到 StoryForge，旅人。\n今晚的星光会为你指引方向。\n请准备好，故事现在开始。",
                    "领航员",
                    vec![
                        presentation_char_ref(1, false, 0.78),
                        presentation_char_ref(2, false, 0.82),
                        presentation_char_ref(3, true, 0.9),
                        presentation_char_ref(4, false, 0.86),
                        presentation_char_ref(5, false, 0.82),
                    ],
                    None,
                    "none",
                    None,
                    None,
                    None,
                    "none",
                    120,
                    "",
                )]),
                options: None,
                next: vec!["nd_choice".into()],
            },
            GraphNode {
                id: "nd_choice".into(),
                node_type: GraphNodeType::Selection,
                x: 780.0,
                y: 260.0,
                title: "选择".into(),
                header: None,
                end_text: None,
                lines: None,
                options: Some(vec!["进入支线剧情".into(), "直接结束".into()]),
                next: vec!["nd_branchA".into(), "nd_branchB".into()],
            },
            GraphNode {
                id: "nd_branchA".into(),
                node_type: GraphNodeType::Script,
                x: 1020.0,
                y: 160.0,
                title: "支线剧情".into(),
                header: None,
                end_text: None,
                lines: Some(vec![line(
                    "ln_a1",
                    "你选择了支线——一道闪光划过夜空。",
                    "领航员",
                    vec![char_ref("ast_char", 1, "flashWhite")],
                    None,
                    "blur",
                    None,
                    None,
                    Some("ast_sfx"),
                    "fade",
                    120,
                    "广场·夜晚",
                )]),
                options: None,
                next: vec!["nd_exit".into()],
            },
            GraphNode {
                id: "nd_branchB".into(),
                node_type: GraphNodeType::Script,
                x: 1020.0,
                y: 380.0,
                title: "直接结束".into(),
                header: None,
                end_text: None,
                lines: Some(vec![line(
                    "ln_b1",
                    "你选择了直接结束。故事留待来日。",
                    "领航员",
                    vec![char_ref("ast_char", 1, "sway")],
                    None,
                    "none",
                    None,
                    None,
                    None,
                    "fade",
                    120,
                    "",
                )]),
                options: None,
                next: vec!["nd_exit".into()],
            },
            GraphNode {
                id: "nd_exit".into(),
                node_type: GraphNodeType::Exit,
                x: 1260.0,
                y: 260.0,
                title: "结束".into(),
                header: None,
                end_text: Some("全剧终".into()),
                lines: None,
                options: None,
                next: vec![],
            },
        ],
    }
}

/// 三色线性渐变 PNG（本地合成）。
fn gradient_png(w: u32, h: u32, c1: [u8; 3], c2: [u8; 3], c3: [u8; 3]) -> Vec<u8> {
    let mut img = image::RgbaImage::new(w, h);
    for (x, y, px) in img.enumerate_pixels_mut() {
        let t = (x + y) as f32 / (w + h) as f32;
        let (r, g, b) = if t < 0.5 {
            let u = t / 0.5;
            lerp3(c1, c2, u)
        } else {
            let u = (t - 0.5) / 0.5;
            lerp3(c2, c3, u)
        };
        *px = image::Rgba([r, g, b, 255]);
    }
    encode_png(&img)
}

fn lerp3(a: [u8; 3], b: [u8; 3], u: f32) -> (u8, u8, u8) {
    (
        (a[0] as f32 + (b[0] as f32 - a[0] as f32) * u).round() as u8,
        (a[1] as f32 + (b[1] as f32 - a[1] as f32) * u).round() as u8,
        (a[2] as f32 + (b[2] as f32 - a[2] as f32) * u).round() as u8,
    )
}

/// 简单角色剪影 PNG（占位美术，非任何第三方素材）。
fn character_png(w: u32, h: u32) -> Vec<u8> {
    let mut img = image::RgbaImage::new(w, h);
    let cx = w as f32 / 2.0;
    let head_r = w as f32 * 0.18;
    let head_cy = h as f32 * 0.3;
    let body = [(0.28 * w as f32, 0.44 * h as f32, 0.44 * w as f32, 0.5 * h as f32)];
    let arms = [
        (0.12 * w as f32, 0.5 * h as f32, 0.18 * w as f32, 0.42 * h as f32),
        (0.70 * w as f32, 0.5 * h as f32, 0.18 * w as f32, 0.42 * h as f32),
    ];
    for (x, y, px) in img.enumerate_pixels_mut() {
        let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
        let d_head = ((fx - cx).powi(2) + (fy - head_cy).powi(2)).sqrt();
        let in_body = body.iter().any(|(bx, by, bw, bh)| {
            fx >= *bx && fx <= bx + bw && fy >= *by && fy <= by + bh
        });
        let in_arm = arms.iter().any(|(bx, by, bw, bh)| {
            fx >= *bx && fx <= bx + bw && fy >= *by && fy <= by + bh
        });
        if d_head <= head_r {
            *px = image::Rgba([142, 202, 230, 255]);
        } else if in_body {
            *px = image::Rgba([33, 158, 188, 255]);
        } else if in_arm {
            *px = image::Rgba([2, 48, 71, 255]);
        } else {
            *px = image::Rgba([0, 0, 0, 0]);
        }
    }
    encode_png(&img)
}

fn encode_png(img: &image::RgbaImage) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    image::write_buffer_with_format(
        &mut buf,
        img.as_raw(),
        img.width(),
        img.height(),
        image::ExtendedColorType::Rgba8,
        image::ImageFormat::Png,
    )
    .expect("PNG 编码失败");
    buf.into_inner()
}

/// 16bit PCM 正弦 WAV（本地合成）。
fn tone_wav(freq: f32, duration_ms: u64, volume: f32) -> Vec<u8> {
    let sample_rate = 44_100_u32;
    let n = ((sample_rate as u64 * duration_ms) / 1000) as usize;
    let mut data = Vec::with_capacity(n * 2);
    for i in 0..n {
        let t = i as f32 / sample_rate as f32;
        let v = (2.0 * std::f32::consts::PI * freq * t).sin() * 0.7
            + (2.0 * std::f32::consts::PI * freq * 2.0 * t).sin() * 0.3;
        let s = (v * volume * 0.9 * 32767.0).round() as i16;
        data.extend_from_slice(&s.to_le_bytes());
    }
    let mut out = Vec::with_capacity(44 + data.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((36 + data.len()) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16_u32.to_le_bytes());
    out.extend_from_slice(&1_u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1_u16.to_le_bytes()); // mono
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    out.extend_from_slice(&2_u16.to_le_bytes());
    out.extend_from_slice(&16_u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = secs / 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    let hms = secs % 86_400;
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", hms / 3600, (hms % 3600) / 60, hms % 60)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
