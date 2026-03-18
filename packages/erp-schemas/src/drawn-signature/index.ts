/**
 * Drawn Signature schema plugin
 *
 * At render time, resolves the user's signature PNG from FileStorageService
 * and embeds it as an image in the PDF. Uses the pdfme image plugin internally.
 *
 * The input value should be a base64 data URI of the signature PNG,
 * resolved by the render service before generation.
 *
 * Fallback behaviour:
 * - If no signature: renders empty (blank space)
 * - If signature exists: embeds the PNG at the field position
 *
 * Schema properties:
 * - type: 'drawnSignature'
 * - fallback: 'blank' | 'placeholder' (default: 'blank')
 */

export interface DrawnSignatureSchema {
  type: 'drawnSignature';
  fallback?: 'blank' | 'placeholder';
  position: { x: number; y: number };
  width: number;
  height: number;
  [key: string]: unknown;
}

/**
 * Placeholder 1x1 transparent PNG for fallback
 */
export const TRANSPARENT_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * The drawnSignature plugin definition.
 * The pdf rendering is delegated to the image plugin by the render service,
 * which resolves the signature data before calling pdfme generate().
 */
export const drawnSignature = {
  /**
   * Type identifier for this schema
   */
  type: 'drawnSignature' as const,

  /**
   * Default properties for a new drawnSignature element
   */
  defaultSchema: {
    type: 'drawnSignature',
    fallback: 'blank',
    position: { x: 0, y: 0 },
    width: 50,
    height: 25,
  },

  /**
   * Resolve the signature data for rendering.
   * Called by the render service to convert drawnSignature fields
   * into image-compatible base64 data URIs.
   *
   * @param signaturePngBuffer - The user's signature PNG as a Buffer, or null
   * @param fallback - Fallback behaviour: 'blank' or 'placeholder'
   * @returns base64 data URI string for the image plugin
   */
  resolveSignatureData(
    signaturePngBuffer: Buffer | null,
    fallback: 'blank' | 'placeholder' = 'blank',
  ): string {
    if (signaturePngBuffer && signaturePngBuffer.length > 0) {
      return `data:image/png;base64,${signaturePngBuffer.toString('base64')}`;
    }

    // No signature available - use fallback
    if (fallback === 'placeholder') {
      // Return a small placeholder image (transparent)
      return TRANSPARENT_PNG_DATA_URI;
    }

    // 'blank' fallback - return empty string (no image rendered)
    return '';
  },
};
