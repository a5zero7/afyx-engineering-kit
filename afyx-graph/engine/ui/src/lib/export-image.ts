/** Browser boundary for deterministic AFYX graph image export. */

export const PNG_SCALE = 2;

export interface RasterEnvironment {
  createCanvas(): HTMLCanvasElement;
  createImage(): HTMLImageElement;
}

const browserRasterEnvironment: RasterEnvironment = {
  createCanvas: () => document.createElement('canvas'),
  createImage: () => new Image(),
};

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function positivePixels(value: string | null): number | null {
  if (value === null || !/^\d+(?:\.\d+)?(?:px)?$/i.test(value.trim())) return null;
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) && pixels > 0 ? Math.max(1, Math.round(pixels)) : null;
}

export function svgPixelSize(svg: string): { width: number; height: number } {
  const documentNode = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = documentNode.documentElement.tagName.toLowerCase() === 'svg'
    ? documentNode.documentElement
    : null;
  const viewBox = root?.getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = positivePixels(root?.getAttribute('width') ?? null)
    ?? (viewBox?.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2]! > 0
      ? Math.max(1, Math.round(viewBox[2]!))
      : 1);
  const height = positivePixels(root?.getAttribute('height') ?? null)
    ?? (viewBox?.length === 4 && Number.isFinite(viewBox[3]) && viewBox[3]! > 0
      ? Math.max(1, Math.round(viewBox[3]!))
      : 1);
  return { width, height };
}

function loadImage(source: string, environment: RasterEnvironment): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = environment.createImage();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('The image could not be rendered.')), { once: true });
    image.src = source;
  });
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('The image could not be encoded.'));
      else resolve(blob);
    }, 'image/png');
  });
}

export async function rasterizeSvg(
  svg: string,
  environment: RasterEnvironment,
): Promise<Blob> {
  const size = svgPixelSize(svg);
  const [image, canvas] = await Promise.all([
    loadImage(svgDataUrl(svg), environment),
    Promise.resolve(environment.createCanvas()),
  ]);
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('This browser would not give up a 2D canvas.');
  context.drawImage(image, 0, 0, size.width, size.height);
  return encodePng(canvas);
}

export function svgToPng(svg: string): Promise<Blob> {
  return rasterizeSvg(svg, browserRasterEnvironment);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
}

export function downloadSvg(svg: string, filename: string): void {
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

export async function copyPngToClipboard(
  render: () => Promise<Blob>,
  filename: string,
): Promise<'copied' | 'downloaded'> {
  if (typeof navigator.clipboard?.write === 'function' && typeof ClipboardItem === 'function') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': render() })]);
      return 'copied';
    } catch {
      // Permission, focus, and user-gesture policies are browser controlled.
    }
  }
  downloadBlob(await render(), filename);
  return 'downloaded';
}
