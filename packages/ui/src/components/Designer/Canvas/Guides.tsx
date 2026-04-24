import React, { Ref } from 'react';
import GuidesComponent from '@scena/react-guides';
import { ZOOM, Size } from '@pdfme/common';
import { RULER_HEIGHT } from '../../../constants.js';

/** JRNY theme-aligned ruler background (slate-700) */
const RULER_BG = '#334155';

const guideStyle = (
  top: number,
  left: number,
  height: number,
  width: number,
): React.CSSProperties => ({
  position: 'absolute',
  top,
  left,
  height,
  width,
  background: RULER_BG,
});

const _Guides = ({
  paperSize,
  horizontalRef,
  verticalRef,
  rulerSpan,
}: {
  paperSize: Size;
  horizontalRef: Ref<GuidesComponent> | undefined;
  verticalRef: Ref<GuidesComponent> | undefined;
  /** Optional extended ruler dimensions computed by Paper.
   *  hWidth / hLeft span the full canvas; vHeight spans the full canvas height. */
  rulerSpan?: { hWidth: number; hLeft: number; vHeight: number };
}) => {
  // When rulerSpan is provided, extend rulers to fill the canvas area.
  // Otherwise fall back to paper-only dimensions (backwards compatible).
  const hWidth = rulerSpan ? rulerSpan.hWidth : paperSize.width;
  const hLeft = rulerSpan ? rulerSpan.hLeft : 0;
  const vHeight = rulerSpan ? rulerSpan.vHeight : paperSize.height;

  return (
    <>
      {/* Corner square where horizontal & vertical rulers meet */}
      <div
        className="ruler-container"
        style={guideStyle(-RULER_HEIGHT, -RULER_HEIGHT, RULER_HEIGHT, RULER_HEIGHT)}
      />
      {/* Horizontal ruler — spans full canvas width */}
      <GuidesComponent
        zoom={ZOOM}
        style={guideStyle(-RULER_HEIGHT, hLeft, RULER_HEIGHT, hWidth)}
        type="horizontal"
        ref={horizontalRef}
      />
      {/* Vertical ruler — spans full canvas height */}
      <GuidesComponent
        zoom={ZOOM}
        style={guideStyle(0, -RULER_HEIGHT, vHeight, RULER_HEIGHT)}
        type="vertical"
        ref={verticalRef}
      />
    </>
  );
};

export default _Guides;
