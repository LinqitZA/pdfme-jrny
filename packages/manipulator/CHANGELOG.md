# @pdfme/manipulator — Changelog

## Unreleased

### Changed

- Build script is now sequential (`build:cjs && build:esm`) rather than
  `run-p`, so a tsc failure on either target aborts the whole build instead
  of leaving partial output behind.
- `tsconfig.cjs.json` no longer emits declarations (only the ESM target
  does); `dist/` is excluded from inputs to avoid the `TS5055` output
  collision.
- Added `prebuild` (cleans `dist/`) and `postbuild` (runs `verify` + `smoke`)
  hooks.
