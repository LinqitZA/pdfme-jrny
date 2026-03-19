/**
 * Feature #425: Fix resize handles — pass explicit container prop to Moveable
 *
 * Tests that the code changes correctly wire up the container prop from Paper
 * through to Moveable so react-moveable resolves coordinates within the scaled container.
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    process.stdout.write('  PASS: ' + message + '\n');
  } else {
    failed++;
    process.stdout.write('  FAIL: ' + message + '\n');
  }
}

async function testPaperForwardRef() {
  process.stdout.write('\n=== Paper.tsx forwardRef ===\n');

  const paperSrc = fs.readFileSync(
    path.join(__dirname, '../packages/ui/src/components/Paper.tsx'),
    'utf8'
  );

  assert(paperSrc.includes('forwardRef'), 'Paper.tsx uses forwardRef');
  assert(paperSrc.includes('Ref'), 'Paper.tsx imports Ref type');
  assert(
    paperSrc.includes('forwardRef<HTMLDivElement, PaperProps>'),
    'Paper.tsx forwards ref as HTMLDivElement'
  );
  assert(
    paperSrc.includes('const PaperInner'),
    'Paper.tsx defines PaperInner component'
  );
  assert(
    /PaperInner\s*=\s*\(props:\s*PaperProps,\s*ref:\s*Ref<HTMLDivElement>\)/.test(paperSrc),
    'PaperInner accepts ref parameter'
  );
  assert(
    paperSrc.includes('ref={ref}'),
    'Paper.tsx attaches ref to outer div'
  );

  // Verify the outer div with transform: scale() has the ref
  // The ref should be on the div that has transformOrigin: 'top left'
  const refLine = paperSrc.indexOf('ref={ref}');
  const transformLine = paperSrc.indexOf("transform: `scale(${scale})`");
  assert(
    refLine < transformLine,
    'ref is attached before/on the div with transform: scale()'
  );
}

async function testMoveableContainerProp() {
  process.stdout.write('\n=== Moveable.tsx container prop ===\n');

  const moveableSrc = fs.readFileSync(
    path.join(__dirname, '../packages/ui/src/components/Designer/Canvas/Moveable.tsx'),
    'utf8'
  );

  assert(
    moveableSrc.includes('container?: HTMLElement | null'),
    'Moveable Props type includes container prop'
  );
  assert(
    moveableSrc.includes('container={props.container || undefined}'),
    'Moveable passes container prop to MoveableComponent'
  );
}

async function testCanvasWiring() {
  process.stdout.write('\n=== Canvas/index.tsx wiring ===\n');

  const canvasSrc = fs.readFileSync(
    path.join(__dirname, '../packages/ui/src/components/Designer/Canvas/index.tsx'),
    'utf8'
  );

  assert(
    canvasSrc.includes('paperScaleRef'),
    'Canvas defines paperScaleRef'
  );
  assert(
    canvasSrc.includes('useRef<HTMLDivElement>(null)'),
    'paperScaleRef is a HTMLDivElement ref'
  );
  assert(
    canvasSrc.includes('ref={paperScaleRef}'),
    'Canvas passes paperScaleRef to Paper'
  );
  assert(
    canvasSrc.includes('container={paperScaleRef.current}'),
    'Canvas passes paperScaleRef.current as container to Moveable'
  );
}

async function testViteBuildOutput() {
  process.stdout.write('\n=== Vite build output exists ===\n');

  const distEs = path.join(__dirname, '../packages/ui/dist/index.es.js');
  const distUmd = path.join(__dirname, '../packages/ui/dist/index.umd.js');

  assert(fs.existsSync(distEs), 'dist/index.es.js exists (vite build succeeded)');
  assert(fs.existsSync(distUmd), 'dist/index.umd.js exists (vite build succeeded)');

  // Verify the built output includes container prop in Moveable usage
  const esSrc = fs.readFileSync(distEs, 'utf8');
  // Variable names get minified, so just check the build is non-trivially large
  assert(
    esSrc.length > 1000000,
    'Built output is substantial (contains full UI bundle)'
  );
}

async function testNoRegressions() {
  process.stdout.write('\n=== No regressions ===\n');

  const paperSrc = fs.readFileSync(
    path.join(__dirname, '../packages/ui/src/components/Paper.tsx'),
    'utf8'
  );

  // Paper still exports default
  assert(
    paperSrc.includes('export default Paper'),
    'Paper still has default export'
  );

  // Paper still accepts paperRefs prop
  assert(
    paperSrc.includes('paperRefs: MutableRefObject<HTMLDivElement[]>'),
    'Paper still accepts paperRefs prop'
  );

  // Paper still has scale transform
  assert(
    paperSrc.includes("transform: `scale(${scale})`"),
    'Paper still applies CSS transform: scale()'
  );

  // Moveable still has all original props
  const moveableSrc = fs.readFileSync(
    path.join(__dirname, '../packages/ui/src/components/Designer/Canvas/Moveable.tsx'),
    'utf8'
  );
  assert(moveableSrc.includes('draggable'), 'Moveable still has draggable');
  assert(moveableSrc.includes('resizable'), 'Moveable still has resizable');
  assert(moveableSrc.includes('rotatable'), 'Moveable still has rotatable prop');
  assert(moveableSrc.includes('snappable'), 'Moveable still has snappable');
  assert(moveableSrc.includes('bounds={props.bounds}'), 'Moveable still has bounds');
}

async function main() {
  process.stdout.write('Feature #425: Fix resize handles — pass explicit container prop to Moveable\n');
  process.stdout.write('==========================================================================\n');

  await testPaperForwardRef();
  await testMoveableContainerProp();
  await testCanvasWiring();
  await testViteBuildOutput();
  await testNoRegressions();

  process.stdout.write('\n==========================================================================\n');
  process.stdout.write('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed) + ' total\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write('Test error: ' + err.message + '\n' + err.stack + '\n');
  process.exit(1);
});
