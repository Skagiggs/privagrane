import type * as PdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type * as PdfLib from 'pdf-lib';

/**
 * Filigrane local - logique de filigranage 100% navigateur.
 * PDF : pdf.js pour l'aperçu ET pour rasteriser les pages à l'export,
 *       pdf-lib pour reconstruire le PDF exporté à partir de ces images.
 * Image : Canvas 2D pour l'aperçu et l'export.
 * Aucun fichier n'est jamais transmis à un serveur.
 *
 * L'export PDF est rendu page par page en image puis réassemblé (au lieu de
 * superposer le texte du filigrane comme objet PDF séparé) : le filigrane
 * n'est alors plus un élément qu'on peut sélectionner et supprimer en un
 * clic dans un éditeur PDF. Combiné à un motif dense qui chevauche le
 * contenu, l'effacer abîme le document. Ce n'est pas du chiffrement, mais
 * ça rend le filigrane bien plus difficile à retirer proprement.
 *
 * pdf.js et pdf-lib ne sont chargés que si un PDF est réellement utilisé
 * (import() dynamique) : les visiteurs qui ne filigranent qu'une image ne
 * téléchargent jamais ces ~800 Ko de bibliothèques.
 */

let pdfjsLibPromise: Promise<typeof PdfjsLib> | null = null;
async function getPdfjsLib(): Promise<typeof PdfjsLib> {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const [lib, workerUrl] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((m) => m.default),
      ]);
      lib.GlobalWorkerOptions.workerSrc = workerUrl;
      return lib;
    })();
  }
  return pdfjsLibPromise;
}

let pdfLibPromise: Promise<typeof PdfLib> | null = null;
async function getPdfLib(): Promise<typeof PdfLib> {
  if (!pdfLibPromise) pdfLibPromise = import('pdf-lib');
  return pdfLibPromise;
}

type DocKind = 'pdf' | 'image' | '';

interface WatermarkState {
  text: string;
  color: string;
  size: number; // 5-100
  opacity: number; // 5-100
  rotation: number; // -90..90
  tile: boolean;

  hasFile: boolean;
  kind: DocKind;
  fileName: string;
  mime: string;
  page: number;
  pages: number;
  loading: boolean;
}

interface BaseRender {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable`);
  return el as T;
}

const dom = {
  fileInput: byId<HTMLInputElement>('wm-file'),
  dropzone: byId<HTMLLabelElement>('dropzone'),
  fileChip: byId<HTMLDivElement>('file-chip'),
  fileChipName: byId<HTMLSpanElement>('file-chip-name'),
  fileError: byId<HTMLParagraphElement>('file-error'),

  text: byId<HTMLInputElement>('wm-text'),
  colorPicker: byId<HTMLInputElement>('wm-color'),
  swatches: [...document.querySelectorAll<HTMLButtonElement>('.swatch')],

  size: byId<HTMLInputElement>('wm-size'),
  sizeLabel: byId<HTMLSpanElement>('size-label'),
  opacity: byId<HTMLInputElement>('wm-opacity'),
  opacityLabel: byId<HTMLSpanElement>('opacity-label'),
  rotation: byId<HTMLInputElement>('wm-rotation'),
  rotationLabel: byId<HTMLSpanElement>('rotation-label'),

  tileToggle: byId<HTMLButtonElement>('tile-toggle'),
  tileTrack: byId<HTMLSpanElement>('tile-track'),
  tileHint: byId<HTMLSpanElement>('tile-hint'),

  pager: byId<HTMLDivElement>('pager'),
  pageLabel: byId<HTMLSpanElement>('page-label'),
  prevPage: byId<HTMLButtonElement>('prev-page'),
  nextPage: byId<HTMLButtonElement>('next-page'),

  exportBtn: byId<HTMLButtonElement>('export-btn'),
  exportLabel: byId<HTMLSpanElement>('export-label'),

  placeholder: byId<HTMLDivElement>('placeholder'),
  canvas: byId<HTMLCanvasElement>('preview-canvas'),
  loadingOverlay: byId<HTMLDivElement>('loading-overlay'),
};

const state: WatermarkState = {
  text: dom.text.value,
  color: dom.colorPicker.value,
  size: Number(dom.size.value),
  opacity: Number(dom.opacity.value),
  rotation: Number(dom.rotation.value),
  tile: true,

  hasFile: false,
  kind: '',
  fileName: '',
  mime: '',
  page: 1,
  pages: 1,
  loading: false,
};

let bytes: Uint8Array | null = null; // source file bytes, kept for export
let pdfDoc: PDFDocumentProxy | null = null;
let base: BaseRender | null = null; // rendered source (page or image) at native res

// ---------- helpers ----------

function setError(message: string): void {
  dom.fileError.textContent = message;
  dom.fileError.hidden = !message;
}

function fontSizeFor(w: number, h: number): number {
  return Math.max(6, (state.size / 100) * Math.min(w, h) * (state.tile ? 0.16 : 0.28));
}

function outName(ext: string): string {
  return (state.fileName || 'document').replace(/\.[^.]+$/, '') + '-filigrane.' + ext;
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- file loading ----------

async function onFileSelected(file: File | null | undefined): Promise<void> {
  if (!file) return;
  setError('');
  state.loading = true;
  render();
  try {
    const buf = await file.arrayBuffer();
    bytes = new Uint8Array(buf);
    state.mime = file.type;

    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      await loadPdf(file.name);
    } else if (/^image\//.test(file.type)) {
      await loadImage(file);
      state.hasFile = true;
      state.kind = 'image';
      state.fileName = file.name;
      state.pages = 1;
      state.page = 1;
    } else {
      setError("Format non pris en charge. Utilisez un PDF, un PNG, un JPG ou un WEBP.");
      return;
    }
  } catch (err) {
    setError('Lecture impossible : ' + (err instanceof Error ? err.message : 'fichier illisible'));
  } finally {
    state.loading = false;
    render();
  }
}

async function loadImage(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('image invalide'));
      i.src = url;
    });
    const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * scale);
    cv.height = Math.round(img.height * scale);
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    base = { canvas: cv, w: cv.width, h: cv.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadPdf(name: string): Promise<void> {
  if (!bytes) throw new Error('aucun fichier chargé');
  const pdfjsLib = await getPdfjsLib();
  pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  state.hasFile = true;
  state.kind = 'pdf';
  state.fileName = name;
  state.pages = pdfDoc.numPages;
  state.page = 1;
  await renderPdfPage(1);
}

async function renderPdfPage(n: number): Promise<void> {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(n);
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(2, 1400 / v1.width) });
  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width);
  cv.height = Math.round(vp.height);
  await page.render({ canvasContext: cv.getContext('2d')!, viewport: vp }).promise;
  base = { canvas: cv, w: cv.width, h: cv.height };
}

async function goPage(delta: number): Promise<void> {
  const n = Math.min(state.pages, Math.max(1, state.page + delta));
  if (n === state.page) return;
  state.page = n;
  state.loading = true;
  render();
  try {
    await renderPdfPage(n);
  } finally {
    state.loading = false;
    render();
  }
}

// ---------- watermark rendering (shared by preview, image export and PDF export) ----------

/**
 * Paints the watermark onto a canvas already showing the source page/image.
 * The tiled pattern is deliberately dense - instances overlap rather than
 * leaving clean gaps - so it can't be cropped or inpainted out without also
 * damaging the underlying content.
 */
function paintWatermark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const text = state.text.trim();
  if (!text) return;

  const fs = fontSizeFor(w, h);
  ctx.save();
  ctx.globalAlpha = state.opacity / 100;
  ctx.fillStyle = state.color;
  ctx.font = '700 ' + fs + 'px Manrope, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-state.rotation * Math.PI) / 180);

  if (state.tile) {
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

function drawPreview(): void {
  const cv = dom.canvas;
  if (!base) return;
  const { w, h } = base;
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(base.canvas, 0, 0);
  paintWatermark(ctx, w, h);
}

// ---------- export ----------

async function exportImage(): Promise<void> {
  const cv = dom.canvas;
  const jpg = /jpe?g/i.test(state.mime);
  const blob = await new Promise<Blob | null>((res) =>
    cv.toBlob(res, jpg ? 'image/jpeg' : 'image/png', 0.92),
  );
  if (!blob) throw new Error("échec de l'encodage de l'image");
  download(blob, outName(jpg ? 'jpg' : 'png'));
}

// Raster scale for exported PDF pages, relative to their 72pt-per-inch size
// (2 = ~144 DPI). Matches the cap already used for on-screen preview.
const PDF_EXPORT_SCALE = 2;

async function exportPdf(): Promise<void> {
  if (!bytes) throw new Error('aucun fichier chargé');
  const [pdfjsLib, { PDFDocument }] = await Promise.all([getPdfjsLib(), getPdfLib()]);

  const srcDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const outDoc = await PDFDocument.create();

  for (let n = 1; n <= srcDoc.numPages; n++) {
    const page = await srcDoc.getPage(n);
    const pagePts = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_EXPORT_SCALE });
    const cv = document.createElement('canvas');
    cv.width = Math.round(viewport.width);
    cv.height = Math.round(viewport.height);
    const ctx = cv.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    paintWatermark(ctx, cv.width, cv.height);

    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('échec du rendu de la page ' + n);
    const png = new Uint8Array(await blob.arrayBuffer());
    const img = await outDoc.embedPng(png);
    const outPage = outDoc.addPage([pagePts.width, pagePts.height]);
    outPage.drawImage(img, { x: 0, y: 0, width: pagePts.width, height: pagePts.height });
  }

  const out = await outDoc.save();
  download(new Blob([out as BlobPart], { type: 'application/pdf' }), outName('pdf'));
}

async function onExport(): Promise<void> {
  setError('');
  dom.exportBtn.disabled = true;
  const prevLabel = dom.exportLabel.textContent;
  dom.exportLabel.textContent = 'Export en cours…';
  try {
    if (state.kind === 'pdf') await exportPdf();
    else await exportImage();
  } catch (err) {
    setError('Export impossible : ' + (err instanceof Error ? err.message : 'erreur inconnue'));
  } finally {
    dom.exportLabel.textContent = prevLabel;
    dom.exportBtn.disabled = false;
  }
}

// ---------- render (sync UI + canvas to state) ----------

function render(): void {
  dom.placeholder.hidden = state.hasFile;
  dom.canvas.hidden = !state.hasFile;

  dom.loadingOverlay.hidden = !state.loading;
  dom.dropzone.classList.toggle('loading', state.loading);
  dom.fileInput.disabled = state.loading;
  dom.prevPage.disabled = state.loading;
  dom.nextPage.disabled = state.loading;

  dom.fileChip.hidden = !state.hasFile;
  if (state.hasFile) {
    dom.fileChipName.textContent =
      state.fileName + (state.pages > 1 ? '  ·  ' + state.pages + ' pages' : '');
  }

  dom.exportBtn.disabled = !state.hasFile || state.loading;
  dom.exportLabel.textContent =
    state.kind === 'pdf' ? 'Télécharger le PDF' : 'Télécharger le fichier';

  const multipage = state.hasFile && state.pages > 1;
  dom.pager.hidden = !multipage;
  dom.pageLabel.textContent = 'p. ' + state.page + ' / ' + state.pages;

  dom.sizeLabel.textContent = state.size + ' %';
  dom.opacityLabel.textContent = state.opacity + ' %';
  dom.rotationLabel.textContent = state.rotation + '°';

  dom.tileTrack.classList.toggle('on', state.tile);
  dom.tileHint.textContent = state.tile
    ? 'Motif répété en diagonale'
    : 'Un seul filigrane, au centre';

  const c = state.color.toLowerCase();
  for (const sw of dom.swatches) {
    sw.textContent = (sw.dataset.color ?? '').toLowerCase() === c ? '✓' : '';
  }

  if (state.hasFile) drawPreview();
}

// ---------- wiring ----------

dom.fileInput.addEventListener('change', (e) =>
  onFileSelected((e.target as HTMLInputElement).files?.[0]),
);

dom.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dom.dropzone.classList.add('dragover');
});
dom.dropzone.addEventListener('dragleave', () => dom.dropzone.classList.remove('dragover'));
dom.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dom.dropzone.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) onFileSelected(file);
});

dom.text.addEventListener('input', () => {
  state.text = dom.text.value;
  render();
});

dom.colorPicker.addEventListener('input', () => {
  state.color = dom.colorPicker.value;
  render();
});
for (const sw of dom.swatches) {
  sw.addEventListener('click', () => {
    const c = sw.dataset.color;
    if (!c) return;
    state.color = c;
    dom.colorPicker.value = c;
    render();
  });
}

dom.size.addEventListener('input', () => {
  state.size = Number(dom.size.value);
  render();
});
dom.opacity.addEventListener('input', () => {
  state.opacity = Number(dom.opacity.value);
  render();
});
dom.rotation.addEventListener('input', () => {
  state.rotation = Number(dom.rotation.value);
  render();
});

dom.tileToggle.addEventListener('click', () => {
  state.tile = !state.tile;
  render();
});

dom.prevPage.addEventListener('click', () => void goPage(-1));
dom.nextPage.addEventListener('click', () => void goPage(1));

dom.exportBtn.addEventListener('click', () => void onExport());

render();
