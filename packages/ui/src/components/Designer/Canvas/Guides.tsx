import React, { Ref } from 'react';
import GuidesComponent from '@scena/react-guides';
import { theme } from 'antd';
import { ZOOM, Size } from '@pdfme/common';
import { RULER_HEIGHT } from '../../../constants.js';

/**
 * Ruler background colour — light grey strip with visible markings.
 *
 * The canvas background is slate-200 (#e2e8f0). The ruler should be lighter
 * than the canvas (almost white) so markings (rendered by @scena/react-guides
 * in a darker colour) remain clearly legible.
 */
const RULER_BG = '#f1f5f9'; // slate-100 — light grey ruler strip

const guideStyle = (
  top: number,
  left: number,
  height: number,
  width: number,
  background: string,
): React.CSSProperties => ({
  position: 'absolute',
  top,
  left,
  height,
  width,
  background,
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
  const { token } = theme.useToken();

  const rulerBg = RULER_BG;

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
        style={guideStyle(-RULER_HEIGHT, -RULER_HEIGHT, RULER_HEIGHT, RULER_HEIGHT, rulerBg)}
      />
      {/* Horizontal ruler — spans full canvas width */}
      <GuidesComponent
        zoom={ZOOM}
        unit={5}
        segment={5}
        textColor="#334155"
        lineColor="#94a3b8"
        style={guideStyle(-RULER_HEIGHT, hLeft, RULER_HEIGHT, hWidth, rulerBg)}
        type="horizontal"
        ref={horizontalRef}
      />
      {/* Vertical ruler — spans full canvas height */}
      <GuidesComponent
        zoom={ZOOM}
        unit={5}
        segment={5}
        textColor="#334155"
        lineColor="#94a3b8"
        style={guideStyle(0, -RULER_HEIGHT, vHeight, RULER_HEIGHT, rulerBg)}
        type="vertical"
        ref={verticalRef}
      />
    </>
  );
};

export default _Guides;
