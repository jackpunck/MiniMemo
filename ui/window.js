// 窗口行为：焦点、快捷键、置顶按钮、边缘吸附的悬停展开。

import { invoke, call, state } from './state.js';
import { focusInput } from './todos.js';
import { closeSettings, openSettings } from './settings.js';

/**
 * 鼠标离开后延迟最小化。
 *
 * 0.5 秒：够把指针挪到相邻窗口而不误触发，又不会让窗口「赖着不走」。
 */
const COLLAPSE_DELAY = 500;

/**
 * 「正在输入」的判定窗口：距最后一次敲键不到这么久，就当作还在打字。
 *
 * 不能用 `document.activeElement === #input` 来判断 —— 输入框在启动时和每次
 * 添加后都会被 `focusInput()` 聚焦，那个判断几乎恒为真，会让自动收缩永久失效。
 * 用「最近敲过键」则天然会衰减。
 *
 * 偏低会把用户打到一半的窗口收走，偏高只是收得晚一点而已，所以宁可偏大。
 */
const TYPING_HOLD_MS = 2000;

/** 窗口是不是系统级的当前活动窗口。由 Rust 的 WindowEvent::Focused 推送。 */
let active = true;

/** 最后一次在输入框里敲键的时刻。-Infinity = 从没敲过（见 isTyping 的注释）。 */
let lastTypingAt = Number.NEGATIVE_INFINITY;

let collapseTimer = null;

/**
 * 窗口操作的串行队列。
 *
 * `set_edge_collapsed` 和 `minimize_to_edge` 都是 `#[tauri::command(async)]`，
 * 跑在线程池上，**两次 invoke 的执行顺序没有保证**。快速来回切窗口时收缩和展开
 * 几乎同时发出，乱序落地就会停在错误状态（窗口失焦却展开着）。串成一条链最便宜。
 */
let opChain = Promise.resolve();

function enqueue(op) {
  opChain = opChain.then(op).catch(() => {});
  return opChain;
}

function cancelCollapse() {
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
}

/** 展开到正常尺寸。未吸附时 Rust 侧会直接返回，不需要前端先判断。 */
function expand() {
  cancelCollapse();
  enqueue(() => invoke('set_edge_collapsed', { collapsed: false }));
}

/** 收缩成边缘感应条。**只在已吸附时有效**，没吸附时 Rust 侧是 no-op。 */
function setCollapsed(collapsed) {
  enqueue(() => invoke('set_edge_collapsed', { collapsed }));
}

/**
 * 吸附了就缩成感应条，没吸附就隐藏窗口。分流整个在 Rust 侧做。
 *
 * 和标题栏那个 — 按钮是同一个行为，所以走同一个入口。
 */
function collapseToEdge() {
  enqueue(() => invoke('minimize_to_edge'));
}

function isTyping() {
  return performance.now() - lastTypingAt < TYPING_HOLD_MS;
}

function scheduleCollapse() {
  cancelCollapse();
  collapseTimer = setTimeout(() => {
    collapseTimer = null;

    // 设置面板开着、或者用户正在打字时不要收缩。
    // 这里是**重新排程**而不是直接 return：这条 timer 链是自动收缩唯一的触发源，
    // 直接返回等于把它掐断 —— 用户关掉设置面板 / 停手之后，窗口就再也不自动收缩了。
    // 重排程本身也构成了「打字是否还在继续」的轮询，不需要另开定时器。
    if (state.ui.settingsOpen || isTyping()) {
      scheduleCollapse();
      return;
    }

    // 走 minimize_to_edge，**不是** set_edge_collapsed(true)。
    //
    // 后者在窗口没吸附时会直接 return（window.rs 里那句「没吸附就不该有收缩
    // 行为」），于是「鼠标离开就最小化」实际只在贴着屏幕边缘时才成立 ——
    // 窗口停在屏幕中间时按什么都没反应，这正是之前那个 bug。
    //
    // minimize_to_edge 自己分流：吸附了收缩成感应条，没吸附就隐藏窗口。
    collapseToEdge();
  }, COLLAPSE_DELAY);
}

/**
 * 窗口的活跃状态变了。
 *
 * 这是「鼠标扫过屏幕边缘会不会把窗口勾出来」的总开关（需求 1）：窗口不是当前
 * 活动窗口时，悬停不再展开，免得用户全屏看网页时被它打断。
 *
 * 判定源只有 Rust 的 WindowEvent::Focused 一处，不用 DOM 的 focus/blur ——
 * `document.hasFocus()` 受 webview 内部焦点（点到输入框、点到按钮）影响，
 * 和「这个窗口是不是系统当前活动窗口」不是一回事。
 */
function setActive(next) {
  active = next;

  if (next) {
    // 用户切回来了：保持出现
    expand();
  } else {
    // 切到别的程序了：若吸附则立刻收缩。
    // 复用 set_edge_collapsed 而不是 minimize_to_edge —— 后者在没吸附时会
    // 把窗口整个藏起来，那是灾难；前者没吸附时什么都不做，正合需求。
    cancelCollapse();
    setCollapsed(true);
  }
}

/** 置顶按钮的视觉状态要跟着真实设置走，而不是跟着点击动作走。 */
export function renderWindowUI() {
  const on = !!state.data.settings?.alwaysOnTop;
  const pin = document.getElementById('btn-pin');

  pin.setAttribute('aria-pressed', String(on));
  pin.title = on ? '取消置顶' : '窗口置顶';
  pin.style.opacity = on ? '1' : '0.5';
}

export function initWindow() {
  const { listen } = window.__TAURI__.event;

  // Rust 侧要求我们把输入框聚焦
  listen('minimemo://focus-input', () => focusInput());
  listen('minimemo://open-settings', () => openSettings());
  listen('minimemo://focus-changed', (e) => setActive(!!e.payload));

  document.getElementById('btn-pin').addEventListener('click', () => {
    const next = !state.data.settings?.alwaysOnTop;
    call('set_always_on_top', { value: next }).catch(() => {});
  });

  document.getElementById('btn-min').addEventListener('click', () => {
    // 已吸附就收缩成边缘感应条，没吸附就隐藏窗口。这个分流整个在 Rust 侧做
    // （minimize_to_edge），前端不先问一次再调一次 —— 中间那个往返窗口期里
    // 状态可能已经变了（比如刚按过 Esc），前端会拿着过期判断做错事。
    collapseToEdge();
  });

  document.getElementById('btn-hide').addEventListener('click', () => {
    // ✕ 只隐藏窗口，不退出进程 —— 退出只能走托盘菜单
    call('hide_window').catch(() => {});
  });

  // 记录「用户刚刚在打字」。compositionstart 是中文输入法必需的补充：
  // 拼音的候选阶段不会触发 input 事件。
  const input = document.getElementById('input');
  for (const ev of ['input', 'keydown', 'compositionstart']) {
    input.addEventListener(ev, () => {
      lastTypingAt = performance.now();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    if (state.ui.settingsOpen) {
      closeSettings();
      return;
    }

    // 吸附状态下先脱离边缘，否则窗口收成一条缝后很难再抓回来
    invoke('unsnap_window')
      .catch(() => {})
      .finally(() => call('hide_window').catch(() => {}));
  });

  // 边缘吸附：窗口缩成感应条后，鼠标进入即展开。
  //
  // 进出都要受 active 门控。只门控 mouseenter 的话，窗口未激活且**没吸附**时
  // 鼠标恰好划过窗口再离开，会走到 minimize_to_edge 的「没吸附」分支把窗口
  // 整个隐藏掉 —— 那正是需求 1 要消灭的同一类骚扰。
  document.documentElement.addEventListener('mouseenter', () => {
    if (active) expand();
  });
  document.documentElement.addEventListener('mouseleave', () => {
    if (active) scheduleCollapse();
  });
}
