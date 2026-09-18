mod commands;
mod menu;
mod tray;

use commands::BackendState;
use tauri::{Manager, RunEvent, WindowEvent};

pub fn run() {
    let backend = BackendState::default();
    let shutdown_backend = backend.clone();

    tauri::Builder::default()
        .manage(backend)
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::desktop_info,
            commands::choose_workspace,
            commands::start_backend,
            commands::stop_backend,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                app.state::<BackendState>().set_bootstrap_url(window.url()?);
            }
            menu::setup(app)?;
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the Feynman desktop application")
        .run(move |_app, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                shutdown_backend.stop();
            }
        });
}
