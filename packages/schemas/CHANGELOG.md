# @pdfme/schemas — Changelog

## Unreleased

### Fixed

- **`dist/cjs/src/` is complete on a clean build.** During the JRNY
  integration `dist/cjs/src/` was missing `index.js`, `checkbox/`,
  `radioGroup/`, and `select/`; CJS `require('@pdfme/schemas')` from
  `@pdfme/generator` threw `Cannot find module '.../dist/cjs/src/index.js'`.
  The previous workaround was to manually copy pre-compiled CJS files into
  the `dist` paths. That workaround is no longer needed.
- **`dist/node/src/index.js` ships with the correct module shape.** Earlier
  the workaround for the missing CJS index was to copy a stray ESM `index.js`
  into `dist/node/src/` (whose subdirectories are CJS), which made Node's
  native ESM/CJS interop return `{ __esModule: true, default: schema }`
  instead of `schema`, causing every plugin's `propPanel` to appear
  `undefined` and breaking PDF generation with a Zod validation error.
  `dist/node/` is now produced as a uniform CJS-shape tree from a single tsc
  invocation; the manual file copy is no longer needed.
- **Inferred type errors for `rectangle` / `ellipse` are gone.** The TS
  errors `TS2742: The inferred type of 'rectangle' cannot be named without a
  reference to '../../../common/node_modules/antd/...'` were previously
  swallowed by the parallel build runner and produced partial output. They
  are now caught by the fail-fast sequential build and resolved via explicit
  `Plugin<ShapeSchema>` annotations.

### Added

- `smoke:schemas` script asserts that every exported plugin schema (`text`,
  `multiVariableText`, `image`, `svg`, `table`, `line`, `rectangle`,
  `ellipse`, `dateTime`, `date`, `time`, `select`, `radioGroup`, `checkbox`)
  plus every entry under `barcodes.*` has a defined `propPanel`, `pdf`, and
  `ui` after both ESM `import()` and CJS `require()` — directly catching the
  ESM/CJS interop class of bug at build time.

### Changed

- Build script is now sequential (`build:cjs && build:esm && build:node`)
  rather than `run-p`. Each target tsconfig now excludes `dist/` from inputs
  and only the ESM target emits declarations, eliminating the `TS5055`
  output-collision class of bug that previously masked partial CJS output.
- Added `prebuild` (cleans `dist/`) and `postbuild` (runs `verify` + `smoke`
  + `smoke:schemas`) hooks. `verify` asserts every directory under `src/`
  has a corresponding directory under each `dist/<target>/src/` so the
  "missing checkbox/radioGroup/select/" class of bug is caught at build
  time.
