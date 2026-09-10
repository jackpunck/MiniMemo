// 窗口行为：焦点、快捷键、置顶按钮、边缘吸附的悬停展开。

import { invoke, call, state } from './state.js';
import { focusInput } from './todos.js';
import { closeSettings, openSettings } from './settings.js';

/**
 * 鼠标离开后延迟最小化。
 *
 * 1 秒：够把指针挪到相邻窗口而不误触发，又不会让窗口「赖着不走」。
 */
const COLLAPSE_DELAY = 1000;

let collapseTimer = null;

function cancelCollapse() {
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
}

function expand() {
  cancelCollapse();
  // 未吸附时 Rust 侧会直接返回，不需要前端先判断
  invoke('set_edge_collapsed', { collapsed: false }).catch(() => {});
}

function scheduleCollapse() {
  cancelCollapse();
  collapseTimer = setTimeout(() => {
    // 设置面板开着的时候不要收缩，否则用户点不到。
    // 这里是**重新排程**而不是直接 return：这条 timer 链是自动收缩唯一的触发源，
    // 直接返回等于把它掐断 —— 用户关掉设置面板之后，窗口就再也不自动收缩了。
    if (state.ui.settingsOpen) {
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
    // 和标题栏那个 — 按钮完全同一个行为，判断也整条留在 Rust 侧做。
    invoke('minimize_to_edge').catch(() => {});
  }, COLLAPSE_DELAY);
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

  document.getElementById('btn-pin').addEventListener('click', () => {
    const next = !state.data.settings?.alwaysOnTop;
    call('set_always_on_top', { value: next }).catch(() => {});
  });

  document.getElementById('btn-min').addEventListener('click', () => {
    // 已吸附就收缩成边缘感应条，没吸附就隐藏窗口。这个分流整个在 Rust 侧做
    // （minimize_to_edge），前端不先问一次再调一次 —— 中间那个往返窗口期里
    // 状态可能已经变了（比如刚按过 Esc），前端会拿着过期判断做错事。
    invoke('minimize_to_edge').catch(() => {});
  });

  document.getElementById('btn-hide').addEventListener('click', () => {
    // ✕ 只隐藏窗口，不退出进程 —— 退出只能走托盘菜单
    call('hide_window').catch(() => {});
  });

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

  // 边缘吸附：窗口缩成感应条后，鼠标进入即展开
  document.documentElement.addEventListener('mouseenter', expand);
  document.documentElement.addEventListener('mouseleave', scheduleCollapse);

  // 窗口获得焦点时也展开一次，键盘用户不会被困在感应条里
  window.addEventListener('focus', expand);
}
