use crate::commands::BackendState;
use std::error::Error;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    App, AppHandle, Manager,
};

pub fn show_workbench(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();

    let backend = app.state::<BackendState>();
    if !backend.backend_is_running() {
        if let Some(url) = backend.bootstrap_url() {
            let _ = window.navigate(url);
        }
    }
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn Error>> {
    let handle = app.handle();
    let open_workbench = MenuItemBuilder::new("Open Workbench")
        .id("open_workbench")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(handle)?;
    let menu = MenuBuilder::new(handle)
        .items(&[
            &SubmenuBuilder::new(handle, "Axorbis")
                .item(&PredefinedMenuItem::about(handle, None, None)?)
                .separator()
                .item(&PredefinedMenuItem::hide(handle, None)?)
                .item(&PredefinedMenuItem::quit(handle, None)?)
                .build()?,
            &SubmenuBuilder::new(handle, "File")
                .item(&open_workbench)
                .separator()
                .item(&PredefinedMenuItem::close_window(handle, None)?)
                .build()?,
            &SubmenuBuilder::new(handle, "Edit")
                .item(&PredefinedMenuItem::undo(handle, None)?)
                .item(&PredefinedMenuItem::redo(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(handle, None)?)
                .item(&PredefinedMenuItem::copy(handle, None)?)
                .item(&PredefinedMenuItem::paste(handle, None)?)
                .item(&PredefinedMenuItem::select_all(handle, None)?)
                .build()?,
            &SubmenuBuilder::new(handle, "Window")
                .item(&PredefinedMenuItem::minimize(handle, None)?)
                .item(&PredefinedMenuItem::fullscreen(handle, None)?)
                .build()?,
        ])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "open_workbench" {
            show_workbench(app);
        }
    });
    Ok(())
}
