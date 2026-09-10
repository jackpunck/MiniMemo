// 字体：系统字体枚举、自定义字体导入、应用到便签正文。
//
// 导入字体的加载方式是 `new FontFace(family, ArrayBuffer)`，而不是
// `@font-face { src: url(...) }`。后者要么走 file:// （被 WebView2 的
// origin 隔离挡掉），要么需要开启 asset protocol 并放宽 CSP，而且字体请求
// 是 CORS 模式的，跨 origin 能否通过并不确定。直接喂字节不发起任何请求，
// 因此不需要任何安全配置变更。

import { invoke, call, toast, state } from './state.js';

export const DEFAULT_CHAIN =
  '"Segoe UI", "Microsoft YaHei", "微软雅黑", system-ui, sans-serif';

/** id → true，避免重复构造 FontFace */
const loaded = new Map();

/**
 * 导入字体在 Rust 侧被分配的名字。
 * 与 `fonts.rs` 的 `format!("MiniMemo {}", &id[..8])` 保持一致。
 */
function familyOf(id) {
  return `MiniMemo ${id.slice(0, 8)}`;
}

/**
 * 确保导入字体的字节已经注册进文档。
 * 每次启动都需要重新做一遍 —— 字体字节不会跨进程缓存。
 */
export async function ensureFont(id) {
  if (!id || loaded.has(id)) return;

  const buf = await invoke('read_font', { id });
  const family = familyOf(id);
  const face = new FontFace(family, buf);

  await face.load();
  document.fonts.add(face);
  loaded.set(id, true);
}

/** 把字体链写进 CSS 变量，并同步到 boot.js 读取的那份缓存。 */
export function applyChain(chain) {
  const value = chain && chain.trim() ? chain : DEFAULT_CHAIN;
  document.documentElement.style.setProperty('--note-font', value);

  try {
    localStorage.setItem('minimemo.font', value);
  } catch {
    /* 缓存写不进去不影响使用 */
  }
}

/** 应用当前设置里的字体。启动时和每次改动后都调用。 */
export async function applyCurrentFont() {
  const s = state.data.settings || {};

  if (s.fontId) {
    try {
      await ensureFont(s.fontId);
    } catch (e) {
      // 字体文件没了不该阻塞启动，退回默认字体即可
      toast(`字体加载失败，已使用默认字体：${e}`);
      applyChain(DEFAULT_CHAIN);
      return;
    }
  }

  applyChain(s.fontFamily);
}

export async function loadFontList() {
  const list = await invoke('list_fonts');
  state.ui.fontList = list;
  state.ui.fontsLoaded = true;
  return list;
}

/** 选择字体。option 来自 list_fonts 返回的结构。 */
export async function chooseFont(option) {
  if (option.id) {
    await ensureFont(option.id);
  }
  const data = await call('set_font', { family: option.css, id: option.id ?? null });
  applyChain(data.settings.fontFamily);
}

export async function resetFont() {
  const data = await call('reset_font');
  applyChain(data.settings.fontFamily);
}

export async function removeFont(id) {
  const data = await call('remove_font', { id });
  loaded.delete(id);
  applyChain(data.settings.fontFamily);
}

/** 把 File 读成 base64（去掉 data URL 前缀）。 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 导入一个字体文件并立即启用。 */
export async function importFontFile(file) {
  const data = await fileToBase64(file);
  const snapshot = await call('import_font', { name: file.name, data });

  await applyCurrentFont();
  toast(`已导入并启用：${file.name}`);
  return snapshot;
}

export async function importBackgroundFile(file) {
  const data = await fileToBase64(file);
  return call('upload_background', { data });
}
