import React, { Ref } from 'react';
import GuidesComponent from '@scena/react-guides';
import { theme } from 'antd';
import { ZOOM, Size } from '@pdfme/common';
import { RULER_HEIGHT } from '../../../constants.js';

/**
 * Ruler background colour — complements the JRNY slate palette.
 *
 * The canvas background is slate-200 (#e2e8f0) and the page surface is white.
 * A medium-dark slate provides visual contrast without the jarring #333333
 * that was used previously. Sits between colorTextSecondary (slate-500)
 * and colorText (slate-900) in the theme scale.
 *
 * Falls back to this colour when antd token.colorTextSecondary is unavailable
 * or too transparent for an opaque ruler strip.
 */
const RULER_BG_FALLBACK = '#475569'; // slate-600

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

  // Prefer a theme-derived ruler colour when the token is opaque.
  // The JRNY theme sets colorTextSecondary to slate-500 (#64748b) which is
  // slightly lighter than ideal for a ruler strip, so we shift one stop darker.
  // In dark-mode themes this will auto-adapt via the token system.
  const rulerBg =
    token.colorTextSecondary && !token.colorTextSecondary.startsWith('rgba')
      ? token.colorTextSecondary
      : RULER_BG_FALLBACK;

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
        style={guideStyle(-RULER_HEIGHT, hLeft, RULER_HEIGHT, hWidth, rulerBg)}
        type="horizontal"
        ref={horizontalRef}
      />
      {/* Vertical ruler — spans full canvas height */}
      <GuidesComponent
        zoom={ZOOM}
        style={guideStyle(0, -RULER_HEIGHT, vHeight, RULER_HEIGHT, rulerBg)}
        type="vertical"
        ref={verticalRef}
      />
    </>
  );
};

export default _Guides;
