export class ReceiptValidationError extends Error {
  readonly code:
    | 'INVALID_FORMAT'
    | 'DECODE_FAILED'
    | 'LOW_RESOLUTION'
    | 'PAYLOAD_TOO_LARGE'
    | 'TOO_DARK'
    | 'LOW_CONTRAST'
    | 'NO_TEXT_DETECTED';

  constructor(
    code: ReceiptValidationError['code'],
    message: string
  ) {
    super(message);
    this.name = 'ReceiptValidationError';
    this.code = code;
  }
}

export interface ImageQualityReport {
  width: number;
  height: number;
  meanLuminance: number;
  contrastSpan: number;
  edgeDensity: number;
  activeRowRatio: number;
}

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_DATA_URL_BYTES = 12 * 1024 * 1024; // 12 MB base64 string guard

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new ReceiptValidationError(
          'DECODE_FAILED',
          'Could not decode this image file. Please upload a standard JPG, PNG, or WebP receipt photo.'
        )
      );
    img.src = dataUrl;
  });
}

export async function validateReceiptImage(
  dataUrl: string,
  mimeType: string
): Promise<ImageQualityReport> {
  const normalizedMime = (
    dataUrl.match(/^data:([^;]+);/)?.[1] ||
    mimeType ||
    ''
  ).toLowerCase();

  if (!normalizedMime || !SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMime)) {
    throw new ReceiptValidationError(
      'INVALID_FORMAT',
      'Unsupported image format. Please upload a JPG, PNG, or WebP photo of your receipt.'
    );
  }

  if (dataUrl.length > MAX_DATA_URL_BYTES) {
    throw new ReceiptValidationError(
      'PAYLOAD_TOO_LARGE',
      'Receipt image is still too large after compression. Please try a lower-resolution photo.'
    );
  }

  const img = await loadImageElement(dataUrl);
  const origWidth = img.naturalWidth || img.width;
  const origHeight = img.naturalHeight || img.height;

  if (origWidth < 160 || origHeight < 160) {
    throw new ReceiptValidationError(
      'LOW_RESOLUTION',
      'Image resolution is too small to read receipt details. Please take a closer, sharper photo.'
    );
  }

  // Downsample to <= 240px on the longest side for fast pixel & gradient analysis
  const sampleMax = 240;
  const scale = Math.min(1, sampleMax / Math.max(origWidth, origHeight));
  const w = Math.max(32, Math.round(origWidth * scale));
  const h = Math.max(32, Math.round(origHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    // Graceful pass-through if 2D canvas context is unavailable
    return {
      width: origWidth,
      height: origHeight,
      meanLuminance: 128,
      contrastSpan: 128,
      edgeDensity: 0.05,
      activeRowRatio: 0.25,
    };
  }

  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const totalPixels = w * h;
  const luminance = new Uint8Array(totalPixels);
  const histogram = new Uint32Array(256);
  let sumY = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const y = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    luminance[p] = y;
    histogram[y] += 1;
    sumY += y;
  }

  const meanLuminance = sumY / totalPixels;

  // Compute 5th and 95th percentile luminance
  const p5Threshold = Math.floor(totalPixels * 0.05);
  const p95Threshold = Math.floor(totalPixels * 0.95);
  let cumulative = 0;
  let p5 = 0;
  let p95 = 255;
  let foundP5 = false;

  for (let val = 0; val < 256; val += 1) {
    cumulative += histogram[val];
    if (!foundP5 && cumulative >= p5Threshold) {
      p5 = val;
      foundP5 = true;
    }
    if (cumulative >= p95Threshold) {
      p95 = val;
      break;
    }
  }

  const contrastSpan = p95 - p5;

  let sqDiffSum = 0;
  for (let p = 0; p < totalPixels; p += 1) {
    const diff = luminance[p] - meanLuminance;
    sqDiffSum += diff * diff;
  }
  const stdDev = Math.sqrt(sqDiffSum / totalPixels);

  if (p95 < 55 || meanLuminance < 22) {
    throw new ReceiptValidationError(
      'TOO_DARK',
      'This photo looks too dark to read receipt text. Please retake it in brighter lighting or use flash.'
    );
  }

  if (p5 > 235 || (contrastSpan < 24 && stdDev < 9)) {
    throw new ReceiptValidationError(
      'LOW_CONTRAST',
      'Not enough contrast detected in this image. Make sure the printed receipt text stands out clearly against the paper.'
    );
  }

  // Edge / text-stroke density check via horizontal and vertical luminance gradients
  const edgeThreshold = 16;
  let edgePixels = 0;
  let activeRows = 0;

  for (let y = 0; y < h - 1; y += 1) {
    let rowEdges = 0;
    const rowOffset = y * w;
    for (let x = 0; x < w - 1; x += 1) {
      const idx = rowOffset + x;
      const cur = luminance[idx];
      const dx = Math.abs(cur - luminance[idx + 1]);
      const dy = Math.abs(cur - luminance[idx + w]);
      if (dx >= edgeThreshold || dy >= edgeThreshold) {
        edgePixels += 1;
        rowEdges += 1;
      }
    }
    if (rowEdges >= 2) {
      activeRows += 1;
    }
  }

  const edgeDensity = edgePixels / ((w - 1) * (h - 1));
  const activeRowRatio = activeRows / (h - 1);

  if (edgeDensity < 0.004 || activeRowRatio < 0.04) {
    throw new ReceiptValidationError(
      'NO_TEXT_DETECTED',
      'No clear receipt text was detected (the photo may be blurry, blank, or out of focus). Please hold steady and try again.'
    );
  }

  return {
    width: origWidth,
    height: origHeight,
    meanLuminance,
    contrastSpan,
    edgeDensity,
    activeRowRatio,
  };
}
