#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * verify-dist.cjs
 *
 * Post-build verification for pdfme-jrny packages.
 *
 * Run from a package directory (CWD = package root). Exits non-zero on any
 * inconsistency, so it can be wired into `postbuild` and CI to prevent
 * partial / shape-broken dists from being published.
 *
 * What it checks (per package):
 *   1. Every output target tsc was supposed to emit (cjs, esm, node) has a
 *      top-level `dist/<target>/src/index.js` (and `utils.js` for schemas).
 *   2. `dist/types/src/index.d.ts` exists.
 *   3. Every directory that exists under `src/` (e.g. `barcodes/`, `checkbox/`,
 *      `radioGroup/`, `select/`) also exists under each target's `dist/<t>/src/`.
 *   4. CJS (`dist/cjs/`) and Node (`dist/node/`, when there is no
 *      `"type": "module"` in package.json) outputs are CJS-shape — i.e. they
 *      contain `exports.` / `module.exports` / `require(` and DO NOT contain
 *      top-level `import ` or `export ` statements.
 *   5. ESM (`dist/esm/`) output is ESM-shape — i.e. it contains `import`/`export`
 *      keywords and does NOT use `require(`.
 *   6. Every path inside `package.json#exports` resolves to a real file.
 *
 * The schemas package is also checked here — if `src/index.ts` references
 * `propPanel`, `pdf`, or `ui` (i.e. it's a plugin schema package), the file
 * shape rules above already catch the ESM/CJS interop class of bug because a
 * stray ESM index inside a CJS subtree would either (a) produce ESM-shape
 * output in `dist/cjs/`, which the regex check rejects, or (b) be detected
 * by the schemas-specific smoke test (`smoke-test-schemas.cjs`).
 */

const fs = require('fs');
const path = require('path');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}
function ok(msg) {
  log(`  ${GREEN}✓${RESET} ${msg}`);
}
function fail(msg) {
  log(`  ${RED}✗${RESET} ${msg}`);
}
function warn(msg) {
  log(`  ${YELLOW}!${RESET} ${msg}`);
}

const errors = [];

function assert(cond, msg) {
  if (cond) {
    ok(msg);
  } else {
    fail(msg);
    errors.push(msg);
  }
}

const pkgDir = process.cwd();
const pkgJsonPath = path.join(pkgDir, 'package.json');
if (!fs.existsSync(pkgJsonPath)) {
  console.error(`verify-dist: no package.json at ${pkgDir}`);
  process.exit(2);
}
const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
const name = pkg.name;

log(`\nverify-dist :: ${name}`);

// Detect which targets this package is supposed to build by looking at its
// build:* scripts. Falls back to detecting present tsconfig.<target>.json.
const buildScripts = pkg.scripts || {};
const targets = [];
const targetScript = (t) => buildScripts[`build:${t}`];

if (targetScript('cjs') || fs.existsSync(path.join(pkgDir, 'tsconfig.cjs.json'))) {
  targets.push('cjs');
}
if (targetScript('esm') || fs.existsSync(path.join(pkgDir, 'tsconfig.esm.json'))) {
  targets.push('esm');
}
if (targetScript('node') || fs.existsSync(path.join(pkgDir, 'tsconfig.node.json'))) {
  targets.push('node');
}

if (targets.length === 0) {
  warn(`no cjs/esm/node tsconfig detected — skipping detailed verification`);
}

const distDir = path.join(pkgDir, 'dist');
const srcDir = path.join(pkgDir, 'src');

// 1. Every target has at least one top-level entry .js under dist/<t>/src/.
// Most packages compile `src/index.ts` -> `dist/<t>/src/index.js`, but some
// (e.g. @pdfme/converter) emit `index.node.js` / `index.browser.js` instead.
// We treat any `dist/<t>/src/*.js` file at depth 1 (excluding .map / .d.ts) as
// a valid entry, and additionally cross-check every `src/*.ts` top-level file.
function listTopLevelTsEntries() {
  if (!fs.existsSync(srcDir)) return [];
  return fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.ts') && !d.name.endsWith('.d.ts'))
    .map((d) => d.name.replace(/\.ts$/, ''));
}
const topLevelEntries = listTopLevelTsEntries();

// Determined once: at least one tsconfig has `declaration: true`.
const expectsTypes =
  targets.length > 0 &&
  targets.some((t) => {
    const tsconfigPath = path.join(pkgDir, `tsconfig.${t}.json`);
    if (!fs.existsSync(tsconfigPath)) return false;
    const raw = fs.readFileSync(tsconfigPath, 'utf8');
    return /"declaration"\s*:\s*true/.test(raw);
  });

for (const t of targets) {
  const tSrcDir = path.join(distDir, t, 'src');
  assert(
    fs.existsSync(tSrcDir) && fs.statSync(tSrcDir).isDirectory(),
    `dist/${t}/src/ exists`,
  );
  if (!fs.existsSync(tSrcDir)) continue;

  // Each top-level src/*.ts must have a compiled .js sibling in this target.
  for (const entry of topLevelEntries) {
    const expected = path.join(tSrcDir, `${entry}.js`);
    assert(
      fs.existsSync(expected),
      `dist/${t}/src/${entry}.js exists (compiled from src/${entry}.ts)`,
    );
  }
}

// Each top-level src/*.ts must also have a corresponding .d.ts in dist/types/src/
// when declarations are emitted by at least one target build.
if (expectsTypes) {
  for (const entry of topLevelEntries) {
    const dts = path.join(distDir, 'types', 'src', `${entry}.d.ts`);
    assert(fs.existsSync(dts), `dist/types/src/${entry}.d.ts exists`);
  }
}

// 3. Every subdirectory under src/ (containing an index.ts or .ts files) exists
// under each dist target. Helps catch the "schemas dist/cjs missing checkbox/
// radioGroup/select/" class of bug.
function listSrcSubdirs() {
  if (!fs.existsSync(srcDir)) return [];
  return fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
const srcSubdirs = listSrcSubdirs();
for (const t of targets) {
  for (const sub of srcSubdirs) {
    const expected = path.join(distDir, t, 'src', sub);
    // only require the subdirectory if it has at least one .ts file
    const srcSub = path.join(srcDir, sub);
    const hasTs = fs.existsSync(srcSub) && walkHasTs(srcSub);
    if (!hasTs) continue;
    assert(
      fs.existsSync(expected) && fs.statSync(expected).isDirectory(),
      `dist/${t}/src/${sub}/ exists`,
    );
  }
}

function walkHasTs(dir) {
  if (!fs.existsSync(dir)) return false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      return true;
    }
    if (entry.isDirectory()) {
      if (walkHasTs(path.join(dir, entry.name))) return true;
    }
  }
  return false;
}

// 4 & 5. Shape consistency check.
// We sample a handful of files in each target to verify the module shape.
function isCjsShape(content) {
  // A type-only TS file compiles to a stub that contains only:
  //   "use strict"; Object.defineProperty(exports, "__esModule", { value: true });
  // — a valid (empty-but-marked) CJS module. We treat that as CJS-shape too.
  const stripped = content.replace(/\/\/[^\n]*\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const hasCjsMarker =
    /(\bexports\.|\bmodule\.exports\b|\brequire\s*\(|Object\.defineProperty\s*\(\s*exports\b|"use strict")/.test(
      stripped,
    );
  const hasEsmKeyword = /^(?:import\s|export\s|export\{|export\s*\*|export\s*default)/m.test(stripped);
  return hasCjsMarker && !hasEsmKeyword;
}

function isEsmShape(content) {
  const stripped = content.replace(/\/\/[^\n]*\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const hasEsmMarker = /^(?:import\s|export\s|export\{|export\s*\*|export\s*default)/m.test(stripped);
  // ESM must NOT use require( or module.exports (compiled CJS markers).
  // We deliberately allow `exports` references that the TS compiler may emit
  // in helpers, since a real ESM file would not contain `module.exports = ` or
  // top-level `require(`.
  const hasCjsMarker = /(?:\bmodule\.exports\b|\brequire\s*\()/.test(stripped);
  // A type-only ESM stub may compile to just `export {};`. Treat that as ESM.
  if (!hasEsmMarker && /^\s*export\s*\{\s*\}\s*;?\s*$/m.test(stripped)) {
    return !hasCjsMarker;
  }
  return hasEsmMarker && !hasCjsMarker;
}

function sampleFiles(dir, max = 20) {
  const out = [];
  function walk(d) {
    if (out.length >= max) return;
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= max) return;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.map')) {
        out.push(p);
      }
    }
  }
  walk(dir);
  return out;
}

function targetExpectsCjsShape(target) {
  if (target === 'cjs') return true;
  if (target === 'esm') return false;
  if (target === 'node') {
    // dist/node/ shape depends on package.json#type. NodeNext respects it.
    // No "type": "module" -> CJS shape. "type": "module" -> ESM shape.
    return pkg.type !== 'module';
  }
  return null;
}

for (const t of targets) {
  const tDir = path.join(distDir, t);
  if (!fs.existsSync(tDir)) continue;
  const files = sampleFiles(tDir, 30);
  if (files.length === 0) {
    fail(`dist/${t}/ has no .js files`);
    errors.push(`dist/${t}/ has no .js files`);
    continue;
  }
  const expectCjs = targetExpectsCjsShape(t);
  let bad = 0;
  let firstBad = '';
  for (const f of files) {
    const c = fs.readFileSync(f, 'utf8');
    const isCjs = isCjsShape(c);
    const isEsm = isEsmShape(c);
    if (expectCjs && !isCjs) {
      bad++;
      if (!firstBad) firstBad = f;
    } else if (!expectCjs && !isEsm) {
      bad++;
      if (!firstBad) firstBad = f;
    }
  }
  assert(
    bad === 0,
    `dist/${t}/ files are ${expectCjs ? 'CJS' : 'ESM'}-shape (sampled ${files.length}${
      firstBad ? `; first violation: ${path.relative(pkgDir, firstBad)}` : ''
    })`,
  );
}

// 6. Every path in package.json#exports resolves to a real file.
function checkExportsField(exp, pathSoFar) {
  if (typeof exp === 'string') {
    if (!exp.startsWith('.')) return; // ignore non-relative
    const resolved = path.join(pkgDir, exp);
    assert(fs.existsSync(resolved), `exports[${pathSoFar}] = ${exp} resolves`);
    return;
  }
  if (exp && typeof exp === 'object') {
    for (const key of Object.keys(exp)) {
      checkExportsField(exp[key], `${pathSoFar}.${key}`);
    }
  }
}

if (pkg.exports) {
  checkExportsField(pkg.exports, '');
}

// Also check main / module / types
if (pkg.main) {
  assert(
    fs.existsSync(path.join(pkgDir, pkg.main)),
    `package.json#main = ${pkg.main} resolves`,
  );
}
if (pkg.module) {
  assert(
    fs.existsSync(path.join(pkgDir, pkg.module)),
    `package.json#module = ${pkg.module} resolves`,
  );
}
if (pkg.types) {
  assert(
    fs.existsSync(path.join(pkgDir, pkg.types)),
    `package.json#types = ${pkg.types} resolves`,
  );
}

if (errors.length > 0) {
  log(`\n${RED}verify-dist: ${errors.length} failure(s) for ${name}${RESET}`);
  process.exit(1);
}
log(`${GREEN}verify-dist: ${name} OK${RESET}`);
