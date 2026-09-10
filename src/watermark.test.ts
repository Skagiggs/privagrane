import { describe, expect, it, vi } from 'vitest';
import { detectKind, fontSizeFor, outName, paintWatermark } from './watermark';

/**
 * Contexte canvas 2D minimal qui enregistre les appels au lieu de vraiment
 * dessiner - il n'y a pas de vrai <canvas> en environnement Node, et on ne
 * teste pas le rendu pixel par pixel mais la logique d'application du
 * filigrane (texte, couleur, opacité, rotation, motif).
 */
function createFakeContext(measuredTextWidth = 40) {
  const calls: { fillText: [string, number, number][] } = { fillText: [] };
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    measureText: vi.fn(() => ({ width: measuredTextWidth })),
    fillText: vi.fn((text: string, x: number, y: number) => {
      calls.fillText.push([text, x, y]);
    }),
    globalAlpha: 1,
    fillStyle: '',
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, raw: ctx, calls };
}

describe('fontSizeFor', () => {
  it('scales with the smaller dimension and the size percentage', () => {
    expect(fontSizeFor(40, false, 1000, 500)).toBeCloseTo(500 * 0.4 * 0.28);
  });

  it('uses a smaller multiplier when tiled than when centered', () => {
    const tiled = fontSizeFor(40, true, 1000, 500);
    const centered = fontSizeFor(40, false, 1000, 500);
    expect(tiled).toBeLessThan(centered);
  });

  it('never returns less than the 6px floor', () => {
    expect(fontSizeFor(5, true, 10, 10)).toBe(6);
  });
});

describe('outName', () => {
  it('replaces the extension and appends the -filigrane suffix', () => {
    expect(outName('rapport.pdf', 'pdf')).toBe('rapport-filigrane.pdf');
  });

  it('handles file names without an extension', () => {
    expect(outName('rapport', 'png')).toBe('rapport-filigrane.png');
  });

  it('falls back to "document" when no file name is known', () => {
    expect(outName('', 'jpg')).toBe('document-filigrane.jpg');
  });
});

describe('detectKind', () => {
  it('recognises PDFs by MIME type', () => {
    expect(detectKind('application/pdf', 'fichier')).toBe('pdf');
  });

  it('recognises PDFs by file extension when the MIME type is missing', () => {
    expect(detectKind('', 'rapport.PDF')).toBe('pdf');
  });

  it('recognises images by MIME type', () => {
    expect(detectKind('image/png', 'photo.png')).toBe('image');
    expect(detectKind('image/webp', 'photo.webp')).toBe('image');
  });

  it('rejects unsupported formats', () => {
    expect(detectKind('application/zip', 'archive.zip')).toBe('');
  });
});

describe('paintWatermark', () => {
  const baseOptions = {
    text: 'CONFIDENTIEL',
    color: '#c0392b',
    size: 40,
    opacity: 28,
    rotation: -30,
    tile: false,
  };

  it('does nothing when the watermark text is blank', () => {
    const { ctx, raw } = createFakeContext();
    paintWatermark(ctx, 800, 600, { ...baseOptions, text: '   ' });
    expect(raw.save).not.toHaveBeenCalled();
    expect(raw.fillText).not.toHaveBeenCalled();
  });

  it('applies the requested color and opacity', () => {
    const { ctx, raw } = createFakeContext();
    paintWatermark(ctx, 800, 600, baseOptions);
    expect(raw.fillStyle).toBe(baseOptions.color);
    expect(raw.globalAlpha).toBeCloseTo(baseOptions.opacity / 100);
  });

  it('rotates the canvas according to the requested orientation', () => {
    const { ctx, raw } = createFakeContext();
    paintWatermark(ctx, 800, 600, baseOptions);
    expect(raw.rotate).toHaveBeenCalledWith((-baseOptions.rotation * Math.PI) / 180);
  });

  it('draws a single centered watermark when tiling is disabled', () => {
    const { ctx, calls } = createFakeContext();
    paintWatermark(ctx, 800, 600, { ...baseOptions, tile: false });
    expect(calls.fillText).toEqual([[baseOptions.text, 0, 0]]);
  });

  it('draws a repeated pattern covering the canvas when tiling is enabled', () => {
    const { ctx, calls } = createFakeContext();
    paintWatermark(ctx, 800, 600, { ...baseOptions, tile: true });
    expect(calls.fillText.length).toBeGreaterThan(1);

    const xs = calls.fillText.map(([, x]) => x);
    const ys = calls.fillText.map(([, , y]) => y);
    expect(Math.min(...xs)).toBeLessThan(-400);
    expect(Math.max(...xs)).toBeGreaterThan(400);
    expect(Math.min(...ys)).toBeLessThan(-300);
    expect(Math.max(...ys)).toBeGreaterThan(300);
  });

  it('always restores the context after painting', () => {
    const { ctx, raw } = createFakeContext();
    paintWatermark(ctx, 800, 600, baseOptions);
    expect(raw.save).toHaveBeenCalledTimes(1);
    expect(raw.restore).toHaveBeenCalledTimes(1);
  });
});
