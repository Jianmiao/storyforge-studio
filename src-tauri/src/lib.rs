pub mod commands;

use commands::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::ffmpeg_detect,
            commands::project_save,
            commands::project_open,
            commands::demo_create,
            commands::assets_import,
            commands::assets_relocate,
            commands::assets_check,
            commands::preview_frame,
            commands::render_start,
            commands::render_cancel,
            commands::render_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running StoryForge Studio");
}
