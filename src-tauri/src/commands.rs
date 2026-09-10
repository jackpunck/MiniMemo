//! 暴露给前端的 Tauri command。
//!
//! 约定：所有会修改数据的 command 都返回完整的 `AppData`，前端拿到后整体重绘。
//! 这样前端不需要自己推演状态变化，也就不会和落盘的数据产生分歧。
//!
//! 标了 `(async)` 的 command 会在线程池上执行 —— 它们都做文件 IO，
//! 放在主线程上会卡住窗口。

use std::sync::atomic::Ordering;

use base64::Engine;
use log::{info, warn};
use serde::Serialize;
use tauri::{ipc::Response, AppHandle, Manager};

use crate::fonts;
use crate::state::{self, AppData, Position};
use crate::window;

/// 背景图片的体积上限。
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/// 读取当前状态，顺带执行跨日检查与排序。
fn current(app: &AppHandle) -> AppData {
    let mut data = state::load(app);

    if state::rollover(&mut data) > 0 {
        if let Err(e) = state::save(app, &data) {
            warn!("跨日归档后保存失败: {e}");
        }
    }

    state::sort_todos(&mut data.todos);
    data
}

/// 读 → 改 → 排序 → 落盘，返回最新状态。
fn mutate<F>(app: &AppHandle, f: F) -> Result<AppData, String>
where
    F: FnOnce(&mut AppData) -> Result<(), String>,
{
    let mut data = state::load(app);
    state::rollover(&mut data);
    f(&mut data)?;
    state::sort_todos(&mut data.todos);
    state::save(app, &data)?;
    Ok(data)
}

fn new_id(prefix: &str) -> String {
    use std::sync::atomic::AtomicU64;
    static SEQ: AtomicU64 = AtomicU64::new(0);
    // 毫秒 + 自增序号：同一毫秒内连续添加也不会撞 id
    format!(
        "{prefix}_{}_{}",
        state::now_ms(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

fn decode_b64(payload: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("数据解码失败: {e}"))
}

// ---------------------------------------------------------------------------
// 状态读写
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn load_state(app: AppHandle) -> AppData {
    current(&app)
}

#[tauri::command(async)]
pub fn add_todo(app: AppHandle, text: String) -> Result<AppData, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        // 空白输入不是错误，只是什么都不做
        return Ok(current(&app));
    }

    mutate(&app, |data| {
        data.todos.push(state::Todo {
            id: new_id("todo"),
            text,
            completed: false,
            priority: 1,
            created_date: state::today_string(),
            created_at: state::now_ms(),
            completed_at: None,
            archived_at: None,
        });
        Ok(())
    })
}

#[tauri::command(async)]
pub fn toggle_todo(app: AppHandle, id: String) -> Result<AppData, String> {
    mutate(&app, |data| {
        let todo = data
            .todos
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| format!("找不到任务 {id}"))?;

        todo.completed = !todo.completed;
        todo.completed_at = if todo.completed {
            Some(state::now_ms())
        } else {
            None
        };
        Ok(())
    })
}

#[tauri::command(async)]
pub fn delete_todo(app: AppHandle, id: String) -> Result<AppData, String> {
    mutate(&app, |data| {
        data.todos.retain(|t| t.id != id);
        Ok(())
    })
}

#[tauri::command(async)]
pub fn clear_completed(app: AppHandle) -> Result<AppData, String> {
    mutate(&app, |data| {
        data.todos.retain(|t| !t.completed);
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

#[tauri::command(async)]
pub fn set_always_on_top(app: AppHandle, value: bool) -> Result<AppData, String> {
    window::apply_always_on_top(&app, value)?;
    mutate(&app, |data| {
        data.settings.always_on_top = value;
        Ok(())
    })
}

#[tauri::command(async)]
pub fn hide_window(app: AppHandle) {
    window::hide(&app);
}

#[tauri::command(async)]
pub fn show_window(app: AppHandle) {
    window::show_and_focus(&app);
}

/// 真正退出。托盘菜单调用它，标题栏的 ✕ 只会隐藏窗口。
#[tauri::command(async)]
pub fn quit_app(app: AppHandle) {
    state::QUITTING.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// 边缘态展开/收缩。前端在鼠标进出感应条时调用。
#[tauri::command(async)]
pub fn set_edge_collapsed(app: AppHandle, collapsed: bool) -> Result<(), String> {
    window::set_edge_collapsed(&app, collapsed)
}

/// 把窗口从边缘拉回来（Esc 或托盘菜单用）。
#[tauri::command(async)]
pub fn unsnap_window(app: AppHandle) -> Result<(), String> {
    window::unsnap(&app)
}

// ---------------------------------------------------------------------------
// 背景
// ---------------------------------------------------------------------------

fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    None
}

/// 接收前端上传的图片字节，复制进 app data 并设为背景。
#[tauri::command(async)]
pub fn upload_background(app: AppHandle, data: String) -> Result<AppData, String> {
    let bytes = decode_b64(&data)?;

    if bytes.is_empty() {
        return Err("图片内容为空".into());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("图片过大（上限 32 MB）".into());
    }

    let ext = sniff_image(&bytes).ok_or("无法识别的图片格式，仅支持 png / jpg / webp")?;

    let dir = state::data_dir(&app)?;
    let filename = format!("bg_image.{ext}");
    let dest = dir.join(&filename);

    // 换扩展名时要清掉上一张，否则会在数据目录里留下孤儿文件
    for old in ["png", "jpg", "webp"] {
        let stale = dir.join(format!("bg_image.{old}"));
        if stale != dest && stale.exists() {
            let _ = std::fs::remove_file(stale);
        }
    }

    std::fs::write(&dest, &bytes).map_err(|e| format!("保存背景失败: {e}"))?;
    info!("背景已更新为 {filename}");

    mutate(&app, |d| {
        d.settings.bg_type = "image".into();
        d.settings.bg_path = Some(filename.clone());
        Ok(())
    })
}

#[tauri::command(async)]
pub fn reset_background(app: AppHandle) -> Result<AppData, String> {
    let dir = state::data_dir(&app)?;
    for ext in ["png", "jpg", "webp"] {
        let stale = dir.join(format!("bg_image.{ext}"));
        if stale.exists() {
            let _ = std::fs::remove_file(stale);
        }
    }

    mutate(&app, |d| {
        d.settings.bg_type = "mica".into();
        d.settings.bg_path = None;
        Ok(())
    })
}

/// 读取背景图片原始字节，前端转成 blob URL 显示。
#[tauri::command(async)]
pub fn read_background(app: AppHandle) -> Result<Response, String> {
    let data = state::load(&app);
    let name = data
        .settings
        .bg_path
        .ok_or("当前没有自定义背景")?;

    // 只允许读数据目录下的 bg_image.*，杜绝路径逃逸
    if !name.starts_with("bg_image.") || name.contains(['/', '\\']) {
        return Err("非法的背景路径".into());
    }

    let path = state::data_dir(&app)?.join(&name);
    let bytes = std::fs::read(&path).map_err(|e| format!("读取背景失败: {e}"))?;
    Ok(Response::new(bytes))
}

// ---------------------------------------------------------------------------
// 字体
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontOption {
    /// 下拉列表里显示的名字。
    pub name: String,
    /// 可直接赋给 CSS 的完整回退链，前端不必自己拼。
    pub css: String,
    pub builtin: bool,
    /// 导入字体的 id；选择它之后前端需要先 ensureFont 加载字节。
    pub id: Option<String>,
}

/// 返回可选字体：系统字体（builtin=true）+ 已导入字体（builtin=false）。
#[tauri::command(async)]
pub fn list_fonts(app: AppHandle) -> Vec<FontOption> {
    let data = state::load(&app);

    let mut out: Vec<FontOption> = fonts::list_families()
        .into_iter()
        .map(|name| FontOption {
            css: fonts::chain_for(&name),
            name,
            builtin: true,
            id: None,
        })
        .collect();

    // 已导入的排在前面：它们数量少、且是用户主动添加的
    let mut custom: Vec<FontOption> = data
        .settings
        .custom_fonts
        .iter()
        .map(|f| FontOption {
            name: f.label.clone(),
            css: fonts::chain_for(&f.family),
            builtin: false,
            id: Some(f.id.clone()),
        })
        .collect();

    custom.append(&mut out);
    custom
}

/// 导入字体。`data` 是前端 `<input type="file">` 读出的字节（base64）。
#[tauri::command(async)]
pub fn import_font(app: AppHandle, name: String, data: String) -> Result<AppData, String> {
    let bytes = decode_b64(&data)?;
    let font = fonts::import_bytes(&app, &name, &bytes)?;
    let css = fonts::chain_for(&font.family);

    mutate(&app, |d| {
        // 同内容重复导入时只保留一条
        d.settings.custom_fonts.retain(|f| f.id != font.id);
        d.settings.custom_fonts.push(font.clone());

        // 导入后立即启用
        d.settings.font_family = css.clone();
        d.settings.font_id = Some(font.id.clone());
        Ok(())
    })
}

/// 读取已导入字体的原始字节 → 前端得到 ArrayBuffer → new FontFace(family, buf)。
#[tauri::command(async)]
pub fn read_font(app: AppHandle, id: String) -> Result<Response, String> {
    let data = state::load(&app);
    let font = data
        .settings
        .custom_fonts
        .iter()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("找不到字体 {id}"))?;

    fonts::read(&app, &font.file)
}

#[tauri::command(async)]
pub fn remove_font(app: AppHandle, id: String) -> Result<AppData, String> {
    let data = state::load(&app);
    if let Some(font) = data.settings.custom_fonts.iter().find(|f| f.id == id) {
        if let Ok(dir) = state::fonts_dir(&app) {
            let name = font.file.strip_prefix("fonts/").unwrap_or(&font.file);
            let _ = std::fs::remove_file(dir.join(name));
        }
    }

    mutate(&app, |d| {
        d.settings.custom_fonts.retain(|f| f.id != id);
        if d.settings.font_id.as_deref() == Some(id.as_str()) {
            d.settings.font_id = None;
            d.settings.font_family = state::DEFAULT_FONT_CHAIN.into();
        }
        Ok(())
    })
}

/// 设置正文字体。`family` 为完整 CSS 回退链，`id` 为导入字体 id（可选）。
#[tauri::command(async)]
pub fn set_font(app: AppHandle, family: String, id: Option<String>) -> Result<AppData, String> {
    let family = family.trim().to_string();
    if family.is_empty() {
        return Err("字体不能为空".into());
    }

    mutate(&app, |d| {
        d.settings.font_family = family.clone();
        d.settings.font_id = id.clone();
        Ok(())
    })
}

/// 恢复默认字体。
#[tauri::command(async)]
pub fn reset_font(app: AppHandle) -> Result<AppData, String> {
    mutate(&app, |d| {
        d.settings.font_family = state::DEFAULT_FONT_CHAIN.into();
        d.settings.font_id = None;
        Ok(())
    })
}

// ---------------------------------------------------------------------------
// 运行时信息
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub data_dir: String,
    pub shortcut: String,
    pub shortcut_active: bool,
    pub today: String,
    pub version: String,
}

#[tauri::command(async)]
pub fn runtime_info(app: AppHandle) -> RuntimeInfo {
    let data = state::load(&app);
    RuntimeInfo {
        data_dir: state::data_dir(&app)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        shortcut: data.settings.shortcut.clone(),
        shortcut_active: crate::shortcut::REGISTERED.load(Ordering::SeqCst),
        today: state::today_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// 保存窗口位置。前端在窗口移动后调用；位置校验在 window 模块里做。
#[tauri::command(async)]
pub fn save_window_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    mutate(&app, |d| {
        d.settings.window_position = Some(Position { x, y });
        Ok(())
    })
    .map(|_| ())
}
