/**
 * Logique de filigranage pure, indépendante du DOM : calcul de mise en page
 * et rendu sur un contexte canvas. Séparée de main.ts pour rester testable
 * sans navigateur (voir watermark.test.ts).
 */

export type DocKind = 'pdf' | 'image' | '';

export interface WatermarkOptions {
  text: string;
  color: string;
  size: number; // 5-100
  opacity: number; // 5-100
  rotation: number; // -90..90
  tile: boolean;
}

export function fontSizeFor(size: number, tile: boolean, w: number, h: number): number {
  return Math.max(6, (size / 100) * Math.min(w, h) * (tile ? 0.16 : 0.28));
}

export function outName(fileName: string, ext: string): string {
  return (fileName || 'document').replace(/\.[^.]+$/, '') + '-filigrane.' + ext;
}

export function detectKind(mime: string, name: string): DocKind {
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (/^image\//.test(mime)) return 'image';
  return '';
}

/**
 * Paints the watermark onto a canvas already showing the source page/image.
 * The tiled pattern is deliberately dense - instances overlap rather than
 * leaving clean gaps - so it can't be cropped or inpainted out without also
 * damaging the underlying content.
 */
export function paintWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: WatermarkOptions,
): void {
  const text = opts.text.trim();
  if (!text) return;

  const fs = fontSizeFor(opts.size, opts.tile, w, h);
  ctx.save();
  ctx.globalAlpha = opts.opacity / 100;
  ctx.fillStyle = opts.color;
  ctx.font = '700 ' + fs + 'px Manrope, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-opts.rotation * Math.PI) / 180);

  if (opts.tile) {
    const tw = ctx.measureText(text).width;
    const stepX = tw + fs * 0.5;
    const stepY = fs * 1.3;
    const R = Math.hypot(w, h) / 2 + Math.max(stepX, stepY);
    let row = 0;
    for (let y = -R; y <= R; y += stepY) {
      const off = (row % 2) * (stepX / 2);
      for (let x = -R; x <= R; x += stepX) ctx.fillText(text, x + off, y);
      row++;
    }
  } else {
    ctx.fillText(text, 0, 0);
  }
  ctx.restore();
}
