// 窗口行为：焦点、快捷键、置顶按钮、边缘吸附的悬停展开。

import { invoke, call, state } from './state.js';
import { focusInput } from './todos.js';
import { closeSettings, openSettings } from './settings.js';

/** 鼠标离开后延迟收缩，避免在边缘来回移动时反复展开/收缩。 */
const COLLAPSE_DELAY = 450;

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
    // 设置面板开着的时候不要收缩，否则用户点不到
    if (state.ui.settingsOpen) return;
    invoke('set_edge_collapsed', { collapsed: true }).catch(() => {});
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
