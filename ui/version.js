// 版本号解析与比较。
//
// 刻意做成一个零依赖的纯函数模块：`update.js` 一 import `state.js` 就会去碰
// `window.__TAURI__`，在 node 里跑不起来。把这个逻辑单独拆出来，就能用
// `tools/check-version.mjs` 在本机直接验证 —— 这是「检查更新」里唯一
// 不需要联网、也不需要 Windows 实机就能测的部分。

/**
 * 把 `v1.2.3` / `1.2.3-beta.1` 拆成 `{ nums: [主, 次, 补], pre: 预发布标签 }`。
 * 缺的版本段补 0；解析不出数字的段也当 0（宁可判成同一个版本，也不要抛错）。
 */
function parse(value) {
  const s = String(value ?? '').trim().replace(/^v/i, '');
  const [core, ...rest] = s.split('-');

  const nums = core.split('.').map((part) => {
    const m = /^\d+/.exec(part);
    return m ? Number(m[0]) : 0;
  });
  while (nums.length < 3) nums.push(0);

  return { nums: nums.slice(0, 3), pre: rest.join('-') };
}

/**
 * `a` 是否比 `b` 新。
 *
 * 数值段逐个比较，前导 `v` 忽略。预发布版本按 semver 的规则排在对应的正式版
 * **之前**（`1.0.0-beta` < `1.0.0`）。
 *
 * 两个都带预发布标签时按字符串比 —— 这是 semver 的简化版（规范里数字标识符要
 * 按数值比、且标识符个数少者更小）。对本项目够用：GitHub 的 `/releases/latest`
 * 本身就不会返回 prerelease，这一支只是防御。
 */
export function isNewer(a, b) {
  const x = parse(a);
  const y = parse(b);

  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i];
  }

  if (x.pre === y.pre) return false;
  if (!x.pre) return true; // a 是正式版，b 是预发布版 → a 更新
  if (!y.pre) return false;
  return x.pre > y.pre;
}
