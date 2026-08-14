//! 时间轴求值器 —— 预览（IPC）与离线渲染共用的**唯一**求值实现。
//! 输入：(&Project, &Scene, frame) → 输出 SceneDescriptor（纯函数、无 I/O、确定性）。
//! 语义规范：docs/PROJECT_FORMAT.md §4；前端 DEV 替身 dev/stubEvaluator.ts 目标同语义（仅 UI 测试）。

use crate::model::{
    ActionType, Clip, EffectClip, EffectType, Easing, ImageClip, Keyframe, KeyValue, Project, Scene,
    SubtitleClip, TrackKind,
};
use serde::Serialize;
use std::collections::HashMap;

pub const ACTION_ENTER_DURATION: i64 = 15;
pub const ACTION_EXIT_DURATION: i64 = 15;

// ---------------------------------------------------------------------------
// 输出契约（与前端 src/shared/descriptor.ts 同构）
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SceneDescriptor {
    pub frame: u32,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub duration_frames: u32,
    pub camera: CameraDesc,
    pub layers: Vec<LayerDesc>,
    pub subtitles: Vec<SubtitleDesc>,
    pub effects: Vec<EffectDesc>,
    pub audio: Vec<AudioDesc>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CameraDesc {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LayerDesc {
    pub id: String,
    pub kind: &'static str,
    pub asset_id: String,
    pub x: f64,
    pub y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotation: f64,
    pub opacity: f64,
    pub tint: [u8; 3],
    pub blur: f64,
    pub crop: CropDesc,
    pub flip_x: bool,
    pub flash: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CropDesc {
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleDesc {
    pub id: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub font_size: f64,
    pub color: String,
    pub align: String,
    pub outline_width: f64,
    pub opacity: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EffectDesc {
    #[serde(rename = "type")]
    pub effect_type: EffectType,
    pub params: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioDesc {
    pub asset_id: String,
    pub start_frame: u32,
    pub duration_frames: u32,
    pub volume: f64,
    pub fade_in_frames: i64,
    pub fade_out_frames: i64,
}

// ---------------------------------------------------------------------------
// 缓动
// ---------------------------------------------------------------------------

pub fn apply_easing(u: f64, e: &Easing) -> f64 {
    let u = u.clamp(0.0, 1.0);
    match e.easing_type.as_str() {
        "linear" => u,
        "easeIn" => u * u * u,
        "easeOut" => 1.0 - (1.0 - u).powi(3),
        "easeInOut" => {
            if u < 0.5 {
                4.0 * u * u * u
            } else {
                1.0 - (-2.0 * u + 2.0).powi(3) / 2.0
            }
        }
        "cubic" => {
            let c1 = e.c1.unwrap_or([0.42, 0.0]);
            let c2 = e.c2.unwrap_or([0.58, 1.0]);
            cubic_bezier_y(u, c1, c2)
        }
        _ => u,
    }
}

fn cubic_bezier_y(u: f64, c1: [f64; 2], c2: [f64; 2]) -> f64 {
    let (x0, y0) = (0.0, 0.0);
    let (x1, y1) = (c1[0], c1[1]);
    let (x2, y2) = (c2[0], c2[1]);
    let (x3, y3) = (1.0, 1.0);
    if u <= 0.0 {
        return y0;
    }
    if u >= 1.0 {
        return y3;
    }
    let bez_x = |t: f64| {
        let mt = 1.0 - t;
        mt * mt * mt * x0 + 3.0 * mt * mt * t * x1 + 3.0 * mt * t * t * x2 + t * t * t * x3
    };
    let bez_y = |t: f64| {
        let mt = 1.0 - t;
        mt * mt * mt * y0 + 3.0 * mt * mt * t * y1 + 3.0 * mt * t * t * y2 + t * t * t * y3
    };
    let mut lo = 0.0;
    let mut hi = 1.0;
    for _ in 0..24 {
        let t = (lo + hi) / 2.0;
        let xt = bez_x(t);
        if (xt - u).abs() < 1e-6 {
            return bez_y(t);
        }
        if xt < u {
            lo = t;
        } else {
            hi = t;
        }
    }
    bez_y((lo + hi) / 2.0)
}

// ---------------------------------------------------------------------------
// 关键帧插值
// ---------------------------------------------------------------------------

/// 在片段局部帧 lf 处求 path 属性的数值（无关键帧 → fallback）。
fn numeric_at(kfs: &[Keyframe], path: &str, lf: i64, fallback: f64) -> f64 {
    match value_at(kfs, path, lf, KeyValue::Number(fallback)) {
        KeyValue::Number(n) => n,
        KeyValue::Text(_) => fallback,
    }
}

/// 在片段局部帧 lf 处求 path 属性的字符串（离散关键帧：取最后一个 frame <= lf 的文本关键帧）。
fn string_at<'a>(kfs: &'a [Keyframe], path: &str, lf: i64, fallback: &'a str) -> &'a str {
    let mut result = fallback;
    for k in kfs.iter().filter(|k| k.path == path) {
        if let Some(s) = k.value.as_str() {
            if k.frame <= lf {
                result = s;
            } else {
                break;
            }
        }
    }
    result
}

fn value_at(kfs: &[Keyframe], path: &str, lf: i64, fallback: KeyValue) -> KeyValue {
    let mut matched: Vec<&Keyframe> = kfs.iter().filter(|k| k.path == path).collect();
    if matched.is_empty() {
        return fallback;
    }
    matched.sort_by_key(|k| k.frame);
    let first = matched[0];
    if lf <= first.frame || matched.len() == 1 {
        return first.value.clone();
    }
    let last = matched[matched.len() - 1];
    if lf >= last.frame {
        return last.value.clone();
    }
    for pair in matched.windows(2) {
        let a = pair[0];
        let b = pair[1];
        if lf >= a.frame && lf <= b.frame {
            let span = (b.frame - a.frame) as f64;
            if span <= 0.0 {
                return b.value.clone();
            }
            if a.value.as_f64().is_none() || b.value.as_f64().is_none() {
                // 离散属性：到达 b.frame 即切换
                return if lf >= b.frame { b.value.clone() } else { a.value.clone() };
            }
            let u = (lf - a.frame) as f64 / span;
            let e = apply_easing(u, &b.easing);
            let va = a.value.as_f64().unwrap();
            let vb = b.value.as_f64().unwrap();
            return KeyValue::Number(va + (vb - va) * e);
        }
    }
    last.value.clone()
}

/// 确定性伪随机（帧号做种），与 DEV 替身同公式。
fn jitter(frame: u32, seed: u32) -> f64 {
    let mut h = frame.wrapping_mul(374_761_393).wrapping_add(seed.wrapping_mul(668_265_263));
    h = (h ^ (h >> 13)).wrapping_mul(1_274_126_177);
    h ^= h >> 16;
    ((h & 0xffff) as f64) / 65_535.0
}

fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

// ---------------------------------------------------------------------------
// 求值
// ---------------------------------------------------------------------------

pub fn evaluate(project: &Project, scene: &Scene, frame: u32) -> SceneDescriptor {
    let width = project.canvas.width;
    let height = project.canvas.height;
    let fps = project.canvas.fps.max(1);
    let duration = scene.duration_frames;
    let frame_c = frame.min(duration.saturating_sub(1));

    let mut camera = CameraDesc { x: 0.0, y: 0.0, zoom: 1.0 };
    let mut layers: Vec<LayerDesc> = Vec::new();
    let mut subtitles: Vec<SubtitleDesc> = Vec::new();
    let mut effects: Vec<EffectDesc> = Vec::new();
    let mut audio: Vec<AudioDesc> = Vec::new();

    for track in &scene.tracks {
        for clip in &track.clips {
            let start = clip.start();
            let dur = clip.duration();
            let lf = frame_c as i64 - start;
            if lf < 0 || lf >= dur {
                continue;
            }
            match clip {
                Clip::Image(c) => {
                    layers.push(eval_image(c, lf));
                }
                Clip::Subtitle(c) => {
                    subtitles.push(eval_subtitle(c, lf));
                }
                Clip::Audio(c) => {
                    audio.push(eval_audio(c, lf));
                }
                Clip::Camera(c) => {
                    eval_camera(c, lf, &mut camera);
                }
                Clip::Effect(c) => {
                    eval_effect(c, lf, &mut effects, frame_c, &mut camera);
                }
            }
        }
    }

    SceneDescriptor {
        frame: frame_c,
        width,
        height,
        fps,
        duration_frames: duration,
        camera,
        layers,
        subtitles,
        effects,
        audio,
    }
}

fn eval_image(c: &ImageClip, lf: i64) -> LayerDesc {
    let kfs = &c.keyframes;
    let p = &c.props;
    let mut x = numeric_at(kfs, "props.x", lf, p.x);
    let mut y = numeric_at(kfs, "props.y", lf, p.y);
    let mut sx = numeric_at(kfs, "props.scaleX", lf, p.scale_x);
    let mut sy = numeric_at(kfs, "props.scaleY", lf, p.scale_y);
    let rotation = numeric_at(kfs, "props.rotation", lf, p.rotation);
    let mut opacity = numeric_at(kfs, "props.opacity", lf, p.opacity);
    let blur = numeric_at(kfs, "props.blur", lf, p.blur);
    let flip_x = numeric_at(kfs, "props.flipX", lf, if p.flip_x { 1.0 } else { 0.0 }) > 0.5;
    let asset_id = string_at(kfs, "assetId", lf, &c.asset_id).to_string();
    let mut flash = 0.0_f64;

    let dur = c.duration;
    let a = &c.actions;

    // 进入动作（片段前 15 帧）
    if a.enter != ActionType::None && lf < ACTION_ENTER_DURATION {
        let u = lf as f64 / ACTION_ENTER_DURATION as f64;
        let e = apply_easing(u, &Easing { easing_type: "easeInOut".into(), c1: None, c2: None });
        match a.enter {
            ActionType::FadeIn => opacity *= e,
            ActionType::SlideInLeft => x = lerp(x - 1400.0, x, e),
            ActionType::SlideInRight => x = lerp(x + 1400.0, x, e),
            ActionType::ZoomIn => {
                sx = lerp(sx * 0.6, sx, e);
                sy = lerp(sy * 0.6, sy, e);
            }
            _ => {}
        }
    }
    // 离开动作（片段最后 15 帧）
    if a.exit != ActionType::None && lf >= dur - ACTION_EXIT_DURATION {
        let u = (lf - (dur - ACTION_EXIT_DURATION)) as f64 / ACTION_EXIT_DURATION as f64;
        let e = apply_easing(u, &Easing { easing_type: "easeInOut".into(), c1: None, c2: None });
        match a.exit {
            ActionType::FadeOut => opacity *= 1.0 - e,
            ActionType::SlideOutLeft => x = lerp(x, x - 1400.0, e),
            ActionType::SlideOutRight => x = lerp(x, x + 1400.0, e),
            ActionType::ZoomOut => {
                sx = lerp(sx, sx * 0.6, e);
                sy = lerp(sy, sy * 0.6, e);
            }
            _ => {}
        }
    }
    // 待机动作（全程）
    match a.idle {
        ActionType::Sway => x += (2.0 * std::f64::consts::PI * lf as f64 / 60.0).sin() * 5.0,
        ActionType::Shake => {
            x += (jitter(lf as u32, 1) - 0.5) * 6.0;
            y += (jitter(lf as u32, 2) - 0.5) * 6.0;
        }
        ActionType::Jump => {
            let u = (lf % 30) as f64 / 30.0;
            y -= (std::f64::consts::PI * u).sin() * 40.0;
        }
        ActionType::Pulse => {
            let m = 1.0 + 0.08 * (2.0 * std::f64::consts::PI * lf as f64 / 30.0).sin();
            sx *= m;
            sy *= m;
        }
        ActionType::FlashWhite => {
            flash = flash.max((2.0 * std::f64::consts::PI * lf as f64 / 20.0).sin() * 0.5 + 0.5);
        }
        _ => {}
    }

    LayerDesc {
        id: c.id.clone(),
        kind: "image",
        asset_id,
        x,
        y,
        scale_x: sx,
        scale_y: sy,
        rotation,
        opacity: clamp01(opacity),
        tint: p.tint,
        blur,
        crop: CropDesc {
            left: p.crop.left,
            right: p.crop.right,
            top: p.crop.top,
            bottom: p.crop.bottom,
        },
        flip_x,
        flash,
    }
}

fn eval_subtitle(c: &SubtitleClip, lf: i64) -> SubtitleDesc {
    let kfs = &c.keyframes;
    SubtitleDesc {
        id: c.id.clone(),
        text: c.text.clone(),
        x: numeric_at(kfs, "x", lf, c.x),
        y: numeric_at(kfs, "y", lf, c.y),
        font_size: numeric_at(kfs, "fontSize", lf, c.font_size),
        color: c.color.clone(),
        align: c.align.clone(),
        outline_width: numeric_at(kfs, "outlineWidth", lf, c.outline_width),
        opacity: clamp01(numeric_at(kfs, "opacity", lf, c.opacity)),
    }
}

fn eval_audio(c: &crate::model::AudioClip, lf: i64) -> AudioDesc {
    let kfs = &c.keyframes;
    let mut vol = numeric_at(kfs, "volume", lf, c.volume);
    let dur = c.duration;
    if c.fade_in_frames > 0 && lf < c.fade_in_frames {
        vol *= lf as f64 / c.fade_in_frames as f64;
    }
    if c.fade_out_frames > 0 && lf >= dur - c.fade_out_frames {
        vol *= ((dur - lf) as f64 / c.fade_out_frames as f64).max(0.0);
    }
    AudioDesc {
        asset_id: c.asset_id.clone(),
        start_frame: c.start.max(0) as u32,
        duration_frames: c.duration.max(1) as u32,
        volume: clamp01(vol),
        fade_in_frames: c.fade_in_frames,
        fade_out_frames: c.fade_out_frames,
    }
}

fn eval_camera(c: &crate::model::CameraClip, lf: i64, out: &mut CameraDesc) {
    let kfs = &c.keyframes;
    out.x = numeric_at(kfs, "props.x", lf, c.props.x);
    out.y = numeric_at(kfs, "props.y", lf, c.props.y);
    out.zoom = numeric_at(kfs, "zoom", lf, c.props.zoom).max(0.01);
}

fn eval_effect(
    c: &EffectClip,
    lf: i64,
    effects: &mut Vec<EffectDesc>,
    frame: u32,
    camera: &mut CameraDesc,
) {
    let kfs = &c.keyframes;
    let mut params: HashMap<String, serde_json::Value> = HashMap::new();
    for (k, v) in &c.effect.params {
        match v {
            serde_json::Value::Number(n) => {
                let fallback = n.as_f64().unwrap_or(0.0);
                let evaled = numeric_at(kfs, &format!("effect.params.{k}"), lf, fallback);
                params.insert(k.clone(), serde_json::json!(evaled));
            }
            other => {
                params.insert(k.clone(), other.clone());
            }
        }
    }
    if c.effect.effect_type == EffectType::Shake {
        let amp = params
            .get("amplitude")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        camera.x += (jitter(frame, 7) - 0.5) * 2.0 * amp;
        camera.y += (jitter(frame, 8) - 0.5) * 2.0 * amp;
    }
    effects.push(EffectDesc {
        effect_type: c.effect.effect_type.clone(),
        params,
    });
}

fn lerp(a: f64, b: f64, e: f64) -> f64 {
    a + (b - a) * e
}

/// 供音频混音使用的轨道分类辅助。
pub fn is_audio_track(kind: &TrackKind) -> bool {
    matches!(kind, TrackKind::Bgm | TrackKind::Voice | TrackKind::Sfx)
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn ease(t: &str) -> Easing {
        Easing { easing_type: t.into(), c1: None, c2: None }
    }

    fn kf(frame: i64, path: &str, value: KeyValue, easing: Easing) -> Keyframe {
        Keyframe { frame, path: path.into(), value, easing }
    }

    fn simple_project() -> Project {
        Project {
            format_version: 1,
            meta: Meta { name: "t".into(), created_at: "".into(), updated_at: "".into() },
            canvas: CanvasConfig { width: 1920, height: 1080, fps: 30 },
            assets: vec![],
            scenes: vec![Scene {
                id: "scn".into(),
                name: "s".into(),
                duration_frames: 100,
                tracks: vec![],
            }],
            export: ExportConfig {
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
    fn easing_midpoints() {
        let lin = apply_easing(0.5, &ease("linear"));
        assert!((lin - 0.5).abs() < 1e-9);
        let ease_in = apply_easing(0.5, &ease("easeIn"));
        assert!((ease_in - 0.125).abs() < 1e-9); // 0.5^3
        let ease_out = apply_easing(0.5, &ease("easeOut"));
        assert!((ease_out - 0.875).abs() < 1e-9); // 1-(0.5)^3
        let ease_in_out = apply_easing(0.5, &ease("easeInOut"));
        assert!((ease_in_out - 0.5).abs() < 1e-9); // 对称中点
        let cubic = apply_easing(0.5, &Easing { easing_type: "cubic".into(), c1: Some([0.42, 0.0]), c2: Some([0.58, 1.0]) });
        assert!((cubic - 0.5).abs() < 1e-4); // 标准缓动曲线中点约 0.5
    }

    #[test]
    fn keyframe_interpolation_and_hold() {
        let kfs = vec![
            kf(0, "x", KeyValue::Number(0.0), ease("linear")),
            kf(10, "x", KeyValue::Number(100.0), ease("linear")),
        ];
        assert_eq!(numeric_at(&kfs, "x", 0, 999.0), 0.0);
        assert_eq!(numeric_at(&kfs, "x", 5, 999.0), 50.0);
        assert_eq!(numeric_at(&kfs, "x", 10, 999.0), 100.0);
        // 区间外保持（无外推）
        assert_eq!(numeric_at(&kfs, "x", 99, 999.0), 100.0);
        assert_eq!(numeric_at(&kfs, "x", -5, 999.0), 0.0);
        // 无关键帧 → 静态值
        assert_eq!(numeric_at(&[], "x", 5, 42.0), 42.0);
    }

    #[test]
    fn discrete_keyframe_switches_at_frame() {
        let kfs = vec![
            kf(0, "assetId", KeyValue::Text("a".into()), ease("linear")),
            kf(10, "assetId", KeyValue::Text("b".into()), ease("linear")),
        ];
        assert_eq!(string_at(&kfs, "assetId", 9, "a"), "a");
        assert_eq!(string_at(&kfs, "assetId", 10, "a"), "b");
        assert_eq!(string_at(&kfs, "assetId", 50, "a"), "b");
    }

    #[test]
    fn clip_active_window() {
        let scene = Scene {
            id: "scn".into(),
            name: "s".into(),
            duration_frames: 100,
            tracks: vec![Track {
                id: "trk".into(),
                kind: TrackKind::Character,
                name: "c".into(),
                muted: false,
                clips: vec![Clip::Image(ImageClip {
                    id: "clp".into(),
                    name: "c".into(),
                    start: 10,
                    duration: 20,
                    keyframes: vec![],
                    asset_id: "ast".into(),
                    props: VisualProps {
                        x: 1.0,
                        y: 2.0,
                        scale_x: 1.0,
                        scale_y: 1.0,
                        rotation: 0.0,
                        opacity: 1.0,
                        tint: [255, 255, 255],
                        blur: 0.0,
                        crop: CropRect { left: 0.0, right: 0.0, top: 0.0, bottom: 0.0 },
                        flip_x: false,
                    },
                    actions: Actions { enter: ActionType::None, idle: ActionType::None, exit: ActionType::None },
                })],
            }],
        };
        let project = simple_project();
        // 片段区间 [10, 30)
        let d9 = evaluate(&project, &scene, 9);
        assert!(d9.layers.is_empty());
        let d10 = evaluate(&project, &scene, 10);
        assert_eq!(d10.layers.len(), 1);
        assert_eq!(d10.layers[0].x, 1.0);
        let d29 = evaluate(&project, &scene, 29);
        assert_eq!(d29.layers.len(), 1);
        let d30 = evaluate(&project, &scene, 30);
        assert!(d30.layers.is_empty());
        // 帧号钳制
        let d99 = evaluate(&project, &scene, 999);
        assert_eq!(d99.frame, 99);
    }

    #[test]
    fn enter_action_fade_in() {
        let mut clip = ImageClip {
            id: "clp".into(),
            name: "c".into(),
            start: 0,
            duration: 60,
            keyframes: vec![],
            asset_id: "ast".into(),
            props: VisualProps {
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
            },
            actions: Actions { enter: ActionType::FadeIn, idle: ActionType::None, exit: ActionType::None },
        };
        let scene = Scene {
            id: "scn".into(),
            name: "s".into(),
            duration_frames: 100,
            tracks: vec![Track {
                id: "trk".into(),
                kind: TrackKind::Character,
                name: "c".into(),
                muted: false,
                clips: vec![Clip::Image(clip.clone())],
            }],
        };
        let project = simple_project();
        let d0 = evaluate(&project, &scene, 0);
        assert!(d0.layers[0].opacity < 1e-9);
        // 第 15 帧（进入结束）应达到约 1.0
        let d15 = evaluate(&project, &scene, 15);
        assert!((d15.layers[0].opacity - 1.0).abs() < 1e-6);
        // 第 16 帧后不再有进入影响
        let d16 = evaluate(&project, &scene, 16);
        assert_eq!(d16.layers[0].opacity, 1.0);
        clip.actions.enter = ActionType::None;
    }

    #[test]
    fn audio_fade_in_envelope() {
        let clip = AudioClip {
            id: "clp".into(),
            name: "a".into(),
            start: 0,
            duration: 100,
            keyframes: vec![],
            asset_id: "ast".into(),
            volume: 1.0,
            fade_in_frames: 10,
            fade_out_frames: 0,
        };
        let scene = Scene {
            id: "scn".into(),
            name: "s".into(),
            duration_frames: 100,
            tracks: vec![Track {
                id: "trk".into(),
                kind: TrackKind::Bgm,
                name: "b".into(),
                muted: false,
                clips: vec![Clip::Audio(clip)],
            }],
        };
        let project = simple_project();
        let d0 = evaluate(&project, &scene, 0);
        assert_eq!(d0.audio[0].volume, 0.0);
        let d5 = evaluate(&project, &scene, 5);
        assert!((d5.audio[0].volume - 0.5).abs() < 1e-9);
        let d10 = evaluate(&project, &scene, 10);
        assert_eq!(d10.audio[0].volume, 1.0);
    }

    #[test]
    fn camera_zoom_interpolation() {
        let clip = CameraClip {
            id: "clp".into(),
            name: "cam".into(),
            start: 0,
            duration: 100,
            keyframes: vec![
                kf(0, "zoom", KeyValue::Number(1.0), ease("linear")),
                kf(100, "zoom", KeyValue::Number(2.0), ease("linear")),
            ],
            props: CameraProps { x: 0.0, y: 0.0, zoom: 1.0 },
        };
        let scene = Scene {
            id: "scn".into(),
            name: "s".into(),
            duration_frames: 100,
            tracks: vec![Track {
                id: "trk".into(),
                kind: TrackKind::Camera,
                name: "cam".into(),
                muted: false,
                clips: vec![Clip::Camera(clip)],
            }],
        };
        let project = simple_project();
        let d = evaluate(&project, &scene, 50);
        assert!((d.camera.zoom - 1.5).abs() < 1e-9);
    }

    #[test]
    fn shake_effect_moves_camera() {
        let clip = EffectClip {
            id: "clp".into(),
            name: "fx".into(),
            start: 0,
            duration: 100,
            keyframes: vec![],
            effect: EffectSpec {
                effect_type: EffectType::Shake,
                params: HashMap::from([
                    ("amplitude".into(), serde_json::json!(10.0)),
                    ("frequency".into(), serde_json::json!(30.0)),
                ]),
            },
        };
        let scene = Scene {
            id: "scn".into(),
            name: "s".into(),
            duration_frames: 100,
            tracks: vec![Track {
                id: "trk".into(),
                kind: TrackKind::Effect,
                name: "fx".into(),
                muted: false,
                clips: vec![Clip::Effect(clip)],
            }],
        };
        let project = simple_project();
        let d = evaluate(&project, &scene, 10);
        // 抖动偏移必须非零且确定
        assert!(d.camera.x.abs() > 0.0 || d.camera.y.abs() > 0.0);
        let d2 = evaluate(&project, &scene, 10);
        assert_eq!(d.camera.x, d2.camera.x);
        assert_eq!(d.camera.y, d2.camera.y);
    }

    #[test]
    fn subtitle_output() {
        let clip = SubtitleClip {
            id: "clp".into(),
            name: "sub".into(),
            start: 10,
            duration: 20,
            keyframes: vec![],
            text: "你好".into(),
            x: 960.0,
            y: 940.0,
            font_size: 56.0,
            color: "#ffffff".into(),
            align: "center".into(),
            outline_width: 4.0,
            opacity: 1.0,
        };
        let scene = Scene {
            id: "scn".into(),
            name: "s".into(),
            duration_frames: 100,
            tracks: vec![Track {
                id: "trk".into(),
                kind: TrackKind::Subtitle,
                name: "sub".into(),
                muted: false,
                clips: vec![Clip::Subtitle(clip)],
            }],
        };
        let project = simple_project();
        let d = evaluate(&project, &scene, 15);
        assert_eq!(d.subtitles.len(), 1);
        assert_eq!(d.subtitles[0].text, "你好");
        let d_out = evaluate(&project, &scene, 30);
        assert!(d_out.subtitles.is_empty());
    }

    #[test]
    fn idle_sway_moves_x() {
        let clip = ImageClip {
            id: "clp".into(),
            name: "c".into(),
            start: 0,
            duration: 120,
            keyframes: vec![],
            asset_id: "ast".into(),
            props: VisualProps {
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
            },
            actions: Actions { enter: ActionType::None, idle: ActionType::Sway, exit: ActionType::None },
        };
        let scene = Scene {
            id: "scn".into(),
            name: "s".into(),
            duration_frames: 120,
            tracks: vec![Track {
                id: "trk".into(),
                kind: TrackKind::Character,
                name: "c".into(),
                muted: false,
                clips: vec![Clip::Image(clip)],
            }],
        };
        let project = simple_project();
        let d15 = evaluate(&project, &scene, 15);
        // sway: x += sin(2π·15/60)·5 = sin(π/2)·5 = 5
        assert!((d15.layers[0].x - 965.0).abs() < 1e-6);
        let d30 = evaluate(&project, &scene, 30);
        // sin(π) = 0
        assert!((d30.layers[0].x - 960.0).abs() < 1e-6);
    }
}
