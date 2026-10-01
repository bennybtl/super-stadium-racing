// `npm run check`: run every `check:*` script in package.json, in order, even
// when an earlier one fails — a single stale golden shouldn't hide the rest.
// Prints each script's output, then a summary; exits non-zero if any failed.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const names = Object.keys(scripts).filter((n) => n.startsWith('check:'));

const results = names.map((name) => {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`);
  const start = Date.now();
  const { status } = spawnSync('npm', ['run', '-s', name], { cwd: root, stdio: 'inherit' });
  return { name, ok: status === 0, s: ((Date.now() - start) / 1000).toFixed(1) };
});

console.log('\n── summary ' + '─'.repeat(52));
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}  (${r.s}s)`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\nall ${results.length} checks pass`);
process.exit(failed.length ? 1 : 0);
