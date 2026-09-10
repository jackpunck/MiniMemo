// 拖动排序。
//
// 用 Pointer Events 而不是 HTML5 拖放：后者在 WebView2 里会带出系统拖影，
// 和这个界面的观感不搭，而且那个影子不可控。
//
// 依赖两个前提，都写在排序逻辑里：
//
// 1. **未完成的行是连续的一段，且排在已完成项前面。** 由 state.rs 的
//    sort_todos 保证 —— completed 是第一排序键，已完成项永远沉底。
// 2. **每行严格等高。** 由 .todo 无 margin、.list 无 gap、.todo-text 强制
//    nowrap 保证。给其中任何一个加上 margin / line-height / gap，位移就会算错。
//
// 另外，这里只提交**未完成**项的顺序：拖动跨不过「已完成」那条边界，
// 让它参与排序没有意义（sort 会把它拽回去）。

import { call, notify } from './state.js';

/** 位移超过这个像素数才算拖动，否则当作一次普通点击。 */
const DRAG_THRESHOLD = 5;

let drag = null;

/** app.js 用它决定要不要跳过这一轮重绘。 */
export function isDragging() {
  return drag !== null && drag.active;
}

export function initDrag(list) {
  list.addEventListener('pointerdown', onPointerDown);
}

function draggableItems(list) {
  return [...list.querySelectorAll('li.todo:not(.completed)')];
}

function onPointerDown(e) {
  if (e.button !== 0) return;

  const li = e.target.closest?.('li.todo');
  if (!li) return;
  // 勾选框和删除按钮有自己的点击语义，别抢
  if (e.target.closest('input, button')) return;
  // 已完成项永远沉底，拖动它只会白跑一次 IPC
  if (li.classList.contains('completed')) return;
  if (drag) return; // 一次只允许一个

  const draggables = draggableItems(e.currentTarget);
  const index = draggables.indexOf(li);
  if (index < 0) return;

  drag = {
    li,
    draggables,
    index,
    pointerId: e.pointerId,
    startY: e.clientY,
    rowH: li.offsetHeight || 1,
    active: false,
    shift: 0,
  };

  // 监听挂在 document 上，**不能**挂在 li 上。
  //
  // 捕获是在越过阈值之后才设的，在那之前事件得靠冒泡经过 li —— 而阈值还没判定
  // 时指针就可能已经移出了这一行（比如在行的最下沿按下、往下拖），那样 li 上的
  // 监听再也收不到 pointermove，「越过阈值」这个判断永远不会发生，拖动根本起不来。
  // document 在冒泡链顶端，捕获前后都收得到。
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  // 兜底：li 万一在拖动中被移出 DOM（capture 会随之丢失），别把用户卡在半路
  li.addEventListener('lostpointercapture', onPointerCancel);
}

function detach(d) {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
  d.li.removeEventListener('lostpointercapture', onPointerCancel);
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;

  if (!drag.active) {
    if (Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;

    // 关键：**不能**在 pointerdown 里就 capture。一旦捕获，click 会被重定向到
    // li 上，用户在勾选框上按下再轻微抖动，勾选就失效了。只有确认这是拖动、
    // 用户的意图已经不再是点击之后，才接管指针。
    drag.active = true;

    // 捕获只是为了让指针移出窗口后仍能收到事件，不是拖动成立的前提 ——
    // 监听在 document 上，捕获失败也照常能用，所以这里吞掉异常不作数。
    try {
      drag.li.setPointerCapture(e.pointerId);
    } catch {
      /* 拿不到捕获不影响本次拖动 */
    }

    drag.li.classList.add('dragger');
    document.body.classList.add('dragging');
  }

  e.preventDefault(); // 别让 WebView2 起一段原生文本选择

  const dy = e.clientY - drag.startY;

  // 拖动中那一行不能带 transition，否则会跟不上指针
  drag.li.classList.remove('shifting');
  drag.li.style.transform = `translateY(${dy}px)`;

  const raw = Math.round(dy / drag.rowH);
  const shift = Math.max(
    -drag.index,
    Math.min(raw, drag.draggables.length - 1 - drag.index),
  );

  if (shift === drag.shift) return;
  drag.shift = shift;
  layout();
}

/** 让没被拖动的行给拖动行腾位置。 */
function layout() {
  const { draggables, index, shift, rowH, li } = drag;

  for (let i = 0; i < draggables.length; i++) {
    const el = draggables[i];
    if (el === li) continue;

    let offset = 0;
    if (shift > 0 && i > index && i <= index + shift) offset = -rowH;
    else if (shift < 0 && i < index && i >= index + shift) offset = rowH;

    el.classList.add('shifting');
    el.style.transform = offset ? `translateY(${offset}px)` : '';
  }
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  finish(true);
}

function onPointerCancel(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  finish(false);
}

/** 清掉拖动状态与全部视觉痕迹。必须在 call() 之前跑完（见下面的注释）。 */
function cleanup(d) {
  drag = null;
  detach(d);
  d.li.classList.remove('dragger');
  document.body.classList.remove('dragging');

  for (const el of d.draggables) {
    el.classList.remove('shifting');
    el.style.transform = '';
  }
}

function finish(commit) {
  const d = drag;
  if (!d) return;

  const wasActive = d.active;
  const target = d.index + d.shift;
  const ids = d.draggables.map((el) => el.dataset.id);

  // 顺序很重要：先把 drag 置空，isDragging() 才会在 call() 返回触发重绘时
  // 已经是 false —— 否则那一轮重绘会被 app.js 当成「拖动中」再跳过一次。
  cleanup(d);

  if (!wasActive) return; // 没越过阈值 = 一次普通点击，什么都没变

  if (!commit || target === d.index) {
    // 取消，或顺序其实没动 —— 重绘回去就行，不必白跑一次 IPC + fsync
    notify();
    return;
  }

  const [moved] = ids.splice(d.index, 1);
  ids.splice(target, 0, moved);

  // 成功路径不用手动重绘：call() 返回时 setData 会 emit，那时 isDragging()
  // 已经是 false，render() 正常跑。
  call('reorder_todos', { ids }).catch(() => notify());
}

/**
 * 兜底：任何绕过 render() 的整表重建之前调用它，免得留下拖动残迹。
 *
 * 这里刻意**不** notify()：调用方正要重建整表，再触发一轮渲染只会多画一次，
 * 而且 renderList → cancelDrag → notify → render → renderList 会绕回去。
 */
export function cancelDrag() {
  if (drag) cleanup(drag);
}
