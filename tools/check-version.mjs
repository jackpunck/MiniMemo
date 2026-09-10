// 版本号比较的自测。
//
// 「检查更新」的其余部分都要联网 + Windows 实机才能验证，只有这一段是纯逻辑，
// 也恰恰是最容易写错、错了又最难发现的（判成「已是最新」时用户什么提示都看不到）。
// 所以把它单独测掉。
//
// 用法：node tools/check-version.mjs

import { isNewer } from '../ui/version.js';

let failed = 0;

function check(a, b, expected) {
  const got = isNewer(a, b);
  const ok = got === expected;
  if (!ok) failed++;
  const mark = ok ? '✓' : '✗';
  console.log(`${mark} isNewer(${JSON.stringify(a)}, ${JSON.stringify(b)}) = ${got}`);
}

// 数值段逐位比较，不要按字符串比（"0.10.0" > "0.9.0"）
check('v0.2.0', 'v0.1.1', true);
check('v0.1.1', 'v0.2.0', false);
check('v0.10.0', 'v0.9.0', true);
check('v0.1.10', 'v0.1.9', true);

// 前导 v 可有可无，两边不统一也要能比
check('0.2.0', 'v0.1.1', true);
check('v0.2.0', '0.1.1', true);

// 相等（含只差前导 v 的）永远不是「更新」
check('v0.1.1', 'v0.1.1', false);
check('0.1.1', 'v0.1.1', false);

// 缺段补 0
check('v1.2', 'v1.1.9', true);
check('v1', 'v1.0.0', false);

// 预发布排在对应正式版之前
check('v0.2.0-beta.1', 'v0.2.0', false);
check('v0.2.0', 'v0.2.0-beta.1', true);

// 解析不出来的段当 0，不抛错
check('v1.x.0', 'v1.0.0', false);

console.log();

if (failed) {
  console.error(`✗ ${failed} 条断言未通过`);
  process.exit(1);
}
console.log('✓ 版本号比较全部通过');
