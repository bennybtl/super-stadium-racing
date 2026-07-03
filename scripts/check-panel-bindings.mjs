// Editor panel binding check: `npm run check:panels`
//
// The editor panels bind to the store's two generic actions:
//   setFeatureProp('hill', 'radiusX', v) → EditorController.changeHillRadiusX
//   featureAction('deleteSelectedHill')  → EditorController.deleteSelectedHill
// The dispatch is by naming convention, so a typo'd panel binding fails
// silently at runtime. This script statically verifies that every such
// binding in src/vue resolves to a method defined on EditorController.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const controllerSrc = readFileSync(join(root, 'src', 'editor', 'EditorController.js'), 'utf8');
const hasMethod = (name) => new RegExp(`^  (?:async )?${name}\\(`, 'm').test(controllerSrc);

function* vueFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* vueFiles(p);
    else if (entry.name.endsWith('.vue')) yield p;
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const problems = [];
let checked = 0;

for (const file of vueFiles(join(root, 'src', 'vue'))) {
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(root.length + 1);

  for (const m of text.matchAll(/setFeatureProp\(\s*'(\w+)'\s*,\s*'(\w+)'/g)) {
    checked++;
    const method = `change${cap(m[1])}${cap(m[2])}`;
    if (!hasMethod(method)) problems.push(`${rel}: setFeatureProp('${m[1]}', '${m[2]}') → no EditorController.${method}`);
  }
  for (const m of text.matchAll(/featureAction\(\s*'(\w+)'/g)) {
    checked++;
    if (!hasMethod(m[1])) problems.push(`${rel}: featureAction('${m[1]}') → no EditorController.${m[1]}`);
  }
}

if (problems.length) {
  console.log(`${problems.length} unresolved panel binding(s):`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log(`all ${checked} panel bindings resolve to EditorController methods`);
