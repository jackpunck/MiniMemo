// 设置面板：字体选择、背景、快捷键与数据目录信息。

import { state, invoke, toast } from './state.js';
import * as fonts from './fonts.js';

let filter = '';

// ---------------------------------------------------------------------------
// 字体列表
// ---------------------------------------------------------------------------

/**
 * 当前选中项是否匹配这个字体选项。
 *
 * 直接比对整条 CSS 链：`fontFamily` 是我们选择时原样存进去的 `option.css`，
 * 由 Rust 的 chain_for 确定性生成，所以两者必然逐字符相等。
 * 比解析字体链的第一段可靠得多 —— 字体族名本身可以含逗号。
 */
function isActive(option) {
  const s = state.data.settings || {};
  return !!s.fontFamily && option.css === s.fontFamily;
}

function currentFontLabel() {
  const s = state.data.settings || {};

  const option = (state.ui.fontList || []).find((o) => o.css === s.fontFamily);
  if (option) return option.name;

  if (s.fontId) {
    const found = (s.customFonts || []).find((f) => f.id === s.fontId);
    if (found) return found.label;
  }

  return '默认字体';
}

function fontItem(option) {
  const el = document.createElement('div');
  el.className = 'font-item' + (isActive(option) ? ' active' : '');
  el.setAttribute('role', 'option');
  el.setAttribute('aria-selected', String(isActive(option)));

  // 预览直接用该字体渲染 —— WebView2 已经持有全部系统字体，无需加载任何文件
  el.style.fontFamily = option.css;
  el.title = option.name;

  const label = document.createElement('span');
  // 用户文件名是不可信字符串，必须 textContent
  label.textContent = option.name;
  el.append(label);

  if (!option.builtin && option.id) {
    const del = document.createElement('span');
    del.className = 'font-item-del';
    del.textContent = '×';
    del.title = '移除这个字体';
    del.addEventListener('click', async (e) => {
      e.stopPropagation(); // 别把点击当成选择
      try {
        await fonts.removeFont(option.id);
        renderFontList();
      } catch {
        /* 已经提示过 */
      }
    });
    el.append(del);
  }

  el.addEventListener('click', async () => {
    try {
      await fonts.chooseFont(option);
      renderFontList();
      updateCurrentLabel();
    } catch {
      /* 已经提示过 */
    }
  });

  return el;
}

export function renderFontList() {
  const box = document.getElementById('font-list');
  const q = filter.trim().toLowerCase();

  const all = state.ui.fontList || [];
  const matched = q
    ? all.filter(
        (o) =>
          o.name.toLowerCase().includes(q) || String(o.css).toLowerCase().includes(q),
      )
    : all;

  const custom = matched.filter((o) => !o.builtin);
  const builtin = matched.filter((o) => o.builtin);

  const frag = document.createDocumentFragment();

  if (matched.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'font-item';
    empty.style.color = 'rgba(255,255,255,.38)';
    empty.textContent = q ? '没有匹配的字体' : '没有可用字体';
    frag.append(empty);
  }

  if (custom.length) {
    const head = document.createElement('div');
    head.className = 'font-group';
    head.textContent = '已导入';
    frag.append(head);
    for (const o of custom) frag.append(fontItem(o));
  }

  if (builtin.length) {
    const head = document.createElement('div');
    head.className = 'font-group';
    head.textContent = `系统字体 (${builtin.length})`;
    frag.append(head);
    for (const o of builtin) frag.append(fontItem(o));
  }

  box.replaceChildren(frag);
}

function updateCurrentLabel() {
  document.getElementById('font-current').textContent = currentFontLabel();
  // 用当前字体渲染这一行，给用户一个直观的确认
  document.getElementById('font-current').style.fontFamily =
    state.data.settings?.fontFamily || fonts.DEFAULT_CHAIN;
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

export function openSettings() {
  document.getElementById('settings').hidden = false;
  state.ui.settingsOpen = true;

  // 首次打开时才拉字体列表：枚举系统字体有一定开销，不该拖慢启动
  if (!state.ui.fontsLoaded) {
    fonts
      .loadFontList()
      .then(() => renderFontList())
      .catch(() => toast('字体列表加载失败'));
  } else {
    renderFontList();
  }

  updateCurrentLabel();
  renderInfo();
}

export function closeSettings() {
  document.getElementById('settings').hidden = true;
  state.ui.settingsOpen = false;
}

export function toggleSettings() {
  if (state.ui.settingsOpen) closeSettings();
  else openSettings();
}

async function renderInfo() {
  try {
    const info = await invoke('runtime_info');

    const shortcut = document.getElementById('shortcut-hint');
    shortcut.textContent = info.shortcutActive
      ? `${info.shortcut}（已生效）`
      : `${info.shortcut} 未能注册，可能被其他程序占用 —— 请改用托盘图标`;

    const dir = document.getElementById('data-dir');
    dir.textContent = info.dataDir || '—';
    dir.title = info.dataDir || '';
  } catch {
    /* 信息区是锦上添花，失败就不显示 */
  }
}

export function initSettings() {
  document.getElementById('btn-settings').addEventListener('click', toggleSettings);
  document.getElementById('btn-settings-close').addEventListener('click', closeSettings);

  document.getElementById('font-search').addEventListener('input', (e) => {
    filter = e.target.value;
    renderFontList();
  });

  document.getElementById('btn-font-import').addEventListener('click', () => {
    document.getElementById('file-font').click();
  });

  document.getElementById('file-font').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许连续选择同一个文件
    if (!file) return;

    const btn = document.getElementById('btn-font-import');
    btn.disabled = true;

    try {
      await fonts.importFontFile(file);
      await fonts.loadFontList();
      renderFontList();
      updateCurrentLabel();
    } catch {
      /* call() 已经弹过提示 */
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-font-reset').addEventListener('click', async () => {
    try {
      await fonts.resetFont();
      renderFontList();
      updateCurrentLabel();
    } catch {
      /* 已经提示过 */
    }
  });

  document.getElementById('btn-bg-reset').addEventListener('click', async () => {
    const { resetBackground } = await import('./background.js');
    try {
      await resetBackground();
    } catch {
      /* 已经提示过 */
    }
  });

  document.getElementById('btn-bg-import').addEventListener('click', () => {
    document.getElementById('file-bg').click();
  });
}
