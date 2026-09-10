// 外观：用户可配的文字颜色、背景遮罩浓度与背景模糊。
//
// 只写 --note-* / --mask / --app-blur 这几个变量，**绝不碰 --text / --text-dim /
// --text-faint** —— 那三个是窗口 chrome（标题栏、设置面板、toast、字体列表）的
// 固定配色。如果把它们也改成用户的正文颜色，用户选了深色之后设置面板会变成
// 深底深字，再也改不回来。这个解耦是整套配色成立的前提。

/** 默认值与 state.rs 的 DEFAULT_TEXT_COLOR 必须一致。 */
export const DEFAULT_TEXT = '#f5f5f7';
export const DEFAULT_MASK = 0.28;
export const DEFAULT_BLUR = 6;

/**
 * 预设文字颜色。
 *
 * 刻意不用 `<input type="color">`：它会弹一个系统级对话框，在一个
 * transparent + alwaysOnTop 的窗口上行为不确定，而且和这个界面的观感不搭。
 */
export const TEXT_COLORS = [
  { value: '#f5f5f7', label: '白色' },
  { value: '#f2e8d5', label: '米色' },
  { value: '#c9ccd4', label: '浅灰' },
  { value: '#8a8f98', label: '深灰' },
  { value: '#1b1b1f', label: '黑色' },
  { value: '#ffc76b', label: '琥珀' },
];

/** 解析 #rgb / #rrggbb。校验逻辑与 Rust 侧 normalize_hex_color 保持一致。 */
function parseHex(input) {
  const h = String(input || '')
    .trim()
    .replace(/^#/, '');

  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(h)) return null;

  if (h.length === 3) {
    return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
  }
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** WCAG 相对亮度。用它而不是三通道加权平均，0.45 这个阈值才有一致的含义。 */
function luminance([r, g, b]) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function rgba([r, g, b], a) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function setHidden(id, hidden) {
  const el = document.getElementById(id);
  if (el) el.hidden = hidden;
}

/**
 * 写入正文颜色，并按颜色亮度反转投影方向。
 *
 * 反转这一步是让颜色选择真正好用的关键：亮色文字配暗投影、暗色文字配亮光晕。
 * 少了它，用户挑了深色正文之后再设一张暗背景图，会比默认白字还难读 ——
 * 颜色选择就从「解决问题的工具」变成了「制造问题的工具」。
 */
export function applyTextColor(color) {
  // 拿不到合法颜色就用默认值，绝不让非法值落到 CSS 里
  const rgb = parseHex(color) || parseHex(DEFAULT_TEXT);
  const root = document.documentElement.style;

  root.setProperty('--note-text', rgba(rgb, 1));
  root.setProperty('--note-text-dim', rgba(rgb, 0.6));
  root.setProperty('--note-text-faint', rgba(rgb, 0.4));

  root.setProperty(
    '--note-shadow',
    luminance(rgb) > 0.45
      ? '0 1px 2px rgba(0, 0, 0, 0.75), 0 0 6px rgba(0, 0, 0, 0.35)'
      : '0 1px 2px rgba(255, 255, 255, 0.55), 0 0 6px rgba(255, 255, 255, 0.3)',
  );
}

export function applyMaskOpacity(value) {
  const a = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.95) : DEFAULT_MASK;
  document.documentElement.style.setProperty('--mask', `rgba(18, 18, 18, ${a})`);
}

export function applyBlur(value) {
  const px = Number.isFinite(value) ? Math.min(Math.max(value, 0), 24) : DEFAULT_BLUR;
  document.documentElement.style.setProperty('--app-blur', `${px}px`);
}

/**
 * 按当前设置刷新全部外观变量。
 *
 * 每次 command 返回都会调到，所以必须是幂等的：同样的输入必须得到同样的结果，
 * 不能有累加或状态残留。
 */
export function applyAppearance(settings) {
  const s = settings || {};

  applyTextColor(s.textColor || DEFAULT_TEXT);
  applyMaskOpacity(Number.isFinite(s.maskOpacity) ? s.maskOpacity : DEFAULT_MASK);
  applyBlur(Number.isFinite(s.blur) ? s.blur : DEFAULT_BLUR);

  // 两个滑块互斥，各自只在真正管用时出现：
  //
  //   没有自定义图片 → 只有「背景模糊」生效（没有图片可遮）
  //   有自定义图片   → 模糊被 CSS 强制关掉（body.has-image #app），只剩「背景遮罩」
  //
  // 判据取 body.has-image 而不是 settings.bgType：两者在正常情况下一致，但图片
  // 文件丢失时 background.js 会把 class 摘掉回退到默认背景，而 bgType 还是
  // 'image'。以实际在屏上的那一层为准，面板才不会显示一个不起作用的滑块。
  const hasImage = document.body.classList.contains('has-image');
  for (const id of ['blur-label', 'blur-row']) setHidden(id, hasImage);
  for (const id of ['mask-label', 'mask-row']) setHidden(id, !hasImage);
}
