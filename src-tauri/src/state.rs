//! 数据模型、持久化、损坏容错与跨日迁移。
//!
//! Rust 是数据的唯一权威来源：前端只持有一份用于渲染的镜像，任何修改都通过
//! command 落到这里再返回最新状态。这样可以避免「前端算出来的日期」和
//! 「Rust 落盘的日期」各说各话 —— 跨日归档对一致性要求很高。

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use chrono::Local;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// 托盘「退出」会把它置为 true，`RunEvent::ExitRequested` 据此放行，
/// 否则一律阻止退出以保持后台驻留。
pub static QUITTING: AtomicBool = AtomicBool::new(false);

pub const DATA_VERSION: u32 = 1;

/// 归档上限。archives 只增不减会随着时间无限膨胀，超出后丢弃最旧的记录。
const ARCHIVE_LIMIT: usize = 500;

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub priority: i32,
    /// YYYY-MM-DD，本地日期。跨日判断用它。
    #[serde(default)]
    pub created_date: String,
    /// Unix 毫秒。排序用它 —— createdDate 只精确到天，同一天内无法定序。
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub completed_at: Option<i64>,
    #[serde(default)]
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomFont {
    /// 内容哈希，同时用作磁盘文件名与去重键。
    pub id: String,
    /// 我们分配给它的 CSS family 名，保证是 ASCII 且不会撞上系统字体。
    pub family: String,
    /// 用户原始文件名，仅用于显示（必须以 textContent 渲染）。
    pub label: String,
    /// 相对于 app data 目录的路径，如 "fonts/3f2a...ttf"。
    pub file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub always_on_top: bool,
    pub window_mode: String,
    /// 上次执行跨日检查的本地日期。空字符串表示从未检查过（首次启动）。
    pub last_check_date: String,
    pub bg_type: String,
    pub bg_path: Option<String>,
    pub mask_opacity: f64,
    pub blur: f64,
    /// 便签正文使用的完整 CSS font-family 回退链。
    pub font_family: String,
    /// 当前生效的导入字体 id；使用系统字体或默认字体时为 None。
    pub font_id: Option<String>,
    pub custom_fonts: Vec<CustomFont>,
    pub window_position: Option<Position>,
    pub shortcut: String,
    pub edge_snap: bool,
    pub edge_threshold: i32,
    pub edge_handle_size: i32,
}

/// 便签正文的默认字体链。英文名在前、中文名在后：
/// Chromium 通过 DirectWrite 解析 family，中文名在部分系统上匹配不到，
/// 而英文名在所有 locale 下都稳定，最后兜底到 sans-serif。
pub const DEFAULT_FONT_CHAIN: &str =
    "\"Segoe UI\", \"Microsoft YaHei\", \"微软雅黑\", system-ui, sans-serif";

impl Default for Settings {
    fn default() -> Self {
        Self {
            always_on_top: true,
            window_mode: "expanded".into(),
            last_check_date: String::new(),
            bg_type: "mica".into(),
            bg_path: None,
            mask_opacity: 0.65,
            blur: 6.0,
            font_family: DEFAULT_FONT_CHAIN.into(),
            font_id: None,
            custom_fonts: Vec::new(),
            window_position: None,
            shortcut: "Alt+Space".into(),
            edge_snap: true,
            edge_threshold: 10,
            edge_handle_size: 4,
        }
    }
}

/// `#[serde(default)]` 放在容器上：缺字段时用 `Default::default()` 补齐，
/// 而不是让整个文件解析失败。这正是规格 §11.4 的「字段缺失 → 使用默认值补齐」。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppData {
    pub version: u32,
    pub settings: Settings,
    pub todos: Vec<Todo>,
    pub archives: Vec<Todo>,
}

// ---------------------------------------------------------------------------
// 时间辅助
// ---------------------------------------------------------------------------

pub fn today_string() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

pub fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

/// 应用数据目录。由 Tauri path API 解析（Windows 上是
/// `%APPDATA%\com.minimemo.app\`），绝不硬编码 %APPDATA%。
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn data_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("data.json"))
}

pub fn fonts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("fonts");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

/// 把损坏的文件挪到一边，保留现场供排查，绝不阻塞启动。
fn backup_broken(path: &PathBuf) {
    let stamp = Local::now().format("%Y%m%d%H%M%S");
    let target = path.with_file_name(format!("data.json.{stamp}.broken"));
    match fs::rename(path, &target) {
        Ok(()) => warn!("损坏的数据文件已备份到 {}", target.display()),
        Err(e) => error!("备份损坏数据文件失败: {e}"),
    }
}

fn migrate(data: &mut AppData) {
    if data.version < DATA_VERSION {
        info!("数据版本 {} -> {}", data.version, DATA_VERSION);
        data.version = DATA_VERSION;
    }
    // 老数据可能没有字体链，补上默认值而不是留空（空字符串会让 CSS 整体失效）
    if data.settings.font_family.trim().is_empty() {
        data.settings.font_family = DEFAULT_FONT_CHAIN.into();
    }
}

/// 读取状态。任何异常都降级为默认数据并继续启动。
pub fn load(app: &AppHandle) -> AppData {
    let path = match data_file(app) {
        Ok(p) => p,
        Err(e) => {
            error!("无法解析数据目录，使用默认数据: {e}");
            return AppData::default();
        }
    };

    if !path.exists() {
        info!("未找到 data.json，创建默认数据");
        return AppData::default();
    }

    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            error!("读取 data.json 失败: {e}");
            return AppData::default();
        }
    };

    match serde_json::from_str::<AppData>(&text) {
        Ok(mut data) => {
            migrate(&mut data);
            data
        }
        Err(e) => {
            error!("data.json 解析失败，回退到默认数据: {e}");
            backup_broken(&path);
            AppData::default()
        }
    }
}

/// 原子写入：临时文件 → flush → sync → rename。
/// Rust 的 `fs::rename` 在 Windows 上走 MoveFileEx(MOVEFILE_REPLACE_EXISTING)，
/// 因此覆盖已存在的文件也是原子的，不会出现半截 JSON。
pub fn save(app: &AppHandle, data: &AppData) -> Result<(), String> {
    let path = data_file(app)?;
    let tmp = path.with_file_name("data.json.tmp");

    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;

    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }

    fs::rename(&tmp, &path).map_err(|e| format!("替换 data.json 失败: {e}"))
}

// ---------------------------------------------------------------------------
// 跨日迁移
// ---------------------------------------------------------------------------

/// 已完成的今日任务归档，未完成的保留。
///
/// 返回归档条数。应用可能休眠或隐藏数天，所以这里只比对日期字符串，
/// 不做任何基于定时器的假设（规格 §10.2）。
pub fn rollover(data: &mut AppData) -> usize {
    let today = today_string();
    if data.settings.last_check_date == today {
        return 0;
    }

    let first_run = data.settings.last_check_date.is_empty();
    let mut archived = 0;

    if !first_run {
        let mut keep = Vec::new();
        for todo in data.todos.drain(..) {
            if todo.completed {
                let mut t = todo;
                t.archived_at = Some(now_ms());
                data.archives.push(t);
                archived += 1;
            } else {
                keep.push(todo);
            }
        }
        data.todos = keep;

        // archives 只增不减会无限膨胀，超出上限时丢最旧的
        if data.archives.len() > ARCHIVE_LIMIT {
            let excess = data.archives.len() - ARCHIVE_LIMIT;
            data.archives.drain(0..excess);
        }
    }

    data.settings.last_check_date = today;

    if archived > 0 {
        info!("跨日归档 {archived} 条已完成任务");
    }
    archived
}

// ---------------------------------------------------------------------------
// 排序
// ---------------------------------------------------------------------------

/// 未完成优先 → 同组内按创建时间倒序（新任务在前）。
/// 已完成的任务沉底，不在这里剔除。
pub fn sort_todos(todos: &mut [Todo]) {
    todos.sort_by(|a, b| {
        a.completed
            .cmp(&b.completed)
            .then(b.created_at.cmp(&a.created_at))
    });
}
