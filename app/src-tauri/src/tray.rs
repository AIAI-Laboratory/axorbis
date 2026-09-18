use crate::menu::show_workbench;
use std::error::Error;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App,
};

pub fn setup(app: &mut App) -> Result<(), Box<dyn Error>> {
    let handle = app.handle();
    let open_workbench = MenuItemBuilder::new("Open Workbench")
        .id("open_workbench")
        .build(handle)?;
    let quit = MenuItemBuilder::new("Quit Axorbis")
        .id("quit")
        .build(handle)?;
    let menu = MenuBuilder::new(handle)
        .item(&open_workbench)
        .separator()
        .item(&quit)
        .build()?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Axorbis Research Workspace")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_workbench" => show_workbench(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_workbench(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
