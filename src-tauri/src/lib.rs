use tauri::{
    Manager,
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Position, Size,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?
        .open_devtools();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .expect("Failed to load tray icon");

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("App Template")
                .on_tray_icon_event(|tray, event| {
                    let (rx, ry, rw, is_right) = match event {
                        TrayIconEvent::Click {
                            button,
                            button_state: MouseButtonState::Up,
                            rect,
                            ..
                        } => {
                            let (rx, ry) = match &rect.position {
                                Position::Physical(p) => (p.x as f64, p.y as f64),
                                Position::Logical(p) => (p.x, p.y),
                            };
                            let rw = match &rect.size {
                                Size::Physical(s) => s.width as f64,
                                Size::Logical(s) => s.width,
                            };
                            (rx, ry, rw, matches!(button, MouseButton::Right))
                        }
                        _ => return,
                    };

                    if is_right {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.emit("tray-popup", serde_json::json!({
                                "x": (rx + rw / 2.0) as i32,
                                "y": ry as i32,
                            }));
                        }
                    } else {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(true);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, open_devtools])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}