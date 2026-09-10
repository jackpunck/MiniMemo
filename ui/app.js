// 启动与装配。

import { call, subscribe, toast } from './state.js';
import { initTodos, renderList, focusInput } from './todos.js';
import { initBackground, applyCurrentBackground } from './background.js';
import { initSettings } from './settings.js';
import { initWindow, renderWindowUI } from './window.js';
import { applyCurrentFont } from './fonts.js';

function render() {
  renderList();
  renderWindowUI();
}

async function boot() {
  // 先把交互装上，这样即使后端初始化慢，界面也已经可点
  initTodos();
  initSettings();
  initBackground();
  initWindow();

  // 在首次加载前订阅，load_state 写回数据时就会自动完成第一轮渲染
  subscribe(render);

  try {
    await call('load_state');
  } catch (e) {
    toast(`数据加载失败：${e}`);
    return;
  }

  // 由 body.loading 把内容挡住，等字体就位再显示。
  //
  // 系统字体其实不需要这一步（boot.js 已经用缓存抢在首次绘制前设好了），
  // 但导入字体做不到 —— 它的字节每次启动都要重新注册，只能等异步返回。
  // 不挡的话会先按回退字体画一帧，再肉眼可见地跳变。
  try {
    await applyCurrentFont();
  } catch (e) {
    console.warn('字体应用失败', e);
  }

  reveal();
  await applyCurrentBackground();
  render();

  focusInput();
}

function reveal() {
  clearTimeout(revealTimer);
  document.body.classList.remove('loading');
}

// 兜底：万一行程里出了没预料到的异常，也不能让窗口永远空着
const revealTimer = setTimeout(reveal, 2000);

boot();
