# @pdfme/pdf-lib — Changelog

## Unreleased

### Changed

- Build script is now sequential (`build:cjs && build:esm && build:node`)
  rather than `run-p`, so a tsc failure on any single target aborts the whole
  build instead of leaving partial output behind.
- Each target tsconfig now excludes `dist/` from its inputs.
- Added `prebuild` (cleans `dist/`) and `postbuild` (runs `verify` + `smoke`)
  hooks.
