// 发布版不弹控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod fonts;
mod shortcut;
mod state;
mod tray;
mod window;

use std::sync::atomic::Ordering;

use log::{error, info, warn};
// emit 在 Emitter trait 上，不在 Manager 上 —— 两个都要 use。
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        // 单实例必须最先注册：第二次启动应唤醒已有窗口，而不是再开一个应用
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::show_and_focus(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(shortcut::handle)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::load_state,
            commands::add_todo,
            commands::toggle_todo,
            commands::delete_todo,
            commands::clear_completed,
            commands::reorder_todos,
            commands::set_always_on_top,
            commands::hide_window,
            commands::show_window,
            commands::quit_app,
            commands::set_edge_collapsed,
            commands::unsnap_window,
            commands::minimize_to_edge,
            commands::upload_background,
            commands::reset_background,
            commands::read_background,
            commands::set_text_color,
            commands::set_mask_opacity,
            commands::set_blur,
            commands::list_fonts,
            commands::import_font,
            commands::read_font,
            commands::remove_font,
            commands::set_font,
            commands::reset_font,
            commands::apply_font_to_all,
            commands::runtime_info,
            commands::open_release_page,
            commands::save_window_position,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // 启动顺序（规格 §21）。以下每一步失败都不得阻止应用启动 ——
            // 背景丢了、字体文件没了，都不该让用户连窗口都看不到。
            let mut data = state::load(&handle);

            if fonts::prune_missing(&handle, &mut data) {
                let _ = state::save(&handle, &data);
            }

            if state::rollover(&mut data) > 0 {
                let _ = state::save(&handle, &data);
            }

            if let Err(e) = tray::build(&handle) {
                error!("托盘初始化失败: {e}");
            }

            // 快捷键可能抢不到，apply 会退回备选组合；这里把实际生效的写回配置，
            // 让界面上显示的和真正生效的一致。
            let requested = data.settings.shortcut.clone();
            let actual = shortcut::apply(&handle, &requested);
            if actual != requested {
                data.settings.shortcut = actual;
                if let Err(e) = state::save(&handle, &data) {
                    warn!("保存快捷键设置失败: {e}");
                }
            }

            window::init(&handle);
            info!("MiniMemo 启动完成");
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Moved(_) => {
                window::handle_moved(window.app_handle());
            }
            // 把系统级的窗口激活状态推给前端，由前端决定「鼠标扫过屏幕边缘
            // 要不要展开窗口」（需求 1）。
            //
            // 这里只发信号、不做决策：收缩要走 state::load（文件 IO），而这个
            // 回调在主线程上，不能在这里干。emit 只是往 webview 推一条 IPC 消息。
            //
            // 用 app_handle().emit 而不是 window.emit：AppHandle 确定实现了
            // Emitter，不必纠结 Window 那边的 trait 覆盖。整个应用只有一个
            // webview（label "main"），所以不需要判断来源。
            WindowEvent::Focused(focused) => {
                let _ = window.app_handle().emit("minimemo://focus-changed", *focused);
            }
            WindowEvent::CloseRequested { api, .. } => {
                // ✕ 只隐藏，不退出。真正的退出走托盘菜单。
                if !state::QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    window::hide(window.app_handle());
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("构建 Tauri 应用失败")
        .run(|_app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                // 窗口全关了也不退出进程，否则托盘和全局快捷键会一起消失
                if !state::QUITTING.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
        });
}
