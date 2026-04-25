# @pdfme/common — Changelog

## Unreleased

### Changed

- Build script is now sequential (`build:cjs && build:esm && build:node`)
  rather than `run-p`, so a tsc failure on any single target aborts the
  whole build instead of leaving partial output behind.
- Each target tsconfig now excludes `dist/` from its inputs, and only the
  ESM target emits declaration files. This eliminates the `TS5055`
  ("Cannot write file because it would overwrite input file") class of bug
  that previously masked partial output.
- `prebuild` cleans `dist/` and runs `set-version.js`. `postbuild` runs
  `verify` (file presence + module-shape sanity) and `smoke` (require +
  dynamic import smoke load).
