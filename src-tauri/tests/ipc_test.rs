//! Tauri 命令层集成测试：直接调用真实命令实现（不经过 WebView），
//! 验证 IPC 契约：项目保存/打开、演示项目、预览求值、素材导入、渲染任务。

use serde_json::json;
use std::path::PathBuf;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

use storyforge_lib::commands::{
    assets_check, assets_import, demo_create, ffmpeg_detect, preview_frame, project_open,
    project_save, AppState,
};

fn temp_dir(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("sf-ipc-{tag}-{}", std::process::id()))
}

fn mock_handle() -> tauri::AppHandle<tauri::test::MockRuntime> {
    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("mock app");
    app.handle().manage(AppState::default());
    app.handle().clone()
}

#[test]
fn project_save_and_open_roundtrip_via_command() {
    let handle = mock_handle();
    let dir = temp_dir("roundtrip");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("project.storyforge");

    // 用演示项目作为文档
    let demo = demo_create(Some(dir.to_string_lossy().to_string()), handle).expect("demo_create");
    assert_eq!(demo.project.meta.name, "演示项目");
    assert_eq!(demo.project.scenes[0].duration_frames, 360);

    // 保存（原子写）→ 打开（含迁移）→ 校验
    let save = project_save(path.to_string_lossy().to_string(), demo.project.clone()).expect("save");
    assert_eq!(save.path, path.to_string_lossy().to_string());
    let opened = project_open(path.to_string_lossy().to_string()).expect("open");
    assert_eq!(opened.project.scenes[0].id, "scn_demo");
    assert!(opened.recovered_from.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn preview_frame_evaluates_demo_project() {
    let handle = mock_handle();
    let dir = temp_dir("preview");
    std::fs::create_dir_all(&dir).unwrap();
    let demo = demo_create(Some(dir.to_string_lossy().to_string()), handle).expect("demo_create");
    let desc = preview_frame(demo.project, "scn_demo".into(), 90).expect("preview_frame");
    assert_eq!(desc.frame, 90);
    assert_eq!(desc.width, 1920);
    assert_eq!(desc.height, 1080);
    // 第 90 帧：背景 + 角色 + 字幕 1 + BGM + 暗角
    assert!(!desc.layers.is_empty());
    assert!(!desc.subtitles.is_empty());
    assert_eq!(desc.subtitles[0].text, "第一段台词：欢迎来到 StoryForge。");
    assert!(!desc.audio.is_empty());
    assert!(desc
        .effects
        .iter()
        .any(|e| e.effect_type == studio_core::model::EffectType::Vignette));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn assets_import_rejects_unsupported_and_check_assets() {
    let _handle = mock_handle();
    let dir = temp_dir("assets");
    std::fs::create_dir_all(&dir).unwrap();
    let demo = demo_create(
        Some(dir.to_string_lossy().to_string()),
        tauri::test::mock_builder()
            .build(mock_context(noop_assets()))
            .expect("app")
            .handle()
            .clone(),
    )
    .expect("demo_create");
    let project_dir = dir.to_string_lossy().to_string();

    // 不支持的类型
    let bad = dir.join("evil.exe");
    std::fs::write(&bad, b"MZ").unwrap();
    let result =
        assets_import(project_dir.clone(), vec![bad.to_string_lossy().to_string()]).expect("import");
    assert!(result.assets.is_empty());
    assert_eq!(result.failed.len(), 1);

    // 演示素材全部存在
    let status = assets_check(project_dir, demo.project.clone()).expect("check");
    assert!(status.iter().all(|s| !s.missing));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn render_queue_rejects_when_ffmpeg_missing() {
    let handle = mock_handle();
    let dir = temp_dir("render");
    std::fs::create_dir_all(&dir).unwrap();
    let demo = demo_create(
        Some(dir.to_string_lossy().to_string()),
        mock_handle(),
    )
    .expect("demo_create");

    // 手动指定不存在的路径 → 未找到
    let info = ffmpeg_detect(
        Some("C:\\definitely\\missing\\ffmpeg.exe".into()),
        handle.state::<AppState>(),
    );
    assert!(!info.found);

    // 未找到 FFmpeg 时 render_start 拒绝
    let spec = studio_core::render::RenderSpec {
        project: demo.project,
        project_dir: dir.to_string_lossy().to_string(),
        scene_id: Some("scn_demo".into()),
        width: 320,
        height: 180,
        fps: 10,
        codec: "h264".into(),
        crf: 28,
        preset: "ultrafast".into(),
        audio_bitrate_kbps: 64,
        output_path: dir.join("out.mp4").to_string_lossy().to_string(),
    };
    let err = storyforge_lib::commands::render_start(
        spec,
        handle.state::<AppState>(),
        handle.clone(),
    )
    .expect_err("应因 FFmpeg 缺失而拒绝");
    assert!(err.contains("FFmpeg 未找到"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn ffmpeg_detect_finds_real_ffmpeg_when_available() {
    let handle = mock_handle();
    let info = ffmpeg_detect(None, handle.state::<AppState>());
    if std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        assert!(info.found, "PATH 中存在 ffmpeg 却未检测到");
    }
    let _ = json!(info);
}
