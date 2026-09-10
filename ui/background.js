// 背景：默认毛玻璃 / 自定义图片。
//
// 图片在导入时就已经被复制进应用数据目录，所以即使用户之后移动或删除了
// 原图，背景也不会失效（规格 §12.3）。这里只负责把字节取回来显示。

import { invoke, state, toast } from './state.js';

let objectUrl = null;

function setImageVisible(visible) {
  const bg = document.getElementById('bg');
  bg.classList.toggle('visible', visible);
  document.body.classList.toggle('has-image', visible);
}

function clearImage() {
  const bg = document.getElementById('bg');
  bg.style.backgroundImage = '';
  setImageVisible(false);

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

/** 根据当前设置刷新背景层。 */
export async function applyCurrentBackground() {
  const settings = state.data.settings || {};

  if (settings.bgType !== 'image' || !settings.bgPath) {
    clearImage();
    // 默认的毛玻璃/亚克力效果完全由 CSS 提供，无需额外处理
    return;
  }

  try {
    const buf = await invoke('read_background');
    const blob = new Blob([buf]);
    const url = URL.createObjectURL(blob);

    // 先挂新的再撤旧的，避免中间出现一帧空白
    const previous = objectUrl;
    objectUrl = url;

    const bg = document.getElementById('bg');
    bg.style.backgroundImage = `url("${url}")`;
    setImageVisible(true);

    if (previous) URL.revokeObjectURL(previous);
  } catch (e) {
    // 背景文件丢失是「非致命问题」，退回默认背景即可（规格 §21）
    console.warn('背景加载失败，回退到默认背景', e);
    toast('背景图片已丢失，已恢复默认背景');
    clearImage();
  }
}

export async function resetBackground() {
  const { call } = await import('./state.js');
  await call('reset_background');
  clearImage();
}

export function initBackground() {
  document.getElementById('btn-bg').addEventListener('click', () => {
    document.getElementById('file-bg').click();
  });

  document.getElementById('file-bg').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许连续选择同一个文件
    if (!file) return;

    const { importBackgroundFile } = await import('./fonts.js');
    try {
      await importBackgroundFile(file);
      await applyCurrentBackground();
    } catch {
      /* call() 已经弹过提示 */
    }
  });
}
