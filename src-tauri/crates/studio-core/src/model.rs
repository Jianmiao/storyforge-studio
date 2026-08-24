//! StudioProject v1 领域模型（serde）。
//! 与前端 src/domain/types.ts 同构；契约文档 docs/PROJECT_FORMAT.md。
//! 字段命名：JSON 侧 camelCase，Rust 侧 snake_case（serde rename_all）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const FORMAT_VERSION: u32 = 2;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub format_version: u32,
    pub meta: Meta,
    pub canvas: CanvasConfig,
    pub assets: Vec<AssetRecord>,
    /// 剧本节点图（v2 权威剧本）。
    pub script: ScriptGraph,
    /// v1 遗留时间轴（迁移保留；v2 新项目为空）。
    pub scenes: Vec<Scene>,
    #[serde(rename = "export")]
    pub export: ExportConfig,
}

// ---------------------------------------------------------------------------
// 剧本节点图（v2）
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScriptGraph {
    pub nodes: Vec<GraphNode>,
    pub entry_node_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GraphNodeType {
    Entry,
    Script,
    Selection,
    Exit,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: GraphNodeType,
    pub x: f64,
    pub y: f64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<ScriptLine>>,
    /// selection 选项文本，与 next 索引对齐。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    /// 输出连接（目标节点 id）。
    pub next: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CharacterLineRef {
    pub asset_id: String,
    /// 旧工程三槽：0 = 左，1 = 中，2 = 右。
    pub slot: i64,
    /// 待机动作：none | sway | shake | jump | pulse | flashWhite。
    pub action: String,
    pub scale: f64,
    /// AA 语义五槽（1..5）；缺失时继续按旧三槽解释 slot。
    #[serde(default)]
    pub start_slot: Option<i64>,
    #[serde(default)]
    pub end_slot: Option<i64>,
    #[serde(default)]
    pub appear: Option<String>,
    #[serde(default)]
    pub move_duration_frames: Option<i64>,
    #[serde(default)]
    pub move_easing: Option<String>,
    #[serde(default)]
    pub highlighted: Option<bool>,
    #[serde(default)]
    pub luminance: Option<f64>,
    #[serde(default)]
    pub on_top: bool,
    #[serde(default)]
    pub closeup: bool,
    #[serde(default)]
    pub face_id: Option<String>,
    #[serde(default)]
    pub shape_override: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScriptLine {
    pub id: String,
    pub text: String,
    pub speaker: String,
    #[serde(default)]
    pub club_name: String,
    pub characters: Vec<CharacterLineRef>,
    pub bg_asset_id: Option<String>,
    pub bg_effect: String,
    pub bgm_asset_id: Option<String>,
    pub voice_asset_id: Option<String>,
    pub sound_asset_id: Option<String>,
    pub transition: String,
    pub duration_frames: i64,
    pub place_text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CanvasConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Image,
    Audio,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssetRecord {
    pub id: String,
    pub kind: AssetKind,
    pub file_name: String,
    pub original_path: String,
    pub hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub duration_frames: u32,
    pub tracks: Vec<Track>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Background,
    Character,
    Camera,
    Subtitle,
    Bgm,
    Voice,
    Sfx,
    Effect,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub kind: TrackKind,
    pub name: String,
    pub muted: bool,
    pub clips: Vec<Clip>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Clip {
    Image(ImageClip),
    Subtitle(SubtitleClip),
    Audio(AudioClip),
    Camera(CameraClip),
    Effect(EffectClip),
}

impl Clip {
    pub fn id(&self) -> &str {
        match self {
            Clip::Image(c) => &c.id,
            Clip::Subtitle(c) => &c.id,
            Clip::Audio(c) => &c.id,
            Clip::Camera(c) => &c.id,
            Clip::Effect(c) => &c.id,
        }
    }
    pub fn start(&self) -> i64 {
        match self {
            Clip::Image(c) => c.start,
            Clip::Subtitle(c) => c.start,
            Clip::Audio(c) => c.start,
            Clip::Camera(c) => c.start,
            Clip::Effect(c) => c.start,
        }
    }
    pub fn duration(&self) -> i64 {
        match self {
            Clip::Image(c) => c.duration,
            Clip::Subtitle(c) => c.duration,
            Clip::Audio(c) => c.duration,
            Clip::Camera(c) => c.duration,
            Clip::Effect(c) => c.duration,
        }
    }
    pub fn keyframes(&self) -> &[Keyframe] {
        match self {
            Clip::Image(c) => &c.keyframes,
            Clip::Subtitle(c) => &c.keyframes,
            Clip::Audio(c) => &c.keyframes,
            Clip::Camera(c) => &c.keyframes,
            Clip::Effect(c) => &c.keyframes,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub frame: i64,
    pub path: String,
    pub value: KeyValue,
    pub easing: Easing,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum KeyValue {
    Number(f64),
    Text(String),
}

impl KeyValue {
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            KeyValue::Number(n) => Some(*n),
            KeyValue::Text(_) => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            KeyValue::Text(s) => Some(s),
            KeyValue::Number(_) => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Easing {
    #[serde(rename = "type")]
    pub easing_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub c1: Option<[f64; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub c2: Option<[f64; 2]>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VisualProps {
    pub x: f64,
    pub y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotation: f64,
    pub opacity: f64,
    pub tint: [u8; 3],
    pub blur: f64,
    pub crop: CropRect,
    pub flip_x: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ActionType {
    None,
    FadeIn,
    SlideInLeft,
    SlideInRight,
    ZoomIn,
    FadeOut,
    SlideOutLeft,
    SlideOutRight,
    ZoomOut,
    Sway,
    Shake,
    Jump,
    Pulse,
    FlashWhite,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Actions {
    pub enter: ActionType,
    pub idle: ActionType,
    pub exit: ActionType,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImageClip {
    pub id: String,
    pub name: String,
    pub start: i64,
    pub duration: i64,
    pub keyframes: Vec<Keyframe>,
    pub asset_id: String,
    pub props: VisualProps,
    pub actions: Actions,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleClip {
    pub id: String,
    pub name: String,
    pub start: i64,
    pub duration: i64,
    pub keyframes: Vec<Keyframe>,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub font_size: f64,
    pub color: String,
    pub align: String,
    pub outline_width: f64,
    pub opacity: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioClip {
    pub id: String,
    pub name: String,
    pub start: i64,
    pub duration: i64,
    pub keyframes: Vec<Keyframe>,
    pub asset_id: String,
    pub volume: f64,
    pub fade_in_frames: i64,
    pub fade_out_frames: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CameraProps {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CameraClip {
    pub id: String,
    pub name: String,
    pub start: i64,
    pub duration: i64,
    pub keyframes: Vec<Keyframe>,
    pub props: CameraProps,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EffectType {
    Vignette,
    Flash,
    Shake,
    Tint,
    Blur,
    Transition,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EffectSpec {
    #[serde(rename = "type")]
    pub effect_type: EffectType,
    pub params: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EffectClip {
    pub id: String,
    pub name: String,
    pub start: i64,
    pub duration: i64,
    pub keyframes: Vec<Keyframe>,
    pub effect: EffectSpec,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub video_codec: String,
    pub crf: u32,
    pub preset: String,
    pub audio_bitrate_kbps: u32,
}
