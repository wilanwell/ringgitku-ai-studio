export interface NormalizedPoint {
  x: number; // 0..1 normalized to viewport width
  y: number; // 0..1 normalized to viewport height
}

export interface ReceiptQuad {
  topLeft: NormalizedPoint;
  topRight: NormalizedPoint;
  bottomRight: NormalizedPoint;
  bottomLeft: NormalizedPoint;
}

export type AlignmentHint =
  | 'searching'
  | 'move_closer'
  | 'center_receipt'
  | 'aligned';

export interface ReceiptDetectionResult {
  detected: boolean;
  isAligned: boolean;
  confidence: number; // 0..1
  areaRatio: number; // 0..1
  alignmentHint: AlignmentHint;
  quad: ReceiptQuad | null;
}

interface ComponentStats {
  label: number;
  area: number;
  sumX: number;
  sumY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const EMPTY_RESULT: ReceiptDetectionResult = {
  detected: false,
  isAligned: false,
  confidence: 0,
  areaRatio: 0,
  alignmentHint: 'searching',
  quad: null,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function quadArea(q: ReceiptQuad): number {
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

function pointDist(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pure computer-vision receipt boundary detector operating on downscaled RGBA pixel data.
 * Uses Gaussian smoothing, adaptive paper-region thresholding, 3x3 morphological closing
 * (to bridge dark printed text lines), connected-component selection, 4-corner extremum
 * quadrilateral extraction, and Sobel edge gradient verification.
 */
export function detectReceiptFromImageData(
  imageData: ImageData
): ReceiptDetectionResult {
  const { width: w, height: h, data } = imageData;
  if (w < 24 || h < 24 || data.length < w * h * 4) {
    return EMPTY_RESULT;
  }

  const totalPixels = w * h;
  const lum = new Uint8Array(totalPixels);

  let sum = 0;
  for (let i = 0, p = 0; i < totalPixels; i++, p += 4) {
    const y = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    lum[i] = y;
    sum += y;
  }

  const mean = sum / totalPixels;
  let varianceSum = 0;
  const hist = new Int32Array(256);
  for (let i = 0; i < totalPixels; i++) {
    const d = lum[i] - mean;
    varianceSum += d * d;
    hist[lum[i]]++;
  }

  const stdDev = Math.sqrt(varianceSum / totalPixels);
  // Uniform blank wall or pitch-black frame has no meaningful receipt contrast
  if (stdDev < 9) {
    return EMPTY_RESULT;
  }

  // Compute 55th percentile luminance as baseline background estimate
  let cum = 0;
  let p55 = 128;
  const targetCount = totalPixels * 0.55;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= targetCount) {
      p55 = v;
      break;
    }
  }

  // 3x3 Gaussian blur to suppress sensor noise & printed text grain
  const blurred = new Uint8Array(totalPixels);
  for (let y = 0; y < h; y++) {
    const yPrev = y > 0 ? y - 1 : 0;
    const yNext = y < h - 1 ? y + 1 : h - 1;
    const rowOff = y * w;
    const prevOff = yPrev * w;
    const nextOff = yNext * w;

    for (let x = 0; x < w; x++) {
      const xPrev = x > 0 ? x - 1 : 0;
      const xNext = x < w - 1 ? x + 1 : w - 1;
      const val =
        (lum[prevOff + xPrev] +
          lum[prevOff + x] * 2 +
          lum[prevOff + xNext] +
          lum[rowOff + xPrev] * 2 +
          lum[rowOff + x] * 4 +
          lum[rowOff + xNext] * 2 +
          lum[nextOff + xPrev] +
          lum[nextOff + x] * 2 +
          lum[nextOff + xNext]) >>
        4;
      blurred[rowOff + x] = val;
    }
  }

  // Sobel edge gradient map
  const grad = new Uint16Array(totalPixels);
  for (let y = 1; y < h - 1; y++) {
    const r0 = (y - 1) * w;
    const r1 = y * w;
    const r2 = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -blurred[r0 + x - 1] +
        blurred[r0 + x + 1] -
        2 * blurred[r1 + x - 1] +
        2 * blurred[r1 + x + 1] -
        blurred[r2 + x - 1] +
        blurred[r2 + x + 1];
      const gy =
        -blurred[r0 + x - 1] -
        2 * blurred[r0 + x] -
        blurred[r0 + x + 1] +
        blurred[r2 + x - 1] +
        2 * blurred[r2 + x] +
        blurred[r2 + x + 1];
      grad[r1 + x] = Math.abs(gx) + Math.abs(gy);
    }
  }

  // Adaptive threshold: bright paper vs background
  const threshold = Math.min(235, Math.max(mean + stdDev * 0.35, p55 + 6, 85));
  const mask = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    mask[i] = blurred[i] >= threshold ? 1 : 0;
  }

  // 3x3 Morphological closing (dilate then erode) to seal dark receipt text lines inside the paper
  const dilated = new Uint8Array(totalPixels);
  for (let y = 1; y < h - 1; y++) {
    const r0 = (y - 1) * w;
    const r1 = y * w;
    const r2 = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      if (
        mask[r0 + x - 1] |
        mask[r0 + x] |
        mask[r0 + x + 1] |
        mask[r1 + x - 1] |
        mask[r1 + x] |
        mask[r1 + x + 1] |
        mask[r2 + x - 1] |
        mask[r2 + x] |
        mask[r2 + x + 1]
      ) {
        dilated[r1 + x] = 1;
      }
    }
  }

  const closed = new Uint8Array(totalPixels);
  for (let y = 1; y < h - 1; y++) {
    const r0 = (y - 1) * w;
    const r1 = y * w;
    const r2 = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      if (
        dilated[r0 + x - 1] &
        dilated[r0 + x] &
        dilated[r0 + x + 1] &
        dilated[r1 + x - 1] &
        dilated[r1 + x] &
        dilated[r1 + x + 1] &
        dilated[r2 + x - 1] &
        dilated[r2 + x] &
        dilated[r2 + x + 1]
      ) {
        closed[r1 + x] = 1;
      }
    }
  }

  // Connected-component labeling (BFS) to find the dominant document region near frame center
  const labels = new Int32Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let nextLabel = 1;

  let bestComponent: ComponentStats | null = null;
  let bestScore = -1;

  const centerX = w * 0.5;
  const centerY = h * 0.48;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (closed[idx] !== 1 || labels[idx] !== 0) continue;

      const label = nextLabel++;
      let head = 0;
      let tail = 0;
      queue[tail++] = idx;
      labels[idx] = label;

      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minX: number = x;
      let maxX: number = x;
      let minY: number = y;
      let maxY: number = y;

      while (head < tail) {
        const cur = queue[head++];
        const cx = cur % w;
        const cy = (cur - cx) / w;

        area++;
        sumX += cx;
        sumY += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        // 4-neighbors
        const n1 = cur - 1;
        if (cx > 0 && closed[n1] === 1 && labels[n1] === 0) {
          labels[n1] = label;
          queue[tail++] = n1;
        }
        const n2 = cur + 1;
        if (cx < w - 1 && closed[n2] === 1 && labels[n2] === 0) {
          labels[n2] = label;
          queue[tail++] = n2;
        }
        const n3 = cur - w;
        if (cy > 0 && closed[n3] === 1 && labels[n3] === 0) {
          labels[n3] = label;
          queue[tail++] = n3;
        }
        const n4 = cur + w;
        if (cy < h - 1 && closed[n4] === 1 && labels[n4] === 0) {
          labels[n4] = label;
          queue[tail++] = n4;
        }
      }

      const areaFraction = area / totalPixels;
      if (areaFraction < 0.05 || areaFraction > 0.88) continue;

      const compW = (maxX - minX + 1) / w;
      const compH = (maxY - minY + 1) / h;
      if (compW < 0.16 || compH < 0.16) continue;

      // Reject overly sparse/filament shapes (paper should fill most of its bounding box)
      const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
      const solidity = area / bboxArea;
      if (solidity < 0.42) continue;

      const meanX = sumX / area;
      const meanY = sumY / area;
      const centerDist = Math.hypot((meanX - centerX) / w, (meanY - centerY) / h);
      const score = areaFraction * solidity * Math.max(0.2, 1.2 - centerDist);

      if (score > bestScore) {
        bestScore = score;
        bestComponent = { label, area, sumX, sumY, minX, maxX, minY, maxY };
      }
    }
  }

  if (!bestComponent) {
    return EMPTY_RESULT;
  }

  const comp: ComponentStats = bestComponent;
  const targetLabel = comp.label;
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;

  let tlX: number = comp.minX;
  let tlY: number = comp.minY;
  let brX: number = comp.maxX;
  let brY: number = comp.maxY;
  let trX: number = comp.maxX;
  let trY: number = comp.minY;
  let blX: number = comp.minX;
  let blY: number = comp.maxY;

  for (let y: number = comp.minY; y <= comp.maxY; y++) {
    const rowOff = y * w;
    for (let x: number = comp.minX; x <= comp.maxX; x++) {
      const idx = rowOff + x;
      if (labels[idx] !== targetLabel) continue;

      // Only inspect perimeter pixels
      const isBoundary =
        x === 0 ||
        x === w - 1 ||
        y === 0 ||
        y === h - 1 ||
        labels[idx - 1] !== targetLabel ||
        labels[idx + 1] !== targetLabel ||
        labels[idx - w] !== targetLabel ||
        labels[idx + w] !== targetLabel;

      if (!isBoundary) continue;

      const xySum = x + y;
      const xyDiff = x - y;

      if (xySum < minSum) {
        minSum = xySum;
        tlX = x;
        tlY = y;
      }
      if (xySum > maxSum) {
        maxSum = xySum;
        brX = x;
        brY = y;
      }
      if (xyDiff > maxDiff) {
        maxDiff = xyDiff;
        trX = x;
        trY = y;
      }
      if (xyDiff < minDiff) {
        minDiff = xyDiff;
        blX = x;
        blY = y;
      }
    }
  }

  const quad: ReceiptQuad = {
    topLeft: { x: clamp01(tlX / (w - 1)), y: clamp01(tlY / (h - 1)) },
    topRight: { x: clamp01(trX / (w - 1)), y: clamp01(trY / (h - 1)) },
    bottomRight: { x: clamp01(brX / (w - 1)), y: clamp01(brY / (h - 1)) },
    bottomLeft: { x: clamp01(blX / (w - 1)), y: clamp01(blY / (h - 1)) },
  };

  const qArea = quadArea(quad);
  if (qArea < 0.05 || qArea > 0.9) {
    return EMPTY_RESULT;
  }

  const topEdgeLen = pointDist(quad.topLeft, quad.topRight);
  const bottomEdgeLen = pointDist(quad.bottomLeft, quad.bottomRight);
  const leftEdgeLen = pointDist(quad.topLeft, quad.bottomLeft);
  const rightEdgeLen = pointDist(quad.topRight, quad.bottomRight);

  if (
    Math.min(topEdgeLen, bottomEdgeLen) < 0.14 ||
    Math.min(leftEdgeLen, rightEdgeLen) < 0.16
  ) {
    return EMPTY_RESULT;
  }

  // Verify Sobel edge strength along all 4 sides (samples slightly inside/outside the 3px perimeter band)
  const sampleEdgeStrength = (p1: NormalizedPoint, p2: NormalizedPoint): number => {
    const steps = 14;
    let hits = 0;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const px = Math.round((p1.x + (p2.x - p1.x) * t) * (w - 1));
      const py = Math.round((p1.y + (p2.y - p1.y) * t) * (h - 1));
      let localMax = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = py + dy;
        if (ny < 1 || ny >= h - 1) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = px + dx;
          if (nx < 1 || nx >= w - 1) continue;
          const g = grad[ny * w + nx];
          if (g > localMax) localMax = g;
        }
      }
      if (localMax >= 45) hits++;
    }
    return hits / (steps - 1);
  };

  const edgeSupport =
    (sampleEdgeStrength(quad.topLeft, quad.topRight) +
      sampleEdgeStrength(quad.topRight, quad.bottomRight) +
      sampleEdgeStrength(quad.bottomRight, quad.bottomLeft) +
      sampleEdgeStrength(quad.bottomLeft, quad.topLeft)) /
    4;

  const confidence = clamp01(edgeSupport * 0.75 + Math.min(1, qArea * 2.2) * 0.25);
  if (confidence < 0.32) {
    return EMPTY_RESULT;
  }

  const corners = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  const minMarginX = Math.min(...corners.map((c) => Math.min(c.x, 1 - c.x)));
  const minMarginY = Math.min(...corners.map((c) => Math.min(c.y, 1 - c.y)));

  let alignmentHint: AlignmentHint = 'aligned';
  if (qArea < 0.12) {
    alignmentHint = 'move_closer';
  } else if (minMarginX < 0.02 || minMarginY < 0.02) {
    alignmentHint = 'center_receipt';
  }

  return {
    detected: true,
    isAligned: alignmentHint === 'aligned' && confidence >= 0.5,
    confidence,
    areaRatio: qArea,
    alignmentHint,
    quad,
  };
}

/**
 * Samples the visible `object-cover` viewport crop of an active HTMLVideoElement
 * and runs receipt edge detection on a compact (~160px) offscreen canvas.
 */
export function detectReceiptFromVideo(
  video: HTMLVideoElement,
  viewportWidth: number,
  viewportHeight: number,
  scratchCanvas?: HTMLCanvasElement
): ReceiptDetectionResult {
  if (
    !video ||
    video.readyState < 2 ||
    !video.videoWidth ||
    !video.videoHeight ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return EMPTY_RESULT;
  }

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  // Compute exact source crop corresponding to CSS `object-cover`
  const coverScale = Math.max(viewportWidth / vw, viewportHeight / vh);
  const cropW = viewportWidth / coverScale;
  const cropH = viewportHeight / coverScale;
  const cropX = (vw - cropW) / 2;
  const cropY = (vh - cropH) / 2;

  const maxDim = 160;
  let canvasW: number;
  let canvasH: number;
  if (viewportWidth >= viewportHeight) {
    canvasW = maxDim;
    canvasH = Math.max(32, Math.round((viewportHeight / viewportWidth) * maxDim));
  } else {
    canvasH = maxDim;
    canvasW = Math.max(32, Math.round((viewportWidth / viewportHeight) * maxDim));
  }

  const canvas = scratchCanvas ?? document.createElement('canvas');
  if (canvas.width !== canvasW) canvas.width = canvasW;
  if (canvas.height !== canvasH) canvas.height = canvasH;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return EMPTY_RESULT;

  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvasW, canvasH);
  const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
  return detectReceiptFromImageData(imageData);
}

export interface SourceCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Runs receipt boundary detection directly against any full CanvasImageSource
 * (e.g. an uploaded ImageBitmap or HTMLImageElement).
 */
export function detectReceiptFromCanvasSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  scratchCanvas?: HTMLCanvasElement
): ReceiptDetectionResult {
  if (!sourceWidth || !sourceHeight) {
    return EMPTY_RESULT;
  }

  const maxDim = 160;
  let canvasW: number;
  let canvasH: number;
  if (sourceWidth >= sourceHeight) {
    canvasW = maxDim;
    canvasH = Math.max(32, Math.round((sourceHeight / sourceWidth) * maxDim));
  } else {
    canvasH = maxDim;
    canvasW = Math.max(32, Math.round((sourceWidth / sourceHeight) * maxDim));
  }

  const canvas = scratchCanvas ?? document.createElement('canvas');
  if (canvas.width !== canvasW) canvas.width = canvasW;
  if (canvas.height !== canvasH) canvas.height = canvasH;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return EMPTY_RESULT;

  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, canvasW, canvasH);
  const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
  return detectReceiptFromImageData(imageData);
}

/**
 * Converts a normalized viewport ReceiptQuad back into source pixel coordinates
 * (`sx, sy, sw, sh`) with a small breathing margin for safe document cropping.
 */
export function computeQuadCropRect(
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  quad: ReceiptQuad,
  paddingRatio = 0.025
): SourceCropRect {
  const fullRect: SourceCropRect = {
    sx: 0,
    sy: 0,
    sw: sourceWidth,
    sh: sourceHeight,
  };

  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return fullRect;
  }

  const coverScale = Math.max(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  const cropW = viewportWidth / coverScale;
  const cropH = viewportHeight / coverScale;
  const cropX = (sourceWidth - cropW) / 2;
  const cropY = (sourceHeight - cropH) / 2;

  const xs = [quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x];
  const ys = [quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y];

  const minX = Math.max(0, Math.min(...xs) - paddingRatio);
  const maxX = Math.min(1, Math.max(...xs) + paddingRatio);
  const minY = Math.max(0, Math.min(...ys) - paddingRatio);
  const maxY = Math.min(1, Math.max(...ys) + paddingRatio);

  const sx = Math.max(0, Math.floor(cropX + minX * cropW));
  const sy = Math.max(0, Math.floor(cropY + minY * cropH));
  const sw = Math.min(sourceWidth - sx, Math.ceil((maxX - minX) * cropW));
  const sh = Math.min(sourceHeight - sy, Math.ceil((maxY - minY) * cropH));

  if (sw < 100 || sh < 100) {
    return fullRect;
  }

  return { sx, sy, sw, sh };
}

/**
 * Exponential moving average smoother for quadrilateral coordinates to prevent frame jitter.
 */
export function smoothReceiptQuad(
  previous: ReceiptQuad | null,
  next: ReceiptQuad,
  alpha = 0.38
): ReceiptQuad {
  if (!previous) return next;
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  return {
    topLeft: {
      x: lerp(previous.topLeft.x, next.topLeft.x),
      y: lerp(previous.topLeft.y, next.topLeft.y),
    },
    topRight: {
      x: lerp(previous.topRight.x, next.topRight.x),
      y: lerp(previous.topRight.y, next.topRight.y),
    },
    bottomRight: {
      x: lerp(previous.bottomRight.x, next.bottomRight.x),
      y: lerp(previous.bottomRight.y, next.bottomRight.y),
    },
    bottomLeft: {
      x: lerp(previous.bottomLeft.x, next.bottomLeft.x),
      y: lerp(previous.bottomLeft.y, next.bottomLeft.y),
    },
  };
}
