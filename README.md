# MiniMemo

常驻 Windows 桌面的极简「今日待办」浮窗。全局快捷键唤起 → 输入 → Enter 保存,
不用打开完整的 Todo 应用。

核心评价标准不是功能数量,而是**记录一个任务的阻力是否足够低**。

## 功能

- **零阻力添任务**:快捷键唤起 → 输入 → Enter。无确认框、无通知、无页面跳转。
- **全局快捷键**:默认 `Alt + Space`,冲突时自动退到 `Ctrl + Alt + Space`。
- **托盘驻留**:关闭按钮只隐藏窗口,不退出进程;退出只能走托盘菜单。
- **拖动排序**:按住任务上下拖即可调整顺序,只读已完成的项不参与(它们永远沉底)。
- **窗口形态**:展开态 280×380;贴近屏幕边缘自动吸附,鼠标悬停展开;
  标题栏的 `—` 可以立刻收缩成边缘感应条(没吸附时退化为隐藏窗口)。
- **鼠标离开即最小化**:鼠标移出窗口 1 秒后自动收缩 —— 已吸附就缩回感应条,
  没吸附就隐藏窗口,和按 `—` 是同一个行为。回来看一眼、挪去别的窗口都不会
  把它留在桌面上挡着。
- **跨日处理**:已完成的昨日任务自动归档,未完成的保留并标注日期。
- **背景与可读性**:默认亚克力毛玻璃,可换成自定义图片(图片会被复制进应用数据
  目录,之后删除原图也不影响)。背景图**不做模糊**,清晰可见;正文靠可选的
  文字颜色 + 自动匹配方向的投影保证可读,遮罩浓度可调。详见下节。
- **字体**:便签正文可自由选择字体,详见下节。

## 字体功能

便签正文的字体可以自定义,两种来源:

**1. 系统字体** —— 通过 DirectWrite 枚举本机已安装的字体族(与 WebView2 解析
CSS `font-family` 用的是同一套字体库,所以列出来的名字一定能用)。设置面板里
每个字体名都用自己的字体渲染,直接就是预览。

**2. 导入字体文件** —— 支持 `.ttf` 与 `.otf`。文件会被复制进应用数据目录并按
内容哈希重命名,原文件之后移动或删除都不影响。

实现上有两点值得注意:

- **导入字体走 `new FontFace(family, ArrayBuffer)` 而不是 `@font-face { src: url(...) }`。**
  后者要么依赖 `file://`(被 WebView2 的 origin 隔离挡掉),要么需要开启 asset
  protocol 并放宽 CSP,而且字体请求是 CORS 模式的,跨 origin 能否通过并不确定。
  直接喂字节不发起任何请求,因此不需要任何安全配置变更。
- **字体选择器不是原生 `<select>`。** 在 Windows 上展开的下拉列表由系统绘制,
  会忽略 `<option>` 上的 `font-family`,字体预览会全部失效。所以这里用
  `div` + `role="listbox"` 自己实现。

不支持 `.ttc`(TrueType Collection)。一个 `.ttc` 里装着多个字体,而
`FontFace` 一次只能表达一个 family/weight/style,浏览器侧的 OTS 校验会直接拒收。
与其导入后静默失败,不如当场提示用户改选 `.ttf` / `.otf`。

## 背景与文字可读性

自定义背景图**完整显示,不裁剪也不变形**。窗口是 280×380 的竖长条,而多数壁纸
是横的,所以图片按 `contain` 缩放完之后上下会空出一块 —— 那块空白由同一张图
放大、模糊、压暗后填满,当氛围底色,而不是露出桌面。

代价是正文直接压在图片上,而图片的亮度不可控 —— 所以这里用三样东西一起撑住
可读性,而不是靠一层浓遮罩把图片压暗:

1. **文字颜色**(设置面板里的色块)。亮图配深字、暗图配浅字。
2. **投影方向随颜色自动反转**。选浅色字就配深色投影,选深色字就配浅色光晕。
   没有这一步,用户在暗背景图上选了深色正文会比默认白字还难读 ——
   颜色选择就从解决问题的工具变成了制造问题的工具。
3. **遮罩浓度滑块**(默认 28%)。前面两样都调不满意时的兜底。

另外,遮罩只覆盖自定义图片。没设图片时的那个毛玻璃底色是另一回事,不受这个
滑块影响。两个滑块互斥:有图片时只显示「背景遮罩」,没图片时只显示「背景模糊」。

> 实现上背景拆成**三层元素**(`.bg-blur` / `.bg-image` / `.bg-mask`),不是
> `#bg` 自己的 `background` 加 `::before`/`::after`。因为 `filter` 会作用于
> 整个子树 —— 把 `blur()` 写在 `#bg` 上,上面那层清晰图会跟着一起糊掉,
> 那正是最初要修的问题。

> 还有一处不能图省事:用户的文字颜色只写 `--note-*` 这组变量,**绝不碰**
> 标题栏和设置面板在用的 `--text`。否则用户选了深色正文之后,设置面板会变成
> 深底深字,再也没法改回来。

## 环境要求

> **这一节只约束「谁来编译」,不约束「谁来使用」。**
> 最终用户拿到的是 `MiniMemo_0.1.0_x64-setup.exe`,双击安装即可,机器上
> **不需要装 Rust、不需要装 Node、也不需要装 .NET**。下面三样只是构建机的要求,
> 而且第 3 项在 Win11 上本来就自带。

Tauri 2.x 在 Windows 上需要三样东西:

1. **Rust 工具链**(MSVC 目标)

   ```bash
   winget install --exact --id Rustlang.Rustup
   rustup default stable-msvc
   rustup target add x86_64-pc-windows-msvc
   rustc -vV   # host 应显示 x86_64-pc-windows-msvc
   ```

   MSRV 是 **1.77.2**。

2. **Microsoft C++ Build Tools**,需要勾选 **「使用 C++ 的桌面开发」** 工作负载
   (`Microsoft.VisualStudio.Workload.VCTools`),含 MSVC v143 工具集与 Windows SDK。

   ```bash
   winget install --exact --id Microsoft.VisualStudio.2022.BuildTools \
     --override "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```

   缺了它的典型症状是 `linker 'link.exe' not found`。

3. **WebView2 Runtime** —— Windows 11 和 Windows 10 v1803+ 已内置,通常无需操作。

装完后**重启终端与编辑器**,否则 PATH 不会刷新。

## 运行

```bash
# 安装 Tauri CLI(任选其一)
npm install                       # 用 package.json 里的 @tauri-apps/cli
cargo install tauri-cli --version "^2"   # 或者用 cargo 子命令

# 开发运行
npm run dev                       # 等价于 tauri dev
cargo tauri dev                   # 若用 cargo 装的 CLI

# 构建
npm run build                     # 等价于 tauri build
cargo tauri build
```

构建产物在 `src-tauri/target/release/`。安装包默认走 **NSIS**
(`bundle.targets: ["nsis"]`);不要用 MSI,它需要额外启用 Windows 的 VBSCRIPT
可选功能,否则会在 `light.exe` 阶段失败。

生成便携版:把 `target/release/MiniMemo.exe` 单独拷出来即可运行 —— 应用不写
注册表,数据只落在下面的数据目录里。前提是目标机器有 WebView2 Runtime
(Win11 自带,Win10 装过新版 Edge 的也有)。Tauri 2 在 Windows 上静态链接了
WebView2 loader,按理不需要额外的 DLL,但**这一点还没实机验证过** ——
要严格保证「拷过去就能跑」,先在一台干净的机器上试一次。

### 不装 Rust 就出包(GitHub Actions)

上面那套工具链只是这一种选择。如果不想在本机装,可以让 CI 去编译 ——
[.github/workflows/build.yml](.github/workflows/build.yml) 已经配好了:

1. remote 已经配好了(`git@github.com:jackpunck/MiniMemo.git`),直接推即可。
2. 推送后 workflow 会自动跑 `cargo check` + `cargo test`(不出包,只为快速反馈)。
   **但触发条件有个坑**:`push` 只监听 `main` 和 `v*` tag,往其他分支推不会跑
   任何东西 —— 要在分支上拿反馈,得开一个到 `main` 的 PR(`pull_request` 会触发)。
3. 想拿安装包:在 Actions 页面手动触发一次(Run workflow),跑完在该次运行的
   Artifacts 里下载 `MiniMemo-安装包`。
4. 或者推一个 tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

   会自动建 Release 并把安装包和便携版挂上去 —— 那个页面链接就是可以直接
   发给别人的东西。

> 开发机没有 Rust 工具链,**CI 的 `cargo check` 就是这个仓库唯一的编译反馈**。
> 所以这个 job 排在最前面、并且不加 `--locked` —— 报错了要能立刻看到,而不是
> 等到打包阶段。
>
> 另外要分清「CI 绿过」和「验证过了」:`cargo check` 不链接、不打包,也**不会
> 运行程序**。安装包能出来,不等于透明窗口、边缘吸附的命中测试、托盘和全局
> 快捷键在真实桌面上是好的 —— 那些只有在 Windows 上跑一遍才算数。

### 图标

`src-tauri/icons/` 里的图标由脚本生成,不依赖任何设计资源:

```bash
node tools/gen-icons.mjs
```

`tauri-build` 会把 `icon.ico` 编译进可执行文件的资源段,缺了它 `cargo build`
会直接失败。

## 数据位置

```text
%APPDATA%\com.minimemo.app\
├── data.json          # 全部状态
├── data.json.tmp      # 原子写入的中间文件,正常不存在
└── fonts\             # 导入的字体,按内容哈希命名
```

> 注意:目录名取自 `tauri.conf.json` 的 `identifier`,而不是 `productName`。
> 标识符用 `com.minimemo.app`,所以是 `com.minimemo.app\` 而不是 `MiniMemo\`。

写入采用 **临时文件 → flush → sync → rename**,不会留下半截 JSON。若 `data.json`
损坏,启动时会把它备份成 `data.json.<时间戳>.broken` 并用默认数据继续启动 ——
数据文件异常永远不会导致应用打不开。

## 目录结构

```text
src-tauri/src/
├── main.rs        启动顺序、插件注册、窗口事件分发
├── state.rs       数据模型、原子持久化、损坏容错、跨日迁移
├── commands.rs    暴露给前端的 command
├── window.rs      位置恢复、多显示器兜底、置顶、边缘吸附
├── tray.rs        系统托盘
├── shortcut.rs    全局快捷键(含冲突回退)
└── fonts.rs       字体枚举、导入、字节读取

ui/
├── index.html
├── boot.js        首屏字体引导(必须阻塞执行,见文件内注释)
├── styles.css
├── app.js         启动与装配
├── state.js       状态与 command 调用封装
├── todos.js       列表渲染与交互
├── dnd.js         拖动排序
├── appearance.js  文字颜色、背景遮罩、背景模糊
├── window.js      窗口行为、快捷键、悬停展开
├── background.js  背景层
├── fonts.js       字体加载与应用
└── settings.js    设置面板
```

## 安全

- 任务文本一律通过 `textContent` 写入,不做任何 HTML 拼接。
  输入 `<img src=x onerror=alert(1)>` 会原样显示。
- 导入的字体/图片按**魔数**校验类型,不信任扩展名。
- 字体与背景文件一律重命名为内容哈希,用户原始文件名不会落到磁盘上 ——
  一次性规避路径穿越、Windows 保留名(`CON`/`NUL`/`COM1`)、非法字符等问题。
- 读取字体与背景时只允许访问数据目录下对应的子目录,拒绝 `..` 与非预期路径。

## 已知限制

- **仅 Windows**。窗口透明、边缘吸附、托盘行为都按 Windows 实现,未做跨平台适配。
- **边缘吸附是实机验证要求最高的一块**。窗口缩成 4px 感应条后能否稳定被鼠标
  唤起,依赖 WebView2 的命中测试行为,必须在真实 Windows 上确认。
- **`Alt + Space` 是 Windows 系统保留组合**(打开窗口系统菜单),能否稳定抢占
  不确定。注册失败时会自动退到 `Ctrl + Alt + Space`,设置面板里会显示实际生效
  的组合。
- **`.ttc` 字体集合不支持**,原因见上文。
- **拖动排序不会自动滚动**。窗口 380px 高,大约显示 8 行;超出的部分拖不过
  可视区。半吊子的自动滚动比没有更糟,所以这里明确不做 —— 需要调整远处的项时,
  先删掉几个或者缩短文本。
