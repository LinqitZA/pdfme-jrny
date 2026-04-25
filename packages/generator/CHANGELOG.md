# @pdfme/generator — Changelog

## Unreleased

### Fixed

- **Build pipeline produces complete `dist/node/` output unaided.** During the
  JRNY integration the generator's `dist/node/src/index.js` was missing
  entirely from a clean build; Node `import()` against the `node` export
  condition failed with `ERR_MODULE_NOT_FOUND`. The previous workaround was
  to manually copy pre-compiled `src/*.js` files into `dist/node/src/` after
  every build. That workaround is no longer needed.

### Changed

- Build script is now sequential (`build:cjs && build:esm && build:node`)
  rather than `run-p`, so a tsc failure on any single target aborts the whole
  build instead of leaving partial output behind.
- Added `prebuild` (cleans `dist/`) and `postbuild` (runs `verify` + `smoke`)
  hooks. The `verify` script asserts that every entry referenced by
  `package.json#exports` resolves to a real file and that each target's output
  has the expected module shape. The `smoke` script loads the built artifact
  via both `require()` and `import()` — both must succeed.
