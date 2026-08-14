//! 演示项目生成：全部素材在本地程序化合成（渐变背景 / 角色剪影 / 正弦 BGM / 提示音），
//! 不下载、不捆绑任何第三方素材。用于离线渲染验收样例。

use crate::model::{
    ActionType, Actions, AssetKind, AssetRecord, AudioClip, CameraClip, CameraProps, CanvasConfig,
    Clip, CropRect, EffectClip, EffectSpec, EffectType, Easing, ExportConfig, ImageClip, KeyValue,
    Keyframe, Meta, Project, Scene, SubtitleClip, Track, TrackKind, VisualProps,
};
use crate::project_io::save_project_atomic;
use std::collections::HashMap;
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
const DEMO_FRAMES: u32 = 360; // 12 秒

/// 创建演示项目目录 + 素材 + 项目文件。
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
        scenes: vec![demo_scene()],
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

fn kf(frame: i64, path: &str, value: f64) -> Keyframe {
    Keyframe {
        frame,
        path: path.into(),
        value: KeyValue::Number(value),
        easing: Easing {
            easing_type: "linear".into(),
            c1: None,
            c2: None,
        },
    }
}

fn demo_scene() -> Scene {
    let frames = DEMO_FRAMES as i64;
    let defaults = || VisualProps {
        x: 960.0,
        y: 540.0,
        scale_x: 1.0,
        scale_y: 1.0,
        rotation: 0.0,
        opacity: 1.0,
        tint: [255, 255, 255],
        blur: 0.0,
        crop: CropRect { left: 0.0, right: 0.0, top: 0.0, bottom: 0.0 },
        flip_x: false,
    };

    Scene {
        id: "scn_demo".into(),
        name: "演示场景".into(),
        duration_frames: DEMO_FRAMES,
        tracks: vec![
            Track {
                id: "trk_background".into(),
                kind: TrackKind::Background,
                name: "背景".into(),
                muted: false,
                clips: vec![Clip::Image(ImageClip {
                    id: "clp_bg".into(),
                    name: "渐变背景".into(),
                    start: 0,
                    duration: frames,
                    keyframes: vec![
                        kf(0, "props.opacity", 0.0),
                        kf(30, "props.opacity", 1.0),
                        kf(330, "props.opacity", 1.0),
                        kf(frames, "props.opacity", 0.0),
                    ],
                    asset_id: "ast_bg".into(),
                    props: defaults(),
                    actions: Actions { enter: ActionType::None, idle: ActionType::None, exit: ActionType::None },
                })],
            },
            Track {
                id: "trk_character".into(),
                kind: TrackKind::Character,
                name: "角色".into(),
                muted: false,
                clips: vec![Clip::Image(ImageClip {
                    id: "clp_char".into(),
                    name: "角色立绘".into(),
                    start: 0,
                    duration: frames,
                    keyframes: vec![
                        kf(0, "props.x", 300.0),
                        kf(30, "props.x", 960.0),
                        kf(0, "props.opacity", 0.0),
                        kf(30, "props.opacity", 1.0),
                        kf(150, "props.scaleX", 1.1),
                        kf(165, "props.scaleX", 1.2),
                        kf(180, "props.scaleX", 1.1),
                        kf(150, "props.scaleY", 1.1),
                        kf(165, "props.scaleY", 1.2),
                        kf(180, "props.scaleY", 1.1),
                        kf(330, "props.x", 960.0),
                        kf(frames, "props.x", 1620.0),
                        kf(330, "props.opacity", 1.0),
                        kf(frames, "props.opacity", 0.0),
                    ],
                    asset_id: "ast_char".into(),
                    props: VisualProps {
                        x: 960.0,
                        y: 540.0,
                        scale_x: 1.1,
                        scale_y: 1.1,
                        rotation: 0.0,
                        opacity: 1.0,
                        tint: [255, 255, 255],
                        blur: 0.0,
                        crop: CropRect { left: 0.0, right: 0.0, top: 0.0, bottom: 0.0 },
                        flip_x: false,
                    },
                    actions: Actions { enter: ActionType::None, idle: ActionType::Sway, exit: ActionType::None },
                })],
            },
            Track {
                id: "trk_camera".into(),
                kind: TrackKind::Camera,
                name: "镜头".into(),
                muted: false,
                clips: vec![Clip::Camera(CameraClip {
                    id: "clp_cam".into(),
                    name: "镜头推近".into(),
                    start: 0,
                    duration: frames,
                    keyframes: vec![
                        kf(0, "zoom", 1.0),
                        kf(frames, "zoom", 1.06),
                        kf(0, "props.x", 0.0),
                        kf(frames, "props.x", 30.0),
                    ],
                    props: CameraProps { x: 0.0, y: 0.0, zoom: 1.0 },
                })],
            },
            Track {
                id: "trk_subtitle".into(),
                kind: TrackKind::Subtitle,
                name: "字幕".into(),
                muted: false,
                clips: vec![
                    Clip::Subtitle(SubtitleClip {
                        id: "clp_sub1".into(),
                        name: "台词 1".into(),
                        start: 60,
                        duration: 120,
                        keyframes: vec![],
                        text: "第一段台词：欢迎来到 StoryForge。".into(),
                        x: 960.0,
                        y: 940.0,
                        font_size: 56.0,
                        color: "#ffffff".into(),
                        align: "center".into(),
                        outline_width: 4.0,
                        opacity: 1.0,
                    }),
                    Clip::Subtitle(SubtitleClip {
                        id: "clp_sub2".into(),
                        name: "台词 2".into(),
                        start: 180,
                        duration: 120,
                        keyframes: vec![],
                        text: "第二段台词：离线渲染验收样例。".into(),
                        x: 960.0,
                        y: 940.0,
                        font_size: 56.0,
                        color: "#ffffff".into(),
                        align: "center".into(),
                        outline_width: 4.0,
                        opacity: 1.0,
                    }),
                ],
            },
            Track {
                id: "trk_bgm".into(),
                kind: TrackKind::Bgm,
                name: "BGM".into(),
                muted: false,
                clips: vec![Clip::Audio(AudioClip {
                    id: "clp_bgm".into(),
                    name: "演示 BGM".into(),
                    start: 0,
                    duration: frames,
                    keyframes: vec![],
                    asset_id: "ast_bgm".into(),
                    volume: 0.7,
                    fade_in_frames: 30,
                    fade_out_frames: 60,
                })],
            },
            Track {
                id: "trk_voice".into(),
                kind: TrackKind::Voice,
                name: "语音".into(),
                muted: false,
                clips: vec![Clip::Audio(AudioClip {
                    id: "clp_sfx".into(),
                    name: "提示音".into(),
                    start: 60,
                    duration: 18,
                    keyframes: vec![],
                    asset_id: "ast_sfx".into(),
                    volume: 0.9,
                    fade_in_frames: 2,
                    fade_out_frames: 6,
                })],
            },
            Track {
                id: "trk_sfx".into(),
                kind: TrackKind::Sfx,
                name: "音效".into(),
                muted: false,
                clips: vec![],
            },
            Track {
                id: "trk_effect".into(),
                kind: TrackKind::Effect,
                name: "特效".into(),
                muted: false,
                clips: vec![
                    Clip::Effect(EffectClip {
                        id: "clp_vig".into(),
                        name: "暗角".into(),
                        start: 0,
                        duration: frames,
                        keyframes: vec![],
                        effect: EffectSpec {
                            effect_type: EffectType::Vignette,
                            params: HashMap::from([
                                ("strength".into(), serde_json::json!(0.5)),
                                ("softness".into(), serde_json::json!(0.7)),
                            ]),
                        },
                    }),
                    Clip::Effect(EffectClip {
                        id: "clp_flash".into(),
                        name: "闪白".into(),
                        start: 150,
                        duration: 15,
                        keyframes: vec![
                            kf(0, "effect.params.alpha", 0.0),
                            kf(6, "effect.params.alpha", 0.9),
                            kf(15, "effect.params.alpha", 0.0),
                        ],
                        effect: EffectSpec {
                            effect_type: EffectType::Flash,
                            params: HashMap::from([("alpha".into(), serde_json::json!(0.9))]),
                        },
                    }),
                    Clip::Effect(EffectClip {
                        id: "clp_shake".into(),
                        name: "震动".into(),
                        start: 150,
                        duration: 20,
                        keyframes: vec![],
                        effect: EffectSpec {
                            effect_type: EffectType::Shake,
                            params: HashMap::from([
                                ("amplitude".into(), serde_json::json!(8.0)),
                                ("frequency".into(), serde_json::json!(30.0)),
                            ]),
                        },
                    }),
                    Clip::Effect(EffectClip {
                        id: "clp_trans".into(),
                        name: "转场（结尾淡出）".into(),
                        start: 330,
                        duration: 30,
                        keyframes: vec![
                            kf(0, "effect.params.alpha", 0.0),
                            kf(30, "effect.params.alpha", 1.0),
                        ],
                        effect: EffectSpec {
                            effect_type: EffectType::Transition,
                            params: HashMap::from([
                                ("color".into(), serde_json::json!("#000000")),
                                ("alpha".into(), serde_json::json!(0.0)),
                            ]),
                        },
                    }),
                ],
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
    image::write_buffer_with_format(&mut buf, img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgba8, image::ImageFormat::Png)
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
    // 简单 UTC ISO8601（无 chrono 依赖）
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
