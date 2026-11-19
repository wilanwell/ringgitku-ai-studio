import {
  BudgetSettings,
  Expense,
  ExpenseCategory,
  ImageRetentionMode,
  QueuedReceiptScan,
} from '../types/expense';
import {
  computeQuadCropRect,
  detectReceiptFromCanvasSource,
  SourceCropRect,
} from './receiptEdgeDetector';

const EXPENSES_STORAGE_KEY = 'snapspend.expenses.v1';
const QUEUE_STORAGE_KEY = 'snapspend.scan_queue.v1';
const BUDGET_STORAGE_KEY = 'ringgitku.budget.v1';
const RETENTION_MODE_KEY = 'ringgitku.retention_mode.v1';
const STORAGE_NOTICE_KEY = 'ringgitku.storage_notice.v1';

export interface EvictedImageInfo {
  id: string;
  merchant: string;
  date: string;
  dataUrl?: string;
}

export interface StorageWarningNotice {
  reason: 'quota_trimmed' | 'all_images_removed' | 'media_store_evicted' | 'save_failed';
  affectedItems: Array<{ id: string; merchant: string; date: string }>;
  updatedAt: string;
}

export interface SaveExpensesResult {
  status: 'ok' | 'images_trimmed' | 'all_images_removed' | 'failed';
  evictedImages: EvictedImageInfo[];
  persistedExpenses: Expense[];
}

export function generateId(prefix = 'exp'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadExpenses(): Expense[] {
  try {
    const raw = localStorage.getItem(EXPENSES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveExpenses(
  expenses: Expense[],
  imagesInIdbIds?: Set<string>
): SaveExpensesResult {
  // Decouple media from ledger: if an image is safely persisted in IndexedDB,
  // omit its heavy base64 string from localStorage while marking it saved.
  const serializeList = (list: Expense[]) =>
    list.map((item) => {
      if (imagesInIdbIds?.has(item.id)) {
        return {
          ...item,
          receiptImage: undefined,
          receiptImageStatus: 'saved' as const,
        };
      }
      if (item.receiptImage) {
        return {
          ...item,
          receiptImageStatus: 'saved' as const,
        };
      }
      return item;
    });

  const primaryPayload = serializeList(expenses);

  try {
    localStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(primaryPayload));
    return {
      status: 'ok',
      evictedImages: [],
      persistedExpenses: expenses,
    };
  } catch (err) {
    console.warn('Storage quota hit while saving expenses:', err);

    // Tier 1 fallback: strip older inline images beyond the 15 most recent items
    // AND explicitly track every affected item so the UI notifies the user.
    const trimmedEvictions: EvictedImageInfo[] = [];
    const trimmedForStorage = primaryPayload.map((item, idx) => {
      if (idx >= 15 && item.receiptImage) {
        trimmedEvictions.push({
          id: item.id,
          merchant: item.merchant,
          date: item.date,
          dataUrl: item.receiptImage,
        });
        return {
          ...item,
          receiptImage: undefined,
          receiptImageStatus: 'removed_quota' as const,
        };
      }
      return item;
    });

    if (trimmedEvictions.length > 0) {
      try {
        localStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(trimmedForStorage));
        const evictedSet = new Set(trimmedEvictions.map((e) => e.id));
        const nextExpenses = expenses.map((item) =>
          evictedSet.has(item.id)
            ? { ...item, receiptImage: undefined, receiptImageStatus: 'removed_quota' as const }
            : item
        );
        return {
          status: 'images_trimmed',
          evictedImages: trimmedEvictions,
          persistedExpenses: nextExpenses,
        };
      } catch {
        // Fall through to stripping all remaining inline images
      }
    }

    // Tier 2 fallback: strip all inline images so financial transaction records are preserved
    const allEvictions: EvictedImageInfo[] = [];
    const lightweightForStorage = primaryPayload.map((item) => {
      if (item.receiptImage) {
        allEvictions.push({
          id: item.id,
          merchant: item.merchant,
          date: item.date,
          dataUrl: item.receiptImage,
        });
        return {
          ...item,
          receiptImage: undefined,
          receiptImageStatus: 'removed_quota' as const,
        };
      }
      return item;
    });

    try {
      localStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(lightweightForStorage));
      const evictedSet = new Set(allEvictions.map((e) => e.id));
      const nextExpenses = expenses.map((item) =>
        evictedSet.has(item.id)
          ? { ...item, receiptImage: undefined, receiptImageStatus: 'removed_quota' as const }
          : item
      );
      return {
        status: allEvictions.length > 0 ? 'all_images_removed' : 'ok',
        evictedImages: allEvictions,
        persistedExpenses: nextExpenses,
      };
    } catch {
      return {
        status: 'failed',
        evictedImages: allEvictions,
        persistedExpenses: expenses,
      };
    }
  }
}

export function loadImageRetentionMode(): ImageRetentionMode {
  try {
    const raw = localStorage.getItem(RETENTION_MODE_KEY);
    return raw === 'details_only' ? 'details_only' : 'keep_images';
  } catch {
    return 'keep_images';
  }
}

export function saveImageRetentionMode(mode: ImageRetentionMode): void {
  try {
    localStorage.setItem(RETENTION_MODE_KEY, mode);
  } catch {
    // Ignore storage preference errors
  }
}

export function loadStorageWarningNotice(): StorageWarningNotice | null {
  try {
    const raw = localStorage.getItem(STORAGE_NOTICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StorageWarningNotice;
    if (parsed && typeof parsed.reason === 'string' && Array.isArray(parsed.affectedItems)) {
      return parsed;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

export function saveStorageWarningNotice(notice: StorageWarningNotice | null): void {
  try {
    if (notice) {
      localStorage.setItem(STORAGE_NOTICE_KEY, JSON.stringify(notice));
    } else {
      localStorage.removeItem(STORAGE_NOTICE_KEY);
    }
  } catch {
    // Ignore storage notice write errors
  }
}

export function getLocalStorageUsageBytes(): number {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const val = localStorage.getItem(key) || '';
      total += (key.length + val.length) * 2; // UTF-16 byte estimate
    }
    return total;
  } catch {
    return 0;
  }
}

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function loadScanQueue(): QueuedReceiptScan[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveScanQueue(queue: QueuedReceiptScan[]): void {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn('Failed to persist offline scan queue:', err);
  }
}

export function loadBudgetSettings(): BudgetSettings {
  try {
    const raw = localStorage.getItem(BUDGET_STORAGE_KEY);
    if (!raw) {
      return { defaultMonthlyLimit: null, monthlyOverrides: {} };
    }
    const parsed = JSON.parse(raw) as Partial<BudgetSettings>;
    return {
      defaultMonthlyLimit:
        typeof parsed.defaultMonthlyLimit === 'number' && parsed.defaultMonthlyLimit > 0
          ? parsed.defaultMonthlyLimit
          : null,
      monthlyOverrides:
        parsed.monthlyOverrides && typeof parsed.monthlyOverrides === 'object'
          ? parsed.monthlyOverrides
          : {},
    };
  } catch {
    return { defaultMonthlyLimit: null, monthlyOverrides: {} };
  }
}

export function saveBudgetSettings(settings: BudgetSettings): void {
  try {
    localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to persist budget settings:', err);
  }
}

export function getEffectiveBudgetForMonth(
  settings: BudgetSettings,
  yearMonth: string
): { limit: number | null; isOverride: boolean } {
  const override = settings.monthlyOverrides[yearMonth];
  if (typeof override === 'number' && override > 0) {
    return { limit: override, isOverride: true };
  }
  return { limit: settings.defaultMonthlyLimit, isOverride: false };
}

export function inferCategoryFromMerchant(merchant: string): ExpenseCategory {
  const lower = merchant.toLowerCase();
  if (/(coffee|cafe|roaster|bakery|bistro|restaurant|pizza|sushi|burger|bar|grill|diner|tea)/.test(lower)) {
    return 'Food & Dining';
  }
  if (/(market|grocery|supermarket|whole foods|trader|aldi|kroger|fresh|organic)/.test(lower)) {
    return 'Groceries';
  }
  if (/(uber|lyft|transit|metro|rail|airline|shell|chevron|fuel|gas|parking|taxi)/.test(lower)) {
    return 'Transport';
  }
  if (/(electric|water|power|internet|telecom|verizon|at&t|comcast|utility|pg&e)/.test(lower)) {
    return 'Utilities';
  }
  if (/(pharmacy|cvs|walgreens|clinic|dental|medical|health|hospital|optical)/.test(lower)) {
    return 'Healthcare';
  }
  if (/(cinema|movie|netflix|spotify|theater|museum|ticket|concert|steam)/.test(lower)) {
    return 'Entertainment';
  }
  if (/(store|shop|amazon|target|apple|ikea|hardware|apparel|clothing|boutique)/.test(lower)) {
    return 'Shopping';
  }
  return 'Other';
}

export const MAX_RECEIPT_DATA_URL_LENGTH = 700_000;

function drawResizedJpeg(
  source: CanvasImageSource,
  origWidth: number,
  origHeight: number,
  maxDimension: number,
  quality: number,
  sourceRect?: SourceCropRect
): string | null {
  const sx = sourceRect ? sourceRect.sx : 0;
  const sy = sourceRect ? sourceRect.sy : 0;
  const sw = sourceRect ? sourceRect.sw : origWidth;
  const sh = sourceRect ? sourceRect.sh : origHeight;

  let width = sw;
  let height = sh;
  if (!width || !height) return null;

  if (width > maxDimension || height > maxDimension) {
    if (width >= height) {
      height = Math.max(1, Math.round((height * maxDimension) / width));
      width = maxDimension;
    } else {
      width = Math.max(1, Math.round((width * maxDimension) / height));
      height = maxDimension;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function encodeCanvasWithinBudget(
  source: CanvasImageSource,
  origWidth: number,
  origHeight: number,
  maxDimension = 1200,
  quality = 0.8,
  maxLength = MAX_RECEIPT_DATA_URL_LENGTH,
  sourceRect?: SourceCropRect
): string | null {
  const attempts: Array<{ dim: number; q: number }> = [
    { dim: maxDimension, q: quality },
    { dim: maxDimension, q: Math.min(quality, 0.68) },
    { dim: Math.min(maxDimension, 960), q: 0.62 },
    { dim: Math.min(maxDimension, 768), q: 0.55 },
  ];

  let lastResult: string | null = null;
  for (const step of attempts) {
    const encoded = drawResizedJpeg(
      source,
      origWidth,
      origHeight,
      step.dim,
      step.q,
      sourceRect
    );
    if (!encoded) return null;
    lastResult = encoded;
    if (encoded.length <= maxLength) {
      return encoded;
    }
  }
  return lastResult;
}

function detectUploadAutoCropRect(
  source: CanvasImageSource,
  origWidth: number,
  origHeight: number
): SourceCropRect | undefined {
  const detection = detectReceiptFromCanvasSource(source, origWidth, origHeight);
  if (
    detection.detected &&
    detection.quad &&
    detection.confidence >= 0.55 &&
    detection.areaRatio >= 0.08 &&
    detection.areaRatio <= 0.72
  ) {
    return computeQuadCropRect(
      origWidth,
      origHeight,
      origWidth,
      origHeight,
      detection.quad
    );
  }
  return undefined;
}

export async function compressReceiptFile(
  file: Blob,
  maxDimension = 1200,
  quality = 0.8,
  maxLength = MAX_RECEIPT_DATA_URL_LENGTH,
  autoCrop = true
): Promise<{ dataUrl: string; mimeType: string }> {
  const fallbackMime = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  const decodeWidth = autoCrop ? Math.max(maxDimension, 2048) : maxDimension;

  // Prefer createImageBitmap with resizeWidth so 12-50MP camera photos decode downscaled without spiking RAM
  if (typeof createImageBitmap === 'function') {
    try {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file, {
          resizeWidth: decodeWidth,
          resizeQuality: 'high',
        });
      } catch {
        bitmap = await createImageBitmap(file);
      }
      try {
        const cropRect = autoCrop
          ? detectUploadAutoCropRect(bitmap, bitmap.width, bitmap.height)
          : undefined;
        const dataUrl = encodeCanvasWithinBudget(
          bitmap,
          bitmap.width,
          bitmap.height,
          maxDimension,
          quality,
          maxLength,
          cropRect
        );
        if (dataUrl) {
          return { dataUrl, mimeType: 'image/jpeg' };
        }
      } finally {
        bitmap.close();
      }
    } catch {
      // Fall through to ObjectURL + HTMLImageElement decoding
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const compressed = await new Promise<{ dataUrl: string; mimeType: string } | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const cropRect = autoCrop ? detectUploadAutoCropRect(img, w, h) : undefined;
        const dataUrl = encodeCanvasWithinBudget(
          img,
          w,
          h,
          maxDimension,
          quality,
          maxLength,
          cropRect
        );
        resolve(dataUrl ? { dataUrl, mimeType: 'image/jpeg' } : null);
      };
      img.onerror = () => resolve(null);
      img.src = objectUrl;
    });
    if (compressed) {
      return compressed;
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  // Last-resort DataURL fallback if canvas compression fails
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read image file.'));
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
  if (rawDataUrl.length > maxLength) {
    throw new Error('Receipt photo could not be compressed cleanly. Please try a JPG or PNG image.');
  }
  return { dataUrl: rawDataUrl, mimeType: fallbackMime };
}

export async function compressReceiptImage(
  dataUrl: string,
  maxDimension = 1200,
  quality = 0.8,
  maxLength = MAX_RECEIPT_DATA_URL_LENGTH
): Promise<{ dataUrl: string; mimeType: string }> {
  const detectedMime = dataUrl.match(/^data:([^;]+);/)?.[1] || 'image/jpeg';

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const compressed = encodeCanvasWithinBudget(
          img,
          img.naturalWidth || img.width,
          img.naturalHeight || img.height,
          maxDimension,
          quality,
          maxLength
        );
        if (compressed) {
          resolve({ dataUrl: compressed, mimeType: 'image/jpeg' });
          return;
        }
      } catch {
        // Ignore canvas errors and return original
      }
      resolve({ dataUrl, mimeType: detectedMime });
    };
    img.onerror = () => resolve({ dataUrl, mimeType: detectedMime });
    img.src = dataUrl;
  });
}

export function formatCurrency(amount: number, currency = 'MYR'): string {
  const normalized = (currency || 'MYR').trim().toUpperCase();
  if (normalized === 'MYR' || normalized === 'RM') {
    const sign = amount < 0 ? '-' : '';
    const formatted = new Intl.NumberFormat('en-MY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(amount));
    return `${sign}RM ${formatted}`;
  }
  try {
    return new Intl.NumberFormat('en-MY', {
      style: 'currency',
      currency: normalized,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `RM ${amount.toFixed(2)}`;
  }
}

export function formatMonthLabel(yearMonth: string): string {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month) return yearMonth;
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function shiftMonth(yearMonth: string, delta: number): string {
  const [yearStr, monthStr] = yearMonth.split('-');
  const date = new Date(Number(yearStr), Number(monthStr) - 1 + delta, 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
