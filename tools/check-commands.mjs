// 校验前端调用的每个 command 都真的在 Rust 侧注册了。
//
// invoke 一个不存在的 command 只会在运行时失败，而且前端往往把它吞在 catch 里，
// 表现成「点了没反应」。启动时静态比对一次比实机发现便宜得多。
//
// 用法：node tools/check-commands.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Rust 侧：generate_handler! 里注册的 command
const mainRs = readFileSync(join(root, 'src-tauri/src/main.rs'), 'utf8');
const block = mainRs.match(/generate_handler!\[([\s\S]*?)\]/);
if (!block) {
  console.error('未能在 main.rs 里找到 generate_handler!');
  process.exit(1);
}
const rust = new Set([...block[1].matchAll(/commands::(\w+)/g)].map((m) => m[1]));

// 前端：invoke('x') / call('x')
const uiDir = join(root, 'ui');
const js = new Set();
for (const f of readdirSync(uiDir).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(join(uiDir, f), 'utf8');
  for (const m of src.matchAll(/\b(?:invoke|call)\(\s*['"]([a-z_]+)['"]/g)) {
    js.add(m[1]);
  }
}

const sorted = (s) => [...s].sort().join(', ');
console.log(`Rust commands (${rust.size}): ${sorted(rust)}`);
console.log();
console.log(`JS invokes    (${js.size}): ${sorted(js)}`);
console.log();

const dangling = [...js].filter((c) => !rust.has(c));
const rustOnly = [...rust].filter((c) => !js.has(c));

if (dangling.length) {
  console.error(`✗ 前端调用了未注册的 command: ${dangling.join(', ')}`);
} else {
  console.log('✓ 前端调用的每个 command 都已在 Rust 侧注册');
}

// Rust 独有的通常是给托盘/内部调用的，不算错，只做提示
if (rustOnly.length) {
  console.log(`· 仅 Rust 内部调用: ${rustOnly.join(', ')}`);
}

process.exit(dangling.length ? 1 : 0);
