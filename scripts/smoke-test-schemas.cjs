#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * smoke-test-schemas.cjs
 *
 * Schemas-specific smoke test. Imports `@pdfme/schemas` (from its on-disk path)
 * via dynamic ESM import AND via require, and asserts that every exported
 * schema plugin has a defined `propPanel`, `pdf`, and `ui`.
 *
 * Catches the ESM/CJS interop class of bug where the wrapper looks like
 *   { __esModule: true, default: schema }
 * which makes `schema.propPanel` appear undefined to consumers — exactly the
 * production-blocking bug observed during the JRNY integration after a stray
 * ESM index was placed inside a CJS subtree of `dist/node/src/`.
 *
 * Must be run from the @pdfme/schemas package directory.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const pkgDir = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
if (pkg.name !== '@pdfme/schemas') {
  console.error(`smoke-test-schemas must run inside @pdfme/schemas (got ${pkg.name})`);
  process.exit(2);
}

function resolveEntry(conditions) {
  const exportsField = pkg.exports;
  if (exportsField) {
    const root = typeof exportsField === 'string' ? { '.': exportsField } : exportsField;
    const dot = root['.'] || root;
    const resolved = walk(dot);
    if (resolved) return path.resolve(pkgDir, resolved);
  }
  if (conditions.includes('require') && pkg.main) return path.resolve(pkgDir, pkg.main);
  if (!conditions.includes('require') && pkg.module) return path.resolve(pkgDir, pkg.module);
  return pkg.main ? path.resolve(pkgDir, pkg.main) : null;

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
const esmEntryUrl = 'file://' + esmEntry;

// Plugin schemas exported from @pdfme/schemas. Each MUST expose propPanel/pdf/ui.
const PLUGIN_SCHEMAS = [
  'text',
  'multiVariableText',
  'image',
  'svg',
  'table',
  'line',
  'rectangle',
  'ellipse',
  'dateTime',
  'date',
  'time',
  'select',
  'radioGroup',
  'checkbox',
];

const REQUIRED_FIELDS = ['propPanel', 'pdf', 'ui'];

const probe = `
(async () => {
  const required = ${JSON.stringify(REQUIRED_FIELDS)};
  const plugins = ${JSON.stringify(PLUGIN_SCHEMAS)};
  const errors = [];

  // ESM dynamic import
  const esm = await import(${JSON.stringify(esmEntryUrl)});
  for (const name of plugins) {
    const s = esm[name];
    if (!s || typeof s !== 'object') {
      errors.push('ESM: ' + name + ' is not an object (got ' + typeof s + ')');
      continue;
    }
    for (const f of required) {
      if (s[f] === undefined) {
        errors.push('ESM: ' + name + '.' + f + ' is undefined');
      }
    }
  }

  // barcodes is a map of barcode-name -> schema
  if (esm.barcodes && typeof esm.barcodes === 'object') {
    for (const name of Object.keys(esm.barcodes)) {
      const s = esm.barcodes[name];
      if (!s || typeof s !== 'object') {
        errors.push('ESM: barcodes.' + name + ' is not an object');
        continue;
      }
      for (const f of required) {
        if (s[f] === undefined) errors.push('ESM: barcodes.' + name + '.' + f + ' is undefined');
      }
    }
  } else {
    errors.push('ESM: barcodes export missing or not an object');
  }

  if (errors.length > 0) {
    console.error(errors.join('\\n'));
    process.exit(1);
  }
  console.log('schemas ESM probe: OK (' + plugins.length + ' plugins + ' + Object.keys(esm.barcodes || {}).length + ' barcodes)');
})();
`;

const esmRes = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
  cwd: pkgDir,
  encoding: 'utf8',
});

if (esmRes.status !== 0) {
  process.stdout.write(esmRes.stdout || '');
  process.stderr.write(esmRes.stderr || '');
  console.error(`${RED}smoke-test-schemas: ESM probe FAILED${RESET}`);
  process.exit(1);
}
process.stdout.write(esmRes.stdout || '');

// CJS require probe
const cjsProbe = `
const required = ${JSON.stringify(REQUIRED_FIELDS)};
const plugins = ${JSON.stringify(PLUGIN_SCHEMAS)};
const errors = [];
const cjs = require(${JSON.stringify(cjsEntry)});
for (const name of plugins) {
  const s = cjs[name];
  if (!s || typeof s !== 'object') {
    errors.push('CJS: ' + name + ' is not an object (got ' + typeof s + ')');
    continue;
  }
  for (const f of required) {
    if (s[f] === undefined) errors.push('CJS: ' + name + '.' + f + ' is undefined');
  }
}
if (cjs.barcodes && typeof cjs.barcodes === 'object') {
  for (const name of Object.keys(cjs.barcodes)) {
    const s = cjs.barcodes[name];
    if (!s || typeof s !== 'object') {
      errors.push('CJS: barcodes.' + name + ' is not an object');
      continue;
    }
    for (const f of required) {
      if (s[f] === undefined) errors.push('CJS: barcodes.' + name + '.' + f + ' is undefined');
    }
  }
} else {
  errors.push('CJS: barcodes export missing or not an object');
}
if (errors.length > 0) {
  console.error(errors.join('\\n'));
  process.exit(1);
}
console.log('schemas CJS probe: OK (' + plugins.length + ' plugins + ' + Object.keys(cjs.barcodes || {}).length + ' barcodes)');
`;

const cjsRes = spawnSync(process.execPath, ['--input-type=commonjs', '-e', cjsProbe], {
  cwd: pkgDir,
  encoding: 'utf8',
});

if (cjsRes.status !== 0) {
  process.stdout.write(cjsRes.stdout || '');
  process.stderr.write(cjsRes.stderr || '');
  console.error(`${RED}smoke-test-schemas: CJS probe FAILED${RESET}`);
  process.exit(1);
}
process.stdout.write(cjsRes.stdout || '');

console.log(`${GREEN}smoke-test-schemas: OK${RESET}`);
