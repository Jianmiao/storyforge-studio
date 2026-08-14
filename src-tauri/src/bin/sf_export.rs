//! 无 GUI 导出 CLI（验收与自动化用）：
//!   sf_export --demo --out <mp4> [--ffmpeg <path>] [--width W --height H --fps F]
//!   sf_export --project <dir> --out <mp4> [--ffmpeg <path>] [--width W --height H --fps F]
//! 成功打印 summary JSON（{ok, outputPath, frames, durationSec, width, height, fps}）。

use studio_core::demo;
use studio_core::ffmpeg;
use studio_core::project_io;
use studio_core::render::{render_project, RenderProgressEvent, RenderSpec};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let get = |name: &str| -> Option<String> {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };

    let demo_mode = args.iter().any(|a| a == "--demo");
    let project_dir = get("--project");
    let out = get("--out").unwrap_or_else(|| {
        eprintln!("缺少 --out <path>");
        std::process::exit(2);
    });
    let ffmpeg_path = get("--ffmpeg");
    let width = get("--width").and_then(|v| v.parse().ok()).unwrap_or(1920);
    let height = get("--height").and_then(|v| v.parse().ok()).unwrap_or(1080);
    let fps = get("--fps").and_then(|v| v.parse().ok()).unwrap_or(30);

    if !demo_mode && project_dir.is_none() {
        eprintln!("需要 --demo 或 --project <dir>");
        std::process::exit(2);
    }

    // 1) 准备项目
    let (project, dir) = if demo_mode {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let dir = std::env::temp_dir().join(format!("storyforge-demo-{ts}"));
        let result = demo::create_demo(&dir).expect("演示项目生成失败");
        (result.project, PathBuf::from(result.project_dir))
    } else {
        let dir = PathBuf::from(project_dir.unwrap());
        let opened = project_io::open_project(&dir.join("project.storyforge")).expect("项目打开失败");
        (opened.project, dir)
    };

    // 2) FFmpeg
    let ffmpeg = match ffmpeg_path {
        Some(p) => PathBuf::from(p),
        None => ffmpeg::detect_ffmpeg(None)
            .path
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                eprintln!("FFmpeg 未找到");
                std::process::exit(3);
            }),
    };

    // 3) 渲染
    let spec = RenderSpec {
        project,
        project_dir: dir.to_string_lossy().to_string(),
        path: vec![], // 空 = 默认路径（selection 取第一个选项）
        width,
        height,
        fps,
        codec: "h264".into(),
        crf: 18,
        preset: "veryfast".into(),
        audio_bitrate_kbps: 192,
        output_path: out.clone(),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_thread = cancel.clone();
    // Ctrl+C 优雅取消
    ctrlc::set_handler(move || {
        cancel_thread.store(true, Ordering::Relaxed);
    })
    .ok();

    let on_progress = |e: RenderProgressEvent| {
        if e.status == studio_core::render::RenderJobStatus::Running {
            eprintln!(
                "[{}/{}] {:.1} fps, ETA {:.0}s",
                e.frame,
                e.total,
                e.fps.unwrap_or(0.0),
                e.eta_sec.unwrap_or(0.0)
            );
        }
    };

    match render_project(&spec, "cli", &ffmpeg, &cancel, &on_progress) {
        Ok(path) => {
            let total_frames = spec_total_frames(&spec);
            let duration = total_frames as f64 / fps as f64;
            let summary = serde_json::json!({
                "ok": true,
                "outputPath": path.to_string_lossy(),
                "frames": total_frames,
                "durationSec": duration,
                "width": width,
                "height": height,
                "fps": fps,
            });
            println!("{}", serde_json::to_string(&summary).unwrap());
        }
        Err(e) => {
            let summary = serde_json::json!({
                "ok": false,
                "error": e.to_string(),
            });
            println!("{}", serde_json::to_string(&summary).unwrap());
            std::process::exit(1);
        }
    }
}

fn spec_total_frames(spec: &RenderSpec) -> u64 {
    use studio_core::graph;
    let path = if spec.path.is_empty() {
        graph::linearize_default_path(&spec.project.script)
    } else {
        spec.path.clone()
    };
    let spans = graph::build_line_sequence(&spec.project.script, &path);
    let total = graph::total_frames(&spans);
    if total > 0 {
        return total as u64;
    }
    spec.project
        .scenes
        .first()
        .map(|s| s.duration_frames as u64)
        .unwrap_or(0)
}
