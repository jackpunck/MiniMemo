# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目状态

MiniMemo 的完整实现已经落地（Rust + Tauri 2.x 后端、vanilla JS 前端）。

**这台开发机没有 Rust 工具链**（`rustc`、`cargo`、`~/.rustup` 都不存在），所以本机跑不了 `cargo check`。编译验证走 CI（[.github/workflows/build.yml](.github/workflows/build.yml)）的 `check` job：`cargo check --all-targets` + `cargo test`。

触发条件有个坑：`push` **只监听 `main` 和 `v*` tag**，往别的分支推不会跑任何东西。要拿反馈就开一个到 `main` 的 PR（`pull_request` 会触发），或者手动 `workflow_dispatch`。出包只看 tag 或手动触发。

要分清「CI 绿过」和「验证过了」。**`cargo check` 不链接、不打包、也从不运行程序。** v0.1.0 已经出包并在实机上跑起来了，第一轮反馈暴露了两个问题（背景图被 `cover` 裁掉、鼠标离开不自动最小化），都已修 —— 但**规格 §27–33 的验收用例还没有被系统性走过**，托盘、全局快捷键、边缘吸附的命中测试都还是未知数。规格 §34 第 6 条：不要因为 CI 绿了就当产品完成。要确认 CI 的实际结果，去仓库的 Actions 页面看，别信文档里的转述。

静态复查能挡住 API 误用（比如修掉的 `TrayIcon::menu()` 并不存在）和并发问题，但**替代不了编译**：trait 约束、泛型实例化、`Send`/`Sync` 之类只有 `cargo check` 说了算。

当前状态：拖动排序、文字颜色、外观设置这一批（PR #1）已经在 CI 上跑过 `cargo check --all-targets` 与 `cargo test`（10 个测试全绿）。**这代表它能编译、解析逻辑有回归测试兜着，不代表它在桌面上是好的。**

[docs/MiniMemo_AGENT_SPEC.md](docs/MiniMemo_AGENT_SPEC.md) 是实现基准和行为契约。注意规格里出现的配置片段、API 名多为示意，一律以当前 Tauri 2.x 实际 schema/API 为准（规格 §34.8 也如此要求）。

## 项目是什么

MiniMemo 是常驻 Windows 桌面的极简「今日待办」浮窗：全局快捷键唤起 → 输入 → Enter 保存。核心评价标准是**记录一个任务的阻力是否足够低**，而不是功能数量。明确不做：云同步、账号、网络、标签、Markdown、任何 UI 框架。

## 技术栈

- Rust + Tauri 2.x；Windows WebView2；目标 Win10/11，优先 Win11
- 前端：Vanilla HTML/CSS/JS（ES modules），**禁止** React/Vue/Svelte 及运行时 npm UI 组件库
- 持久化：单个本地 JSON，无网络依赖
- 无打包器：`build.frontendDist` 直接指向 `ui/`，前端靠 `withGlobalTauri` 拿 API

## 命令

```bash
npm run dev          # = tauri dev
npm run build        # = tauri build（NSIS 安装包）
npm run icons        # 重新生成 src-tauri/icons（Node 脚本，零依赖）

cd src-tauri
cargo check          # Rust 侧改动的首选反馈
cargo test
```

**上面这几条在开发机上跑不了**（没有 Rust 工具链）。Rust 侧的反馈走 CI：[.github/workflows/build.yml](.github/workflows/build.yml) 的 `check` job 跑 `cargo check --all-targets` + `cargo test`，`build` job 出 NSIS 安装包并上传为 artifact / 发布 Release。**`check` 只在推 `main`、推 `v*` tag 和 PR 上触发** —— 往别的分支推不会跑任何东西。没在 CI 上跑绿过的改动，一律当作没验证过。

没有前端构建步骤，改 `ui/` 下的文件直接生效。`tauri.conf.json` 里没有 `beforeDevCommand`。

图标由 [tools/gen-icons.mjs](tools/gen-icons.mjs) 用 Node（zlib 手写 PNG + ICO 容器）生成。`tauri-build` 会把 `icon.ico` 编进 Windows 资源段，缺了它 `cargo build` 直接失败，所以这个脚本是仓库自举的一部分。

## 架构

**Rust 是数据的唯一权威来源。** 前端不推演状态变化：每个会改数据的 command 都返回完整的 `AppData` 快照，前端整体重绘（[ui/state.js](ui/state.js) 的 `call()` 自动把结果写回 `state.data`）。这样跨日归档这类逻辑不会出现「前端算的日期」和「落盘的日期」各说各话。修改数据请沿用这个模式，不要让前端自己维护一份可变状态。

**所有数据变更都经由 [commands.rs](src-tauri/src/commands.rs) 的 `current` / `mutate` 两个入口**，它们持有 `DATA_LOCK`，把「读 → 改 → 写」串成一个临界区。command 全标了 `#[tauri::command(async)]`，真正跑在多线程运行时上，而落盘写的是整份 `AppData` —— 不加锁时两次并发的 invoke 会各自从同一份快照出发、后者整份覆盖前者（前端确实有不 await 就连发的调用）。新增 command 请走这两个入口，不要自己 `state::load` + `state::save`。

临界区里含 `fsync`，**不要从主线程调用 `mutate`**。窗口拖动那条落盘路径（`window::save_position_throttled`）是把活儿丢到后台线程的 —— 它跑在 `WindowEvent::Moved` 回调里，`#[tauri::command(async)]` 只改变 IPC 派发方式，直接调仍是在主线程上同步做全套文件 IO。

前端职责边界（规格 §18）：Rust 管系统能力（快捷键、托盘、窗口、文件读写、字体枚举），JS 管 UI 与渲染。

### Rust 模块

| 文件 | 职责 |
|---|---|
| [main.rs](src-tauri/src/main.rs) | 启动顺序、插件注册、`generate_handler!`、窗口事件分发 |
| [state.rs](src-tauri/src/state.rs) | 数据模型、原子持久化、损坏容错、跨日迁移、排序 |
| [commands.rs](src-tauri/src/commands.rs) | 全部 command；背景与运行时信息也在这里 |
| [window.rs](src-tauri/src/window.rs) | 位置恢复、多显示器兜底、置顶、边缘吸附 |
| [tray.rs](src-tauri/src/tray.rs) | 系统托盘（唯一的退出入口） |
| [shortcut.rs](src-tauri/src/shortcut.rs) | 全局快捷键，含冲突回退 |
| [fonts.rs](src-tauri/src/fonts.rs) | 字体枚举、导入、字节读取 |

规格 §25 里还有个 `background.rs`，实际实现把背景逻辑放进了 `commands.rs`，没有单独成文件。

### 改数据模型之前必读

**给 `Todo` / `Settings` 加字段时，少一个 `#[serde(default)]` 就能清空用户的全部待办。** 这是这个仓库最容易犯、后果最重的错误，而且编译期毫无征兆。

三个必须记住的点：

1. **容器级和字段级的 `default` 语义不同，不能混用。** 字段级 `#[serde(default)]` 取的是**该字段类型**的 `Default`（`String` 就是空串），容器级才是取 `impl Default for 该结构体` 里的值。`Settings.text_color` 故意只靠容器级，就是为了拿到 `DEFAULT_TEXT_COLOR` 而不是空串。
2. **`AppData` 上的 `default` 不会保护 `Settings` 内部的字段。** 它只在 `settings` 整个键缺失时才生效。现存用户的 `data.json` 个个都有 `settings`、个个都没有新字段 —— 这正是出错的那条路径。
3. **`load()` 解析失败的处理是 `backup_broken()` + 返回默认数据**（[state.rs](src-tauri/src/state.rs) 的 `load`）。文件被改名成 `.broken`，用户看到的是所有待办凭空消失。**任何解析失败都表现为「用户的活儿没了」**，所以这类改动必须配单元测试 —— `state.rs` 的 `legacy_settings_without_text_color_still_parses` 就是这个用途的回归测试。

另外，**新增字段的默认值必须让老数据的行为保持不变**。`Todo.order` 默认 0 是个恒等键，排序仍落回 `created_at` 倒序，与加字段前一模一样；如果给它一个非 0 的默认值，所有老任务的相对顺序都会被打乱。

数据版本变迁写在 `migrate()` 里。覆盖老用户的值之前，先确认那个值不可能是用户的真实选择（v1→v2 重置 `mask_opacity` 之所以安全，是因为前端从来没读过这个字段，磁盘上的 0.65 只是初始默认值）。

## 几个关键机制

这几处需要同时理解数据层、窗口层和 UI 层：

1. **跨日迁移**（[state.rs](src-tauri/src/state.rs) 的 `rollover`）。应用可能休眠或隐藏数天，所以**不能依赖 `setTimeout` 跨越零点**，只比对本地日期与 `settings.lastCheckDate`。已完成项进 `archives`，未完成项保留并显示日期前缀。首次启动（`lastCheckDate` 为空）只设日期、不归档 —— 否则会把用户的全部历史误判成「昨天的已完成」。`archives` 有 500 条上限，超出丢最旧。

2. **原子写入与损坏容错**（`state.rs` 的 `save` / `load`）。临时文件 → flush → sync → rename；Rust 的 `fs::rename` 在 Windows 上走 `MoveFileEx(MOVEFILE_REPLACE_EXISTING)`，覆盖已存在文件也是原子的。解析失败时备份成 `data.json.<时间戳>.broken` 再用默认数据启动。**任何数据异常都不得阻止应用启动。**

3. **边缘吸附**（[window.rs](src-tauri/src/window.rs)）。两个坑：**单位**（显示器信息是物理像素，窗口尺寸按逻辑像素写，混用会在 125% 缩放的屏幕上偏差 25%，所以统一先换算成物理像素）和**自触发**（吸附时自己调 `set_position`/`set_size` 会再次触发 `Moved`，进而重新判定吸附 —— `PROGRAMMATIC` 标志用来标记程序发起的移动，必须覆盖每一条改位置的路径，否则窗口会抖动）。吸附开关与阈值缓存在 `SNAP_CFG` 里，因为 `Moved` 每秒来几十次，不能每次都读盘解析 JSON。解除吸附（`release_snap`）还有第三个坑：恢复宽度必须以**当前贴边的那条边**为锚，而不是沿用 `pos.x`。右侧收缩成感应条后 `pos.x` 已经贴着屏幕右缘，沿用它会得到一个几乎全在屏幕外的窗口（280px 宽只剩十来像素可见）；左侧则恰好相反。但同一个函数也被「用户把窗口拖离边缘」触发，所以只有确实还贴着边时才允许移动位置，否则会在拖动中途把窗口拽回去。

4. **字体系统**（[fonts.rs](src-tauri/src/fonts.rs) + [ui/fonts.js](ui/fonts.js)）。系统字体走 `font-kit`（Windows 上即 DirectWrite，与 WebView2 解析 CSS `font-family` 用的是同一套库）；导入字体走「复制进 app data → 读字节 → `new FontFace(family, ArrayBuffer)`」。**不要改成 `@font-face { src: url(...) }`** —— 那要么依赖 `file://`（被 WebView2 的 origin 隔离挡掉），要么需要开启 asset protocol 并放宽 CSP，而且字体请求是 CORS 模式的，跨 origin 能否通过并不确定。当前方案不发起任何请求，因此无需任何安全配置变更。

5. **首屏字体引导**（[ui/boot.js](ui/boot.js)）。设置存在 Rust 侧、只能异步取，等它回来时页面早画完了，会闪一下默认字体。`boot.js` 在 `<head>` 里同步读 localStorage 缓存并写 CSS 变量。它**必须是阻塞式普通脚本**（不能是 `module` / `defer`），CSP 是 `script-src 'self'` 所以也不能写成内联脚本。

6. **拖动排序**（[ui/dnd.js](ui/dnd.js) + [state.rs](src-tauri/src/state.rs) 的 `Todo.order`）。三个坑：

   - **不能在 `pointerdown` 里就 `setPointerCapture`。** 一旦捕获，`click` 会被重定向到 `li`，用户在勾选框上按下再轻微抖动，勾选就失效了。只有位移越过阈值、确认意图是拖动之后才接管指针。
   - **`renderList()` 的 `replaceChildren()` 会在拖动中途把正在拖的 `li` 从 DOM 摘掉**，元素一移除 pointer capture 就隐式释放，`pointerup` 再也收不到，`reorder_todos` 永远不会被调用。所以 [ui/app.js](ui/app.js) 的 `render()` 在拖动中要整轮跳过，`renderList()` 开头再加 `cancelDrag()` 兜底。
   - **几何算的是未完成项**。未完成项由 `sort_todos` 保证连续排在前面，拖动也只在这段内换位 —— 已完成项永远沉底，跨不过那条边界。位移折算依赖「每行严格等高」（`.todo` 无 margin、`.list` 无 gap、`.todo-text` 强制 `nowrap`），给其中任何一个加 margin / gap / line-height 都会让换位算错。

   `reorder_todos` 只收**未完成**的 id，未列出的接末尾并保持原相对次序 —— 这样并发新增或归档过的残缺列表只会降级，不会报错、不会交错。赋值结果必须是 `sort_todos` 的不动点，否则 `mutate` 结尾那次排序会把结果打乱。

7. **背景可读性与外观变量**（[ui/appearance.js](ui/appearance.js) + [styles.css](ui/styles.css)）。原来自定义图片是糊的，根因是 `#app` 上的 `backdrop-filter` 在模糊**整个窗口背后**的东西。现在图片模式强制关掉它，改由文字投影 + 颜色选择撑对比度。

   三条必须记住的约束：

   - **用户的文字颜色只写 `--note-*`，绝不碰 `--text` / `--text-dim` / `--text-faint`。** 后者是窗口 chrome（标题栏、设置面板、toast、字体列表）的固定配色 —— 把它们一起改掉，用户选了深色之后设置面板会变成深底深字，**再也改不回来**。
   - **遮罩浓度只能有一层来源。** 有图片时 `#app` 的 background 必须是 `transparent`、`backdrop-filter` 必须是 `none`，否则会和 `.bg-mask` 叠成 `0.25 + 0.75×α`，滑块的读数对不上眼睛看到的东西。同理，无图片时 `#app` 用的是另一个变量 `--app-mask`（固定 0.65），不是 `--mask`（图片遮罩，滑块驱动）—— 混用会让「调图片遮罩」意外改掉默认的亚克力观感。
   - **背景必须是三层独立元素**（`.bg-blur` / `.bg-image` / `.bg-mask`），不能图省事写成 `#bg` 自己的 `background` 加伪元素。`filter` 会作用于**整个子树**，把 `blur()` 写在 `#bg` 上会把上面那层清晰图一起糊掉 —— 那正是最初要修的问题。同理，`background-size` 在清晰层必须是 `contain` 而不是 `cover`：窗口是 280×380 的竖长条，`cover` 对横屏图等于只留中间一条。图片 URL 通过 `--bg-image` 变量同时喂给模糊层和清晰层，见 [ui/background.js](ui/background.js)。

   投影方向随文字颜色的亮度自动反转（亮字配暗影、暗字配亮光晕）。少了这一步，用户在暗背景图上选深色正文会比默认白字还难读 —— 颜色选择就从解决问题的工具变成了制造问题的工具。两个滑块互斥：有图片时只显示「背景遮罩」（模糊被 CSS 强制关掉），无图片时只显示「背景模糊」（没有图片可遮）。

8. **鼠标离开自动最小化**（[ui/window.js](ui/window.js) + [commands.rs](src-tauri/src/commands.rs) 的 `minimize_to_edge`）。定时器到点后调的是 `minimize_to_edge`，**不是** `set_edge_collapsed(true)` —— 后者在窗口没吸附时会直接 `return Ok(())`（[window.rs](src-tauri/src/window.rs) 里那句「没吸附就不该有收缩行为」），于是「离开就最小化」实际只在贴着屏幕边缘时成立，窗口停在屏幕中间时完全没反应。`minimize_to_edge` 自己分流：吸附了收缩成感应条，没吸附就隐藏窗口，和标题栏那个 `—` 按钮是同一个行为。

## 不可违反的行为约定

- **关闭按钮 ✕ 只隐藏窗口，不退出进程**（规格 §16）。真正退出只经「托盘 → 退出」，通过 `state::QUITTING` 放行 `RunEvent::ExitRequested`。窗口全关也不退出，否则托盘和快捷键会一起消失。
- **Todo 文本禁止 `innerHTML`**（规格 §20.1），一律 `textContent`。验收：输入 `<img src=x onerror=alert(1)>` 必须原样显示。
- 添加后保持输入框 focus，不弹通知、不弹确认框；删除和清空已完成都不弹确认。
- 字体链、归档等写入用户可见文本的地方，用户文件名同样是不可信字符串。

## 容易踩的 Tauri 2 细节

- **`emit` 在 `Emitter` trait 上，不在 `Manager` 上**，两个都要 `use`。
- **`TrayIcon` 没有 `menu()` getter**，只有 `set_menu` —— 菜单建好就拿不回来了，`AppHandle::menu()` 取的是应用菜单、不是托盘菜单。要回写 `CheckMenuItem` 的勾选状态只能自己留一份句柄，见 [tray.rs](src-tauri/src/tray.rs) 的 `ONTOP_ITEM`。
- 自定义 command **不需要** ACL 条目（本地 origin 默认放行）；但 `core:window:allow-*` 那一串是必须的，`core:window:default` 只有只读的 getter。`core:window:allow-start-dragging` 漏了 `data-tauri-drag-region` 会静默失效。
- `transparent: true` 必须配 `shadow: false`，否则窗口阴影会让透明失效。
- 窗口在配置里是 `visible: false`，由 `window::init()` 定位后再显示 —— 否则会先在屏幕中央闪一下再跳到右上角。
- `app_data_dir()` 取的是 `identifier`（`com.minimemo.app`），不是 `productName`（`MiniMemo`）。
- 字体枚举的 `font-kit::SystemSource::all_families()` 在部分系统上只返回本地化名，所以 `list_families()` 会把一份兜底清单（含英文名）并进去，且失败时降级而非报错。

## 与规格的偏离

三处有意为之，改回去前请先确认收益：

1. **用 `<input type="file">` 而不是 `tauri-plugin-dialog`。** 插件的 JS API 不在 `withGlobalTauri` 的全局包里（插件是独立 npm 包，而本项目没有打包器），vanilla JS 调不到；Rust 侧的 `blocking_pick_file` 又有主线程死锁风险。标准文件选择器少一层依赖，且不涉及任何权限配置。
2. **`ui/` 用 ES modules 拆成多文件**，而不是规格 §19 里那张表 —— 大体一致，但多了 `boot.js`（首屏字体引导）和 `settings.js`（设置面板）。
3. **字体选择器是自己实现的 listbox**，不是原生 `<select>`：Windows 上展开的列表由系统绘制，会忽略 `<option>` 上的 `font-family`，预览会全部失效。

## 验收

规格 §27–33 是验收用例（基础 Todo / 日期 / 背景 / 快捷键 / 边缘吸附 / 数据损坏 / 安全），§36 是 v0.1 的 Definition of Done 清单。

**所有窗口行为必须在 Windows 实机验证** —— 尤其透明窗口的圆角、点击区域、拖动区域，以及边缘吸附缩成 4px 感应条后能否稳定被鼠标唤起。规格 §34 第 6 条：不要因为原型 demo 能跑就认为产品完成。

## 沟通语言

规格、UI 文案与注释均为中文，回复用户时使用中文。
