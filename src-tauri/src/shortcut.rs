//! 全局快捷键注册。
//!
//! 只注册一个快捷键，因此 handler 不需要按快捷键分发，按下即切换窗口显隐。
//!
//! 需要留意：`Alt+Space` 是 Windows 的系统保留组合（打开窗口系统菜单），
//! 能否稳定抢占并不确定。所以注册失败时自动退到备选组合，而不是让应用
//! 静默地没有快捷键 —— 快捷键是这个应用最核心的入口，不能悄悄失效。

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};

use log::{info, warn};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{
    GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState,
};

use crate::window;

/// 当前是否有一个快捷键真正处于注册状态。
pub static REGISTERED: AtomicBool = AtomicBool::new(false);

/// 备选组合。用户配置或默认值抢不到时用它兜底。
const FALLBACK: &str = "Ctrl+Alt+Space";

/// 插件回调。注册了几个快捷键就会对每个都回调，因此必须按 state 过滤，
/// 否则按下和松开会各触发一次，窗口闪两下。
pub fn handle(app: &AppHandle, _shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state == ShortcutState::Pressed {
        window::toggle_visibility(app);
    }
}

/// 注册快捷键，失败时退到备选。返回实际生效的组合。
pub fn apply(app: &AppHandle, binding: &str) -> String {
    let gs = app.global_shortcut();

    // 换绑前先清掉旧的，否则会同时存在两个生效的快捷键
    let _ = gs.unregister_all();

    match try_register(app, binding) {
        Ok(()) => return binding.to_string(),
        Err(e) => {
            warn!("注册快捷键 {binding} 失败: {e}");
        }
    }

    match try_register(app, FALLBACK) {
        Ok(()) => {
            warn!("已退回到备选快捷键 {FALLBACK}");
            FALLBACK.to_string()
        }
        Err(e) => {
            warn!("备选快捷键 {FALLBACK} 也不可用: {e}；应用仍可通过托盘使用");
            REGISTERED.store(false, Ordering::SeqCst);
            binding.to_string()
        }
    }
}

fn try_register(app: &AppHandle, binding: &str) -> Result<(), String> {
    let sc = Shortcut::from_str(binding).map_err(|e| format!("无法解析: {e}"))?;
    app.global_shortcut()
        .register(sc)
        .map_err(|e| format!("注册被拒绝: {e}"))?;

    REGISTERED.store(true, Ordering::SeqCst);
    info!("已注册全局快捷键 {binding}");
    Ok(())
}
