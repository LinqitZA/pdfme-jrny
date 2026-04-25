# @pdfme/converter — Changelog

## Unreleased

### Fixed

- `package.json#main` and `package.json#module` now point at the actual
  emitted entry files (`dist/cjs/src/index.node.js` and
  `dist/esm/src/index.browser.js`) rather than the non-existent
  `dist/cjs/src/index.js` / `dist/esm/src/index.js`. The package compiles
  `index.node.ts` and `index.browser.ts` only — there is no top-level
  `index.ts` — so the previous `main` / `module` paths were dead pointers
  that worked only because every consumer happened to use the `exports`
  field instead.

### Changed

- Build script is now sequential (`build:cjs && build:esm`) rather than
  `run-p`, so a tsc failure on either target aborts the whole build instead
  of leaving partial output behind.
- `tsconfig.cjs.json` no longer emits declarations (only the ESM target
  does); `dist/` is excluded from inputs.
- Added `prebuild` (cleans `dist/`) and `postbuild` (runs `verify`) hooks.
