# MiniMemo Agent 开发需求规格

> 文档用途：本文件面向负责实现 MiniMemo 的 Coding Agent / AI Agent。Agent 应将本文视为项目实现基准，优先满足“可运行、轻量、键盘优先、Windows 原生体验”，而不是简单复刻原型页面。
>
> 产品名称：**MiniMemo**
>
> 目标平台：**Windows 10/11，优先 Windows 11**
>
> 核心技术：**Tauri 2.x + Rust + Windows WebView2 + Vanilla HTML/CSS/JavaScript**
>
> 设计目标：**极致轻量、低干扰、常驻桌面、键盘优先、单任务快速记录**。

---

## 1. 产品目标

MiniMemo 是一个常驻 Windows 桌面的极简“今日待办”浮窗。用户无需打开完整 Todo 应用，只需要通过全局快捷键唤起一个小窗口，输入任务并按 Enter 保存。

### 1.1 核心使用场景

1. 用户想到一件事情 → 快捷键唤起 MiniMemo → 输入 → Enter → 完成记录。
2. 用户查看今日任务 → 勾选完成 → 已完成任务自动沉底。
3. 用户暂时不想看到窗口 → 隐藏/边缘吸附。
4. 用户需要持续查看 → 开启置顶。
5. 用户希望桌面更有个性 → 设置本地背景图片。
6. 日期发生变化 → 昨日任务按规则自动处理，不丢失未完成事项。

### 1.2 非目标

首版不要做以下功能，避免产品膨胀：

- 云同步
- 账号系统
- 网络服务
- 多设备同步
- 团队协作
- 复杂项目管理
- 日历系统
- 标签系统
- 富文本编辑器
- Markdown 编辑器
- 第三方登录
- 第三方数据库

---

# 2. 技术约束

## 2.1 技术栈

### Backend

- Rust
- Tauri 2.x
- Tauri Window API
- Tauri App/Path API
- Tauri Plugin Global Shortcut
- Tauri Plugin Dialog
- Tauri Plugin Store 或等价轻量 JSON 持久化方案
- Tauri Tray API

### Frontend

- Vanilla HTML
- Vanilla CSS
- Vanilla JavaScript
- 不引入 React/Vue/Svelte 等大型 UI 框架
- 不依赖运行时 npm UI 组件库

### Windows

- WebView2
- Win10/Win11 均可运行
- 优先针对 Win11 的透明、亚克力/Mica 风格体验进行优化

---

# 3. 产品硬性指标

以下指标作为设计目标，不应在没有必要时突破：

| 指标 | 目标 |
|---|---|
| 默认窗口尺寸 | 280 × 380 px |
| 胶囊尺寸 | 280 × 46 px |
| 边缘吸附 | 距屏幕边缘 ≤ 10 px 触发 |
| 吸附后可视拉手 | 约 4 px |
| 默认置顶 | 开启 |
| 默认背景 | 半透明亚克力/毛玻璃风格 |
| 数据存储 | 本地 JSON |
| 网络依赖 | 无 |
| Todo 保存 | 每次状态变化立即持久化 |
| Enter 添加任务 | 必须 |
| 全局快捷键 | 必须 |
| 托盘驻留 | 必须 |
| 应用关闭后任务不丢失 | 必须 |
| 跨日任务处理 | 必须 |

> 包体大小与内存仅作为优化目标，不应为了追求数字牺牲稳定性。最终体积取决于 Tauri/WebView2/构建方式；Agent 不应把“4~8 MB”视为绝对验收条件。

---

# 4. UX 原则

## 4.1 Zero Friction

用户完成一次添加任务最多需要：

`快捷键 → 输入 → Enter`

不要求点击按钮、不弹确认框、不跳转页面。

## 4.2 Keyboard First

核心操作全部支持键盘：

- 全局快捷键：唤起/隐藏
- Enter：添加任务
- Esc：关闭/隐藏窗口
- 上下方向键：在输入区/任务区之间的后续扩展接口中保留可能性

首版至少保证 Enter 和 Esc 行为自然可靠。

## 4.3 No Distraction

不能出现：

- 启动广告
- 欢迎页
- 强制登录
- 设置向导
- 弹窗确认添加任务
- 大面积动画
- 高频闪烁

动画只能用于状态变化与窗口展开/收缩，时间约 150~300ms。

---

# 5. 窗口设计

## 5.1 窗口属性

初始窗口：

```text
width: 280
height: 380
resizable: false
decorations: false
transparent: true
alwaysOnTop: true
skipTaskbar: true
visible: true
```

实现时应根据 Tauri 2.x 实际 API/配置格式调整，不要机械复制旧版配置。

## 5.2 窗口圆角

设计圆角约 12px。

窗口透明时，真正的系统窗口圆角与 WebView 内容圆角可能存在差异。Agent 必须在 Windows 实际运行验证：

- 四角是否透明干净
- 背景是否溢出圆角
- 鼠标是否仍可正常点击
- 拖动区域是否准确

## 5.3 启动位置

默认建议：

- Windows 工作区右上方
- 距右侧约 16~24 px
- 距顶部约 60~100 px

不要默认出现在屏幕正中央，以避免遮挡当前工作。

若已有用户上次窗口位置，则优先恢复上次位置。

## 5.4 多显示器

首版最低要求：

- 窗口不得出现在不可见区域
- 启动时若保存位置已失效，应自动回退到主屏可见区域

增强要求：根据当前鼠标所在显示器恢复窗口。

---

# 6. 窗口模式

MiniMemo 至少有三种状态：

```text
EXPANDED  展开态
CAPSULE   胶囊态
EDGE      边缘吸附态
HIDDEN    隐藏态
```

## 6.1 EXPANDED

尺寸：280 × 380

内容完整显示：

- 标题栏
- 输入框
- Todo 列表
- 底部进度

## 6.2 CAPSULE

尺寸：280 × 46

只保留：

- MiniMemo 标题
- 少量操作按钮
- 可选今日进度，例如 `1/3`

胶囊态主要用于降低视觉干扰。

## 6.3 EDGE

窗口贴近屏幕边缘时自动进入吸附态。

默认策略：

```text
距离屏幕边缘 <= 10px
→ 吸附
→ 自动隐藏大部分窗口
→ 留约 4px 感应条
```

鼠标进入感应区后：

```text
Hover
→ 展开
```

鼠标移开后建议延迟约 300~600ms 再收回，避免抖动。

Agent 应避免“鼠标移动经过边缘导致频繁展开/收缩”的体验问题。

## 6.4 HIDDEN

隐藏后：

- 不显示窗口
- 后台继续驻留
- 全局快捷键仍有效
- 托盘仍有效

---

# 7. UI 结构

```text
┌─────────────────────────────────────┐
│ :::  MiniMemo       [🖼] [📌] [✕]   │  28px
├─────────────────────────────────────┤
│ + 输入今日任务，回车添加...          │  34px
├─────────────────────────────────────┤
│ [ ] 整理学术讨论纪要             [×] │
│ [ ] 验证模型采样重排逻辑         [×] │
│ [x] 更新项目环境依赖                  │
│                                     │
│                                     │
├─────────────────────────────────────┤
│ 进度: 1/3                    清空已完成│
└─────────────────────────────────────┘
```

## 7.1 顶部标题栏

元素：

- 拖拽区域
- 产品名 `MiniMemo`
- 背景按钮
- 置顶按钮
- 关闭/隐藏按钮

建议图标：使用 SVG/纯文本字符，而不是依赖大型图标库。

## 7.2 输入框

默认 placeholder：

`+ 输入今日任务，回车添加...`

行为：

- 获得焦点时轻微高亮
- Enter 添加
- 空字符串忽略
- 前后空格自动清理
- 添加成功后清空
- 添加后保持 focus
- 添加后不弹通知

## 7.3 Todo 列表

每项：

```text
checkbox + text + delete button
```

要求：

- 未完成优先显示
- 已完成沉底
- 文本超长显示省略号
- 鼠标悬停才显示删除按钮
- 删除操作即时保存
- 列表可滚动

### 已完成视觉

```css
text-decoration: line-through;
opacity: 0.4~0.5;
```

不应将已完成任务永久删除，除非用户点击“清空已完成”。

---

# 8. Todo 状态机

每个 Todo 至少包含：

```ts
interface Todo {
  id: string;
  text: string;
  completed: boolean;
  priority: number;
  createdDate: string; // YYYY-MM-DD
  completedAt?: string;
}
```

状态：

```text
ACTIVE
  ↓ 勾选
COMPLETED
  ↓ 清空已完成
DELETED

ACTIVE
  ↓ 跨日
继续保留并进入今日列表

COMPLETED
  ↓ 跨日
ARCHIVED
```

---

# 9. 任务排序规则

默认排序：

1. 今日未完成任务
2. 历史未完成任务
3. 今日已完成任务
4. 历史完成任务不直接展示，进入 archive

同组内遵循创建时间倒序，即新添加任务排在前面。

若未来增加 priority，排序建议：

```text
completed 分组优先于 priority
priority 高的未完成任务优先
同 priority 使用 createdAt 倒序
```

首版 priority 可继续保留字段，但不必实现复杂优先级 UI。

---

# 10. 跨日逻辑

这是核心功能，Agent 必须单独实现并测试。

## 10.1 检测时机

至少在：

- 应用首次启动
- 应用从隐藏状态恢复
- 应用进入前台
- 每日首次交互

执行日期检查。

## 10.2 判断日期

不能依赖 `setTimeout` 精确跨过零点，因为应用可能处于休眠/隐藏状态。

应读取本地系统日期：

```text
today = localDate()
lastCheckDate = settings.lastCheckDate
```

如果：

```text
lastCheckDate != today
```

触发日期迁移逻辑。

## 10.3 迁移规则

### 已完成项

全部进入 `archives`。

### 未完成项

继续保留。

并在 UI 中标识为历史遗留任务，例如：

```text
[昨日] 修复XX问题
```

但首版也允许只通过排序体现“历史未完成”。

### lastCheckDate

处理结束后更新为今天。

---

# 11. 数据存储

## 11.1 存储要求

优先使用应用数据目录：

```text
%APPDATA%/MiniMemo/
```

例如：

```text
MiniMemo/
├── data.json
└── bg_image.png
```

实际目录应通过 Tauri path API 获取，不要硬编码 `%APPDATA%` 字符串。

## 11.2 推荐数据结构

```json
{
  "version": 1,
  "settings": {
    "alwaysOnTop": true,
    "windowMode": "expanded",
    "lastCheckDate": "2026-09-10",
    "bgType": "mica",
    "bgPath": null,
    "maskOpacity": 0.65,
    "blur": 6,
    "windowPosition": {
      "x": null,
      "y": null
    }
  },
  "todos": [
    {
      "id": "todo_1710001",
      "text": "整理学术讨论纪要",
      "completed": false,
      "priority": 1,
      "createdDate": "2026-09-10",
      "completedAt": null
    }
  ],
  "archives": []
}
```

## 11.3 持久化策略

以下操作后必须保存：

- 新增任务
- 勾选任务
- 删除任务
- 清空已完成
- 修改置顶状态
- 修改背景
- 修改窗口位置
- 日期归档

## 11.4 数据损坏容错

如果 `data.json`：

- 不存在 → 创建默认数据
- JSON 无法解析 → 备份损坏文件，然后恢复默认数据
- 字段缺失 → 使用默认值补齐
- version 旧 → 执行 migration

不要因为数据文件异常而导致应用无法启动。

---

# 12. 背景系统

## 12.1 默认背景

首选：

```text
Windows Mica/Acrylic 风格
```

如果当前系统/API/窗口透明机制无法稳定获得真正的系统材质，则使用 CSS 模拟：

```css
background: rgba(...);
backdrop-filter: blur(...);
```

不要为了“真正 Mica”引入大型第三方 UI 框架。

## 12.2 自定义图片

点击 🖼️：

```text
打开原生文件选择器
↓
允许 png/jpg/jpeg/webp
↓
用户选择图片
↓
Rust 获取文件路径
↓
复制/缓存到 app data 目录
↓
更新 data.json
↓
前端立即刷新背景
```

## 12.3 图片缓存

不能直接永久依赖用户原图路径。

原因：原图片可能被：

- 移动
- 重命名
- 删除

因此要复制到 MiniMemo 自己的数据目录。

推荐文件名：

```text
bg_image.<ext>
```

更稳妥的实现可以使用 SHA-256/内容哈希生成稳定名称，但首版无需过度工程化。

## 12.4 背景恢复默认

右键菜单增加：

`恢复默认亚克力毛玻璃`

恢复后：

```json
"bgType": "mica",
"bgPath": null
```

---

# 13. 视觉规范

## 13.1 色彩

前景：

```text
主文字 #FFFFFF / #F5F5F7
辅助文字 rgba(255,255,255,.60)
弱文字 rgba(255,255,255,.35~.40)
```

背景遮罩：

```text
rgba(18,18,18,0.65)
```

边框：

```text
rgba(255,255,255,0.12~0.15)
```

## 13.2 圆角

- 主窗口：12px
- 输入框：6~8px
- Todo：6px
- 小按钮：6px

## 13.3 动画

动画应克制：

- hover：约 100~150ms
- Todo 状态变化：约 200ms
- 展开/收缩：约 200~300ms

避免连续呼吸灯、弹跳、大幅缩放等动画。

---

# 14. 全局快捷键

## 14.1 默认快捷键

推荐默认：

```text
Alt + Space
```

备选：

```text
Win + Alt + N
```

实际实现时必须确认 Windows 系统/其他软件冲突。

## 14.2 行为

快捷键：

```text
隐藏 → 显示
显示 → 隐藏
```

显示时：

```text
窗口显示
↓
置前
↓
输入框 focus
↓
选择/保留自然光标位置
```

如果窗口已显示但焦点在其他应用，则再次触发快捷键仍应让 MiniMemo 到前台并 focus 输入框。

---

# 15. 托盘

必须提供 Windows 系统托盘图标。

右键菜单建议：

```text
显示 MiniMemo
隐藏 MiniMemo
切换置顶
恢复默认背景
设置
退出
```

首版“设置”可为空壳或只打开简易设置面板，不要为了托盘菜单额外引入复杂页面。

单击托盘图标：

```text
显示/隐藏
```

双击托盘图标：

```text
显示并 focus 输入框
```

---

# 16. 关闭按钮语义

标题栏 ✕ **不要直接退出进程**。

点击：

```text
隐藏窗口
```

真正退出必须通过：

```text
托盘 → 退出
```

这样可以保持后台驻留与全局快捷键能力。

---

# 17. Tauri / Rust Command 设计

推荐定义以下 command：

```rust
load_state()
save_state(state)
set_always_on_top(value)
select_background()
reset_background()
get_window_position()
save_window_position(x, y)
archive_completed_tasks()
```

说明：

- 不要求所有逻辑都放在 Rust。
- UI 状态可以在前端维护。
- 文件系统、原生窗口、快捷键、系统托盘、文件选择等应优先由 Rust/Tauri 负责。
- 数据模型迁移和可靠持久化可以放 Rust。

---

# 18. 前后端职责

## Frontend

负责：

- UI
- Todo 列表渲染
- 输入
- checkbox 状态反馈
- 动画
- background layer
- 与 Rust command 通信

## Rust

负责：

- 全局快捷键
- 文件选择
- 文件复制
- 数据文件读写
- 数据迁移
- 系统托盘
- 窗口控制
- always-on-top
- 窗口位置
- 应用生命周期

原则：**浏览器 API 能可靠完成的不要无意义下沉到 Rust；Windows 原生能力优先放 Rust/Tauri。**

---

# 19. 前端状态模型

推荐：

```js
const appState = {
  settings: {},
  todos: [],
  archives: [],
  ui: {
    windowMode: 'expanded',
    focused: false,
    saving: false
  }
};
```

不要把所有逻辑塞进一个 `index.html` 的大型全局脚本。

即使首版不使用 npm，也建议按职责拆分：

```text
ui/
├── index.html
├── styles.css
├── app.js
├── state.js
├── todos.js
├── window.js
└── background.js
```

如果 Agent 为了“真正单文件”而牺牲可维护性，则不推荐。

---

# 20. 安全与健壮性

## 20.1 Todo 文本不能直接注入 HTML

禁止：

```js
el.innerHTML = `<span>${item.text}</span>`;
```

用户输入必须通过：

```js
textContent
```

或安全 DOM API 插入。

原因：即使是本地 Todo 应用，也不应该给字符串注入 HTML 的机会。

## 20.2 前后端命令参数校验

Rust command 必须验证：

- 文件存在
- 文件类型允许
- 路径可读
- 数据结构合法

## 20.3 文件写入

推荐使用：

```text
临时文件 → flush → rename/replace
```

降低程序崩溃导致 `data.json` 变成半截 JSON 的风险。

---

# 21. 初始化流程

程序启动顺序：

```text
启动 Tauri
↓
初始化 App Data 目录
↓
加载 data.json
↓
校验 / migration
↓
初始化托盘
↓
注册全局快捷键
↓
恢复窗口位置
↓
应用 alwaysOnTop
↓
执行日期检查
↓
加载背景
↓
显示窗口
↓
focus 输入框
```

如果任何非关键环节失败：

```text
记录日志
↓
使用默认配置继续启动
```

不能因为背景图片丢失、旧配置字段缺失等非致命问题阻止程序启动。

---

# 22. 具体交互规格

## 新增任务

```text
用户点击输入框
输入“测试任务”
按 Enter
↓
创建 Todo
↓
插入未完成列表顶部
↓
清空输入框
↓
保存
↓
继续 focus 输入框
```

## 完成任务

```text
点击 checkbox
↓
completed = true
completedAt = now
↓
播放轻量动画
↓
移动到已完成区
↓
保存
```

## 取消完成

```text
点击已完成任务 checkbox
↓
completed = false
completedAt = null
↓
移动回未完成区顶部
↓
保存
```

## 删除任务

默认直接删除，不弹确认框。

> 这是“极速工具”的设计取舍。若 Agent 担心误触，可以只对已完成任务提供删除，不应让每次删除都弹窗。

## 清空已完成

点击：

`清空已完成`

直接删除所有 `completed=true` Todo，并保存。

首版不必弹确认框。

---

# 23. 可访问性与可用性

虽然 UI 极简，但至少满足：

- 输入框可键盘 focus
- checkbox 可键盘操作
- 按钮具有 `title`/aria-label
- 文本对比度足够
- Todo 文本不能因为背景图片完全不可读
- 自定义背景必须经过 overlay

如果用户选择极亮/极杂乱图片，前景仍必须清晰。

---

# 24. 日志

开发版本加入 Rust 日志：

```text
INFO  MiniMemo started
INFO  loaded state
INFO  registered global shortcut
INFO  background changed
INFO  archived N completed todos
ERROR failed to load state
```

发布版本不要在 UI 上显示调试日志。

日志不能包含不必要的用户 Todo 内容。

---

# 25. 项目目录建议

```text
MiniMemo/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── state.rs
│   │   ├── commands.rs
│   │   ├── tray.rs
│   │   ├── shortcut.rs
│   │   ├── background.rs
│   │   └── window.rs
│   ├── icons/
│   │   └── icon.ico
│   ├── capabilities/
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── ui/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── state.js
│   ├── todos.js
│   ├── window.js
│   └── background.js
│
├── README.md
└── LICENSE
```

---

# 26. Agent 开发阶段划分

## Phase 1：最小可运行版本

必须完成：

- Tauri 项目初始化
- 无边框窗口
- UI 基础布局
- Todo 添加
- Todo 完成/取消完成
- Todo 删除
- 本地 JSON 持久化

此阶段结束后，软件必须可以正常运行和重新启动不丢数据。

## Phase 2：桌面能力

加入：

- 全局快捷键
- 托盘
- 隐藏/显示
- alwaysOnTop
- Esc 隐藏
- 窗口拖动
- 窗口位置恢复

## Phase 3：窗口形态

加入：

- 胶囊态
- 边缘吸附
- 4px 感应条
- hover 展开
- 抖动/重复触发防抖

## Phase 4：背景系统

加入：

- 默认毛玻璃
- 自定义图片
- 图片复制缓存
- 恢复默认背景
- overlay

## Phase 5：日期逻辑

加入：

- 跨日检测
- 已完成任务归档
- 未完成任务保留
- 历史未完成标识
- 数据 migration

## Phase 6：稳定性优化

加入：

- 异常数据恢复
- atomic write
- 日志
- 多显示器位置修复
- 快捷键冲突处理
- Windows 实机验证

---

# 27. 验收测试

## A. 基础 Todo

### A1 添加

输入：

`完成 MiniMemo 原型`

按 Enter。

预期：

- 出现在顶部
- 未完成
- 进度正确
- 刷新/重启仍存在

### A2 空任务

输入：

`   `

按 Enter。

预期：

不创建任务。

### A3 完成

勾选任务。

预期：

- 出现删除线
- 透明度降低
- 移到列表底部
- 进度 +1
- 重启保持 completed 状态

### A4 删除

点击删除。

预期：

立即删除且重启后不存在。

---

# 28. 日期验收

构造：

```text
2026-09-10:
未完成 A
已完成 B
```

模拟进入：

```text
2026-09-11
```

预期：

```text
今日列表：A
archives：B
```

再次启动程序：

不能重复归档 B。

---

# 29. 背景验收

### 默认

启动应用后：

- 背景为毛玻璃/亚克力效果
- 文字清晰
- 四角正常

### 自定义图片

选择一张 JPG。

预期：

- UI 使用该图片作为背景
- 重启后仍显示
- 删除原始 JPG 后仍显示

### 恢复

执行“恢复默认亚克力毛玻璃”。

预期：

- 图片消失
- 默认背景恢复
- 重启仍保持默认背景

---

# 30. 全局快捷键验收

当 MiniMemo 隐藏时：

```text
Alt + Space
```

预期：

- 显示窗口
- 窗口到最前
- 输入框获得焦点

再次按：

```text
Alt + Space
```

预期：

- 隐藏

其它应用处于前台时也必须有效。

---

# 31. 边缘吸附验收

手动拖动窗口靠近右边缘：

```text
x 距离屏幕边缘 <= 10px
```

预期：

- 自动吸附
- 只剩约 4px 可见区域

鼠标进入感应区：

预期：

- 展开
- 不发生多次闪烁

鼠标离开：

预期：

- 短暂延迟后重新收缩

---

# 32. 数据损坏验收

手动把 `data.json` 改成无效 JSON。

重新启动。

预期：

- 应用仍能启动
- 原文件被备份，例如 `.broken`
- 使用默认空数据启动
- 日志记录异常

---

# 33. 安全验收

输入：

```html
<img src=x onerror=alert(1)>
```

预期：

界面显示原始字符串，而不是执行 HTML/JS。

---

# 34. Agent 编码规则

Agent 在实现时必须遵循：

1. 优先简单方案，不为了“高级架构”引入不必要依赖。
2. Rust 处理系统能力，JS 处理 UI。
3. 所有持久化操作必须可恢复。
4. 所有用户输入默认为不可信字符串。
5. 所有窗口行为必须在 Windows 实机验证。
6. 不要把“原型 demo 能运行”误认为“产品已完成”。
7. 每完成一个 Phase，运行对应验收测试。
8. 修改 Tauri 配置时，必须以当前 Tauri 2.x 实际 schema/API 为准。
9. 不要机械复制本文旧版示例代码；本文定义的是产品行为与约束。
10. 不要加入用户没有要求的重量级功能。

---

# 35. 推荐默认配置

```json
{
  "alwaysOnTop": true,
  "windowMode": "expanded",
  "bgType": "mica",
  "maskOpacity": 0.65,
  "blur": 6,
  "shortcut": "Alt+Space",
  "edgeSnap": true,
  "edgeThreshold": 10,
  "edgeHandleSize": 4
}
```

---

# 36. Definition of Done

只有同时满足以下条件，才能认为 MiniMemo v0.1 完成：

### 功能

- [ ] 可以创建 Todo
- [ ] 可以完成/取消完成
- [ ] 可以删除
- [ ] 可以清空已完成
- [ ] 重启不丢数据
- [ ] 跨日规则正确
- [ ] 已完成任务可以归档
- [ ] 未完成任务可以跨日保留
- [ ] 全局快捷键可用
- [ ] 托盘可用
- [ ] 可以隐藏/恢复窗口
- [ ] 可以切换 always-on-top
- [ ] 可以拖动窗口
- [ ] 边缘吸附可用
- [ ] 背景图片可更换
- [ ] 原图片删除后背景仍可用
- [ ] 可以恢复默认背景

### 体验

- [ ] 启动后输入框可直接使用
- [ ] Enter 添加任务无需鼠标
- [ ] 添加后继续 focus
- [ ] UI 无明显卡顿
- [ ] 动画克制
- [ ] 文字在自定义背景上仍清晰
- [ ] 关闭按钮默认只是隐藏，不退出

### 健壮性

- [ ] data.json 损坏不会导致程序无法启动
- [ ] 数据写入不会轻易产生半截 JSON
- [ ] todo 文本不会造成 HTML 注入
- [ ] 背景文件丢失不会导致崩溃
- [ ] 多显示器下窗口不会永久跑出屏幕

---

# 37. Agent 最终输出要求

当 Agent 完成实现后，应输出：

```text
1. 实现了哪些功能
2. 使用了哪些 Tauri/Rust API
3. 修改了哪些文件
4. 如何运行开发版本
5. 如何构建 Windows release
6. 如何生成便携版/绿色版
7. 已通过哪些验收测试
8. 尚未完成的功能
9. 已知 Windows 平台限制
```

不要只回答“代码已完成”。

---

# 38. 建议的最终用户体验

MiniMemo 的理想工作流应当接近：

```text
正在写代码
      ↓
想到一个待办
      ↓
Alt + Space
      ↓
窗口瞬间出现
      ↓
输入任务
      ↓
Enter
      ↓
任务记录完成
      ↓
窗口隐藏/继续工作
```

核心评价标准不是功能数量，而是：

> **记录一个任务的阻力是否足够低。**

MiniMemo 应始终保持“小、快、安静、可靠”。
