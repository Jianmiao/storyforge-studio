//! 剧本节点图求值器（v2 正式实现）：线性化（默认路径）、演出行序列、按帧求值。
//! 语义与前端 DEV 替身 src/dev/stubEvaluator.ts::evaluateGraphFrame 一致（黄金测试覆盖）。
//! 预览（IPC）与离线渲染共用本模块。

use crate::model::{Easing, GraphNodeType, Project, ScriptGraph, ScriptLine};
use crate::timeline::{apply_easing, PresentationDialogue, SceneDescriptor};
use std::collections::HashMap;
use unicode_segmentation::UnicodeSegmentation;

pub const ACTION_FADE_FRAMES: i64 = 15;
pub const AA_STANDBY_LUMINANCE: f64 = 0.6;
pub const AA_MOVE_SECONDS: f64 = 0.5;
const PRESENTATION_SLOT_OFFSETS: [f64; 6] = [-925.0, -555.0, -185.0, 185.0, 555.0, 925.0];
const LEGACY_SLOT_RATIOS: [f64; 3] = [0.26, 0.5, 0.74];
const TYPEWRITER_NEWLINE_PAUSE_FRAMES: i64 = 6;
const TYPEWRITER_PUNCTUATION_PAUSE_FRAMES: i64 = 3;

#[derive(Clone, Debug)]
pub struct LineSpan {
    pub node_id: String,
    pub line: ScriptLine,
    pub start_frame: i64,
    pub duration_frames: i64,
}

/// 默认演出路径：entry 起，按 next 首条连接；selection 取第一个选项。
/// 断链即止（不补全其他分支，保证默认路径语义唯一）。
pub fn linearize_default_path(graph: &ScriptGraph) -> Vec<String> {
    let mut path: Vec<String> = Vec::new();
    let mut visited = std::collections::HashSet::new();
    let mut cur = graph.entry_node_id.clone();
    while let Some(id) = cur {
        if visited.contains(&id) {
            break;
        }
        visited.insert(id.clone());
        let Some(node) = graph.nodes.iter().find(|n| n.id == id) else {
            break;
        };
        path.push(id);
        cur = node.next.first().cloned();
    }
    path
}

/// 路径 → 演出行序列（含全局帧区间）。
pub fn build_line_sequence(graph: &ScriptGraph, path: &[String]) -> Vec<LineSpan> {
    let mut spans = Vec::new();
    let mut cursor: i64 = 0;
    for node_id in path {
        let Some(node) = graph.nodes.iter().find(|n| &n.id == node_id) else {
            continue;
        };
        if node.node_type == GraphNodeType::Script {
            if let Some(lines) = &node.lines {
                for line in lines {
                    let dur = line.duration_frames.max(1);
                    spans.push(LineSpan {
                        node_id: node_id.clone(),
                        line: line.clone(),
                        start_frame: cursor,
                        duration_frames: dur,
                    });
                    cursor += dur;
                }
            }
        }
    }
    spans
}

pub fn total_frames(spans: &[LineSpan]) -> i64 {
    spans.iter().map(|s| s.duration_frames).sum()
}

fn line_span_at(spans: &[LineSpan], frame: i64) -> Option<&LineSpan> {
    for s in spans {
        if frame >= s.start_frame && frame < s.start_frame + s.duration_frames {
            return Some(s);
        }
    }
    spans.last()
}

/// 确定性伪随机（帧号做种），与 timeline.rs 同公式。
fn jitter(frame: u32, seed: u32) -> f64 {
    let mut h = frame.wrapping_mul(374_761_393).wrapping_add(seed.wrapping_mul(668_265_263));
    h = (h ^ (h >> 13)).wrapping_mul(1_274_126_177);
    h ^= h >> 16;
    ((h & 0xffff) as f64) / 65_535.0
}

fn presentation_slot_x(slot: i64, width: u32) -> f64 {
    let index = slot.clamp(1, 6) as usize - 1;
    width as f64 / 2.0 + PRESENTATION_SLOT_OFFSETS[index] / 1920.0 * width as f64
}

fn legacy_slot_x(slot: i64, width: u32) -> f64 {
    let index = slot.clamp(0, 2) as usize;
    width as f64 * LEGACY_SLOT_RATIOS[index]
}

fn typewriter_state(text: &str, local_frame: i64) -> (String, bool) {
    let graphemes: Vec<&str> = UnicodeSegmentation::graphemes(text, true).collect();
    let mut budget = local_frame.max(0);
    let mut reveal_count = 0_usize;
    for grapheme in &graphemes {
        let extra = if *grapheme == "\n" {
            TYPEWRITER_NEWLINE_PAUSE_FRAMES
        } else if "，。！？；：、,.!?;:".contains(grapheme) {
            TYPEWRITER_PUNCTUATION_PAUSE_FRAMES
        } else {
            0
        };
        let cost = 1 + extra;
        if budget < cost {
            break;
        }
        budget -= cost;
        reveal_count += 1;
    }
    (graphemes[..reveal_count].concat(), reveal_count >= graphemes.len())
}

/// 按 path 在 frame 处求值 → SceneDescriptor。
pub fn evaluate(project: &Project, path: &[String], frame: u32) -> SceneDescriptor {
    let w = project.canvas.width;
    let h = project.canvas.height;
    let fps = project.canvas.fps.max(1);
    let spans = build_line_sequence(&project.script, path);
    let total = total_frames(&spans).max(1);
    let frame_c = (frame as i64).min(total - 1).max(0) as u32;
    let span = line_span_at(&spans, frame_c as i64);
    let camera = crate::timeline::CameraDesc { x: 0.0, y: 0.0, zoom: 1.0 };
    let mut layers = Vec::new();
    let mut subtitles = Vec::new();
    let mut presentation_dialogues = Vec::new();
    let mut effects = Vec::new();
    let mut audio = Vec::new();

    let Some(span) = span else {
        return empty_desc(project, frame_c, total as u32);
    };
    let lf = frame_c as i64 - span.start_frame;
    let line = &span.line;

    // 背景 / BGM 状态继承（当前行及之前最近的设置）
    let mut bg_asset_id: Option<String> = None;
    let mut bg_effect = "none".to_string();
    let mut bgm_asset_id: Option<String> = None;
    for s in &spans {
        if s.start_frame > frame_c as i64 {
            break;
        }
        if let Some(bg) = &s.line.bg_asset_id {
            bg_asset_id = Some(bg.clone());
            bg_effect = s.line.bg_effect.clone();
        }
        if let Some(bgm) = &s.line.bgm_asset_id {
            bgm_asset_id = Some(bgm.clone());
        }
    }

    // 背景层（铺满画布）
    if let Some(bg) = bg_asset_id {
        let scale = (w as f64 / 1920.0).max(h as f64 / 1080.0);
        layers.push(crate::timeline::LayerDesc {
            id: format!("bg_{}", span.node_id),
            kind: "image",
            asset_id: bg,
            x: w as f64 / 2.0,
            y: h as f64 / 2.0,
            scale_x: scale,
            scale_y: scale,
            rotation: 0.0,
            opacity: 1.0,
            tint: [255, 255, 255],
            blur: 0.0,
            crop: crate::timeline::CropDesc { left: 0.0, right: 0.0, top: 0.0, bottom: 0.0 },
            flip_x: false,
            flash: 0.0,
            z_index: Some(0),
        });
    }

    // 角色层：新行使用固定六槽；旧行缺少 startSlot/endSlot 时保持三槽兼容。
    for (character_index, ch) in line.characters.iter().enumerate() {
        let (mut dx, mut dy) = (0.0, 0.0);
        let mut pulse = 1.0;
        let mut flash = 0.0;
        match ch.action.as_str() {
            "sway" => dx = (2.0 * std::f64::consts::PI * lf as f64 / 60.0).sin() * 5.0,
            "shake" => {
                dx = (jitter(frame_c, 1) - 0.5) * 6.0;
                dy = (jitter(frame_c, 2) - 0.5) * 6.0;
            }
            "jump" => dy = -(std::f64::consts::PI * (lf % 30) as f64 / 30.0).sin() * 40.0,
            "pulse" => pulse = 1.0 + 0.08 * (2.0 * std::f64::consts::PI * lf as f64 / 30.0).sin(),
            "flashWhite" => flash = (2.0 * std::f64::consts::PI * lf as f64 / 20.0).sin() * 0.5 + 0.5,
            _ => {}
        }
        let target_slot = ch.end_slot.or(ch.start_slot);
        let target_x = target_slot.map(|slot| presentation_slot_x(slot, w)).unwrap_or_else(|| legacy_slot_x(ch.slot, w));
        let start_x = ch.start_slot.map(|slot| presentation_slot_x(slot, w)).unwrap_or(target_x);
        let move_duration = ch.move_duration_frames.unwrap_or_else(|| (fps as f64 * AA_MOVE_SECONDS).round() as i64).max(1);
        let easing = Easing {
            easing_type: ch.move_easing.clone().unwrap_or_else(|| "easeInOut".into()),
            c1: None,
            c2: None,
        };
        let move_t = apply_easing((lf as f64 / move_duration as f64).clamp(0.0, 1.0), &easing);
        let x = start_x + (target_x - start_x) * move_t;
        let mut opacity = 1.0;
        match ch.appear.as_deref() {
            Some("hide") => opacity = 0.0,
            Some("fadeOut") if move_t >= 1.0 => opacity = 0.0,
            _ => {}
        }
        let mut luminance = ch.luminance.unwrap_or(if ch.highlighted == Some(false) { AA_STANDBY_LUMINANCE } else { 1.0 }).clamp(0.0, 1.0);
        match ch.appear.as_deref() {
            Some("fadeIn") => luminance *= move_t,
            Some("fadeOut") => luminance *= 1.0 - move_t,
            _ => {}
        }
        let closeup_scale = if ch.closeup { 1.12 } else { 1.0 };
        let base_scale = 0.9 * ch.scale.max(0.01) * closeup_scale / (720.0 / h as f64);
        let z_index = if ch.on_top { 2_000 } else if ch.closeup { 1_500 } else { 100 + target_slot.unwrap_or(ch.slot) };
        let tint = (255.0 * luminance).round() as u8;
        layers.push(crate::timeline::LayerDesc {
            id: format!("char_{}_{}_{}_{}", ch.asset_id, ch.end_slot.unwrap_or(ch.slot), character_index, span.node_id),
            kind: "image",
            asset_id: ch.asset_id.clone(),
            x: x + dx,
            y: h as f64 * if ch.closeup { 0.6 } else { 0.58 } + dy,
            scale_x: base_scale * pulse,
            scale_y: base_scale * pulse,
            rotation: 0.0,
            opacity,
            tint: [tint, tint, tint],
            blur: 0.0,
            crop: crate::timeline::CropDesc { left: 0.0, right: 0.0, top: 0.0, bottom: 0.0 },
            flip_x: false,
            flash,
            z_index: Some(z_index),
        });
    }
    layers.sort_by_key(|layer| layer.z_index.unwrap_or(0));

    // 字幕（说话人 + 台词；地点文本作为副标题）
    if !line.text.is_empty() {
        let (visible_text, reveal_complete) = typewriter_state(&line.text, lf);
        let speaker_line = if line.speaker.is_empty() {
            line.text.clone()
        } else {
            format!("{}：{}", line.speaker, line.text)
        };
        let text = if line.place_text.is_empty() {
            speaker_line
        } else {
            format!("{}\n{}", line.place_text, speaker_line)
        };
        subtitles.push(crate::timeline::SubtitleDesc {
            id: format!("sub_{}", line.id),
            text,
            x: w as f64 / 2.0,
            y: h as f64 - 130.0,
            font_size: 52.0,
            color: "#ffffff".into(),
            align: "center".into(),
            outline_width: 4.0,
            opacity: 1.0,
        });
        presentation_dialogues.push(PresentationDialogue {
            id: format!("dialogue_{}", line.id),
            text: line.text.clone(),
            speaker: line.speaker.clone(),
            club_name: line.club_name.clone(),
            place_text: line.place_text.clone(),
            x: 92.0,
            name_y: h as f64 - 258.0,
            body_y: h as f64 - 194.0,
            font_size: 48.0,
            opacity: 1.0,
            outline_width: 4.0,
            visible_text,
            reveal_complete,
        });
    }

    // 转场（行首 fade：黑场淡入）
    if line.transition == "fade" && lf < ACTION_FADE_FRAMES {
        let alpha = 1.0 - apply_easing(lf as f64 / ACTION_FADE_FRAMES as f64, &Easing { easing_type: "easeInOut".into(), c1: None, c2: None });
        effects.push(crate::timeline::EffectDesc {
            effect_type: crate::model::EffectType::Transition,
            params: HashMap::from([("color".into(), serde_json::json!("#000000")), ("alpha".into(), serde_json::json!(alpha))]),
        });
    }
    if bg_effect == "blur" {
        effects.push(crate::timeline::EffectDesc {
            effect_type: crate::model::EffectType::Blur,
            params: HashMap::from([("radius".into(), serde_json::json!(8.0))]),
        });
    }

    // 音频：BGM 持续到结尾；语音/音效在当前行区间
    if let Some(bgm) = bgm_asset_id {
        audio.push(crate::timeline::AudioDesc {
            asset_id: bgm,
            start_frame: 0,
            duration_frames: total.max(1) as u32,
            volume: 0.7,
            fade_in_frames: 30,
            fade_out_frames: 60,
        });
    }
    if let Some(voice) = &line.voice_asset_id {
        audio.push(crate::timeline::AudioDesc {
            asset_id: voice.clone(),
            start_frame: span.start_frame.max(0) as u32,
            duration_frames: span.duration_frames as u32,
            volume: 0.9,
            fade_in_frames: 2,
            fade_out_frames: 6,
        });
    }
    if let Some(sound) = &line.sound_asset_id {
        audio.push(crate::timeline::AudioDesc {
            asset_id: sound.clone(),
            start_frame: span.start_frame.max(0) as u32,
            duration_frames: span.duration_frames as u32,
            volume: 0.85,
            fade_in_frames: 2,
            fade_out_frames: 6,
        });
    }

    SceneDescriptor {
        frame: frame_c,
        width: w,
        height: h,
        fps,
        duration_frames: total as u32,
        camera,
        layers,
        subtitles,
        presentation_dialogues,
        effects,
        audio,
    }
}

fn empty_desc(project: &Project, frame: u32, total: u32) -> SceneDescriptor {
    SceneDescriptor {
        frame,
        width: project.canvas.width,
        height: project.canvas.height,
        fps: project.canvas.fps.max(1),
        duration_frames: total,
        camera: crate::timeline::CameraDesc { x: 0.0, y: 0.0, zoom: 1.0 },
        layers: Vec::new(),
        subtitles: Vec::new(),
        presentation_dialogues: Vec::new(),
        effects: Vec::new(),
        audio: Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo::create_demo;

    fn demo_project(tag: &str) -> Project {
        let dir = std::env::temp_dir().join(format!("sf-graph-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let result = create_demo(&dir).unwrap();
        let project = result.project;
        let _ = std::fs::remove_dir_all(&dir);
        project
    }

    #[test]
    fn linearize_default_path_picks_first_option() {
        let project = demo_project("lin");
        let path = linearize_default_path(&project.script);
        assert_eq!(path[0], "nd_entry");
        // selection 取第一个选项 → 分支 A
        assert!(path.contains(&"nd_branchA".to_string()));
        assert!(!path.contains(&"nd_branchB".to_string()));
        assert_eq!(path.last().map(|s| s.as_str()), Some("nd_exit"));
    }

    #[test]
    fn line_sequence_and_frame_locating() {
        let project = demo_project("seq");
        let path = linearize_default_path(&project.script);
        let spans = build_line_sequence(&project.script, &path);
        // 默认路径：120 + 120 + 120 = 360 帧
        assert_eq!(total_frames(&spans), 360);
        assert_eq!(spans[0].duration_frames, 120);
        assert_eq!(spans[1].start_frame, 120);

        let desc = evaluate(&project, &path, 100);
        assert_eq!(desc.frame, 100);
        assert_eq!(desc.duration_frames, 360);
        // 开场行：背景 + 角色 + BGM
        assert!(!desc.layers.is_empty());
        assert!(!desc.audio.is_empty());
        // 转场 fade 只作用于行首 15 帧
        let desc_fade = evaluate(&project, &path, 5);
        assert!(desc_fade
            .effects
            .iter()
            .any(|e| e.effect_type == crate::model::EffectType::Transition));
        assert!(!desc
            .effects
            .iter()
            .any(|e| e.effect_type == crate::model::EffectType::Transition));

        // 帧越界钳制
        let desc_end = evaluate(&project, &path, 9999);
        assert_eq!(desc_end.frame, 359);
    }

    #[test]
    fn subtitle_inherits_bg_and_shows_speaker() {
        let project = demo_project("sub");
        let path = linearize_default_path(&project.script);
        // 第 180 帧 = 第一段对话（120..240）
        let desc = evaluate(&project, &path, 180);
        assert!(!desc.subtitles.is_empty());
        assert!(desc.subtitles[0].text.contains("领航员"));
        assert_eq!(desc.presentation_dialogues[0].club_name, "StoryForge");
        assert_eq!(desc.presentation_dialogues[0].place_text, "");
        // 背景状态继承（对话行未指定背景 → 仍显示开场背景）
        assert!(desc.layers.iter().any(|l| l.asset_id == "ast_bg"));
    }

    #[test]
    fn branch_b_reachable_by_custom_path() {
        let project = demo_project("branch");
        // 手工路径：entry → open → dialog → choice → branchB → exit
        let path = vec![
            "nd_entry".to_string(),
            "nd_open".to_string(),
            "nd_dialog".to_string(),
            "nd_choice".to_string(),
            "nd_branchB".to_string(),
            "nd_exit".to_string(),
        ];
        let desc = evaluate(&project, &path, 370);
        assert!(desc.subtitles[0].text.contains("直接结束"));
    }

    #[test]
    fn presentation_dialogue_keeps_place_separate_from_club() {
        let project = demo_project("presentation");
        let path = vec![
            "nd_entry".to_string(),
            "nd_open".to_string(),
            "nd_dialog".to_string(),
            "nd_choice".to_string(),
            "nd_branchA".to_string(),
            "nd_exit".to_string(),
        ];
        let desc = evaluate(&project, &path, 255);
        assert_eq!(desc.presentation_dialogues.len(), 1);
        assert_eq!(desc.presentation_dialogues[0].club_name, "StoryForge");
        assert_eq!(desc.presentation_dialogues[0].place_text, "广场·夜晚");
        assert!(!desc.presentation_dialogues[0].text.contains("广场·夜晚"));
        assert_eq!(desc.presentation_dialogues[0].font_size, 48.0);
        assert_eq!(desc.presentation_dialogues[0].body_y, 886.0);
    }

    #[test]
    fn six_slot_presentation_dims_standby_and_keeps_highlight_on_top() {
        let project = demo_project("six-slots");
        let path = linearize_default_path(&project.script);
        let desc = evaluate(&project, &path, 180);
        let characters: Vec<_> = desc.layers.iter().filter(|layer| layer.id.starts_with("char_")).collect();
        assert_eq!(characters.len(), 6);
        assert!((characters.first().unwrap().x - 35.0).abs() < 1e-6);
        let highlighted = characters.iter().find(|layer| layer.tint == [255, 255, 255]).unwrap();
        assert!((highlighted.x - 775.0).abs() < 1e-6);
        assert_eq!(highlighted.z_index, Some(2_000));
        assert_eq!(characters.iter().filter(|layer| layer.tint == [153, 153, 153]).count(), 5);
    }

    #[test]
    fn typewriter_is_grapheme_safe_and_pauses_after_newline() {
        let (visible, complete) = typewriter_state("A👩‍🚀中", 2);
        assert_eq!(visible, "A👩‍🚀");
        assert!(!complete);
        let (visible, complete) = typewriter_state("甲\n乙", 8);
        assert_eq!(visible, "甲\n");
        assert!(!complete);
        let (visible, complete) = typewriter_state("甲\n乙", 9);
        assert_eq!(visible, "甲\n乙");
        assert!(complete);
    }
}
