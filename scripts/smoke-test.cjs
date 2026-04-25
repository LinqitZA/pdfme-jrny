#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * smoke-test.cjs
 *
 * Loads the just-built package both as CJS and as ESM, in a child process, and
 * exits non-zero if either fails. Catches the class of bug where a build
 * succeeds but the dist artifact is unloadable (e.g. mixed ESM/CJS shape, missing
 * top-level index, missing dependency in dist).
 *
 * Run from a package directory (CWD = package root).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const pkgDir = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const name = pkg.name;

// Resolve the entry file we want to probe. Node's directory-import behaviour
// differs across ESM and CJS, and a bare directory import is unsupported in
// ESM, so we explicitly resolve the entry from package.json#exports / main /
// module and load that exact file. This catches the loadability bug end-to-end.
function resolveEntry(conditions) {
  // Walk the exports field with the requested conditions and return the first
  // string match. Fall back to main / module.
  const exportsField = pkg.exports;
  if (exportsField) {
    const root = typeof exportsField === 'string' ? { '.': exportsField } : exportsField;
    const dot = root['.'] || root;
    const resolved = walk(dot);
    if (resolved) return path.resolve(pkgDir, resolved);
  }
  if (conditions.includes('require') && pkg.main) return path.resolve(pkgDir, pkg.main);
  if (!conditions.includes('require') && pkg.module) return path.resolve(pkgDir, pkg.module);
  if (pkg.main) return path.resolve(pkgDir, pkg.main);
  return null;

  function walk(node) {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return null;
    for (const cond of conditions) {
      if (cond in node) {
        const v = walk(node[cond]);
        if (v) return v;
      }
    }
    if ('default' in node) return walk(node.default);
    return null;
  }
}

const cjsEntry = resolveEntry(['require', 'node', 'default']);
const esmEntry = resolveEntry(['import', 'node', 'default']);

if (!cjsEntry) {
  console.error(`${RED}smoke-test: ${name} no CJS entry resolvable from package.json${RESET}`);
  process.exit(1);
}
if (!esmEntry) {
  console.error(`${RED}smoke-test: ${name} no ESM entry resolvable from package.json${RESET}`);
  process.exit(1);
}

const cjsProbe = `
const m = require(${JSON.stringify(cjsEntry)});
if (m == null) { console.error('require returned null/undefined'); process.exit(1); }
const keys = Object.keys(m);
console.log('cjs keys:', keys.length);
`;

const esmProbe = `
import(${JSON.stringify('file://' + esmEntry)})
  .then(m => {
    if (!m) { console.error('import returned null/undefined'); process.exit(1); }
    const keys = Object.keys(m);
    console.log('esm keys:', keys.length);
  })
  .catch(err => { console.error(err); process.exit(1); });
`;

function run(label, args, stdin) {
  const res = spawnSync(process.execPath, args, {
    input: stdin,
    encoding: 'utf8',
    cwd: pkgDir,
  });
  if (res.status !== 0) {
    process.stdout.write(res.stdout || '');
    process.stderr.write(res.stderr || '');
    console.error(`${RED}smoke-test: ${name} ${label} FAILED (exit ${res.status})${RESET}`);
    return false;
  }
  return true;
}

console.log(`smoke-test :: ${name}`);

const okCjs = run('CJS require()', ['--input-type=commonjs', '-e', cjsProbe], '');
const okEsm = run('ESM import()', ['--input-type=module', '-e', esmProbe], '');

if (!okCjs || !okEsm) {
  process.exit(1);
}

console.log(`${GREEN}smoke-test: ${name} OK${RESET}`);
