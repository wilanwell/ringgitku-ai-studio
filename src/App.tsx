import { Component, ErrorInfo, ReactNode, useEffect, useRef, useState } from 'react';
import { Camera, LayoutGrid, List, Wallet, Download, Sun, Moon } from 'lucide-react';
import { useTheme } from './hooks/useTheme';
import {
  BudgetSettings,
  Expense,
  ExpenseCategory,
  EXPENSE_CATEGORIES,
  ImageRetentionMode,
  QueuedReceiptScan,
  ScannedReceiptDraft,
} from './types/expense';
import {
  compressReceiptImage,
  EvictedImageInfo,
  generateId,
  getEffectiveBudgetForMonth,
  loadBudgetSettings,
  loadExpenses,
  loadImageRetentionMode,
  loadScanQueue,
  loadStorageWarningNotice,
  saveBudgetSettings,
  saveExpenses,
  saveImageRetentionMode,
  saveScanQueue,
  saveStorageWarningNotice,
  StorageWarningNotice,
} from './utils/storage';
import {
  deleteReceiptImageFromDb,
  loadAllReceiptImagesFromDb,
  saveReceiptImageToDb,
} from './utils/receiptMediaStore';
import { downloadReceiptImage, exportExpensesToCSV } from './utils/export';
import {
  ReceiptValidationError,
  validateReceiptImage,
} from './utils/imageValidation';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { StorageNoticeBanner } from './components/StorageNoticeBanner';
import { CaptureModal } from './components/CaptureModal';
import { ReviewExpenseModal } from './components/ReviewExpenseModal';
import { DashboardView } from './components/DashboardView';
import { BudgetModal } from './components/BudgetModal';

type AppTab = 'overview' | 'transactions' | 'export';

const SESSION_TAB_KEY = 'ringgitku.session_tab.v1';
const SESSION_DRAFT_KEY = 'ringgitku.session_draft.v1';

function loadSessionTab(): AppTab {
  try {
    const val = sessionStorage.getItem(SESSION_TAB_KEY);
    if (val === 'overview' || val === 'transactions' || val === 'export') {
      return val;
    }
  } catch {
    // Ignore sessionStorage errors
  }
  return 'overview';
}

function loadSessionDraft(): ScannedReceiptDraft | null {
  try {
    const raw = sessionStorage.getItem(SESSION_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScannedReceiptDraft;
    if (parsed && typeof parsed === 'object' && typeof parsed.merchant === 'string') {
      return parsed;
    }
  } catch {
    // Ignore corrupted session draft
  }
  return null;
}

class ModalErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode; onReset: () => void }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unexpected display error.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Modal render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Something went wrong displaying this screen
            </h3>
            <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">{this.state.message}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                this.props.onReset();
              }}
              className="mt-4 min-h-[42px] w-full rounded-xl bg-slate-900 text-xs font-medium text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              Continue
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { isDark, toggleTheme } = useTheme();
  const [expenses, setExpenses] = useState<Expense[]>(() => loadExpenses());
  const [scanQueue, setScanQueue] = useState<QueuedReceiptScan[]>(() => loadScanQueue());
  const [budgetSettings, setBudgetSettings] = useState<BudgetSettings>(() =>
    loadBudgetSettings()
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    new Date().toISOString().slice(0, 7)
  );
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>(() => loadSessionTab());

  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [isBudgetOpen, setIsBudgetOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  const [activeDraft, setActiveDraft] = useState<ScannedReceiptDraft | null>(() =>
    loadSessionDraft()
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [imageRetentionMode, setImageRetentionMode] = useState<ImageRetentionMode>(() =>
    loadImageRetentionMode()
  );
  const [storageNotice, setStorageNotice] = useState<StorageWarningNotice | null>(() =>
    loadStorageWarningNotice()
  );
  const [evictedWithImages, setEvictedWithImages] = useState<EvictedImageInfo[]>([]);
  const idbStoredIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_TAB_KEY, activeTab);
    } catch {
      // Ignore storage errors
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      if (activeDraft) {
        sessionStorage.setItem(SESSION_DRAFT_KEY, JSON.stringify(activeDraft));
      } else {
        sessionStorage.removeItem(SESSION_DRAFT_KEY);
      }
    } catch {
      // If receiptImage exceeds sessionStorage quota, persist draft fields without image
      if (activeDraft) {
        try {
          sessionStorage.setItem(
            SESSION_DRAFT_KEY,
            JSON.stringify({ ...activeDraft, receiptImage: undefined })
          );
        } catch {
          // Ignore
        }
      }
    }
  }, [activeDraft]);

  // Hydrate receipt images from IndexedDB and migrate legacy inline images out of localStorage
  useEffect(() => {
    let cancelled = false;

    const hydrateAndMigrate = async () => {
      const { ok, images } = await loadAllReceiptImagesFromDb();
      if (!ok || cancelled) return;

      images.forEach((_val, id) => {
        idbStoredIdsRef.current.add(id);
      });

      const current = loadExpenses();
      let changed = false;
      const missingMediaItems: Array<{ id: string; merchant: string; date: string }> = [];

      const next = await Promise.all(
        current.map(async (exp) => {
          if (exp.receiptImage) {
            if (!idbStoredIdsRef.current.has(exp.id)) {
              const saved = await saveReceiptImageToDb(exp.id, exp.receiptImage);
              if (saved.ok) {
                idbStoredIdsRef.current.add(exp.id);
                changed = true;
              }
            }
            return { ...exp, receiptImageStatus: 'saved' as const };
          }

          const storedImg = images.get(exp.id);
          if (storedImg) {
            changed = true;
            return {
              ...exp,
              receiptImage: storedImg,
              receiptImageStatus: 'saved' as const,
            };
          }

          if (exp.receiptImageStatus === 'saved') {
            changed = true;
            missingMediaItems.push({
              id: exp.id,
              merchant: exp.merchant,
              date: exp.date,
            });
            return {
              ...exp,
              receiptImage: undefined,
              receiptImageStatus: 'removed_quota' as const,
            };
          }

          return exp;
        })
      );

      if (cancelled) return;

      if (missingMediaItems.length > 0) {
        setStorageNotice((prev) => {
          const existingIds = new Set((prev?.affectedItems || []).map((i) => i.id));
          const merged = [
            ...(prev?.affectedItems || []),
            ...missingMediaItems.filter((item) => !existingIds.has(item.id)),
          ];
          const notice: StorageWarningNotice = {
            reason: 'media_store_evicted',
            affectedItems: merged,
            updatedAt: new Date().toISOString(),
          };
          saveStorageWarningNotice(notice);
          return notice;
        });
      }

      if (changed) {
        setExpenses(next);
      }
    };

    void hydrateAndMigrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveImageRetentionMode(imageRetentionMode);
  }, [imageRetentionMode]);

  useEffect(() => {
    const result = saveExpenses(expenses, idbStoredIdsRef.current);
    if (result.status === 'images_trimmed' || result.status === 'all_images_removed') {
      const newWithImages = result.evictedImages.filter((e) => Boolean(e.dataUrl));
      if (newWithImages.length > 0) {
        setEvictedWithImages((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...newWithImages.filter((item) => !seen.has(item.id))];
        });
      }

      const newlyAffected = result.evictedImages.map((e) => ({
        id: e.id,
        merchant: e.merchant,
        date: e.date,
      }));
      setStorageNotice((prev) => {
        const seenIds = new Set((prev?.affectedItems || []).map((i) => i.id));
        const merged = [
          ...(prev?.affectedItems || []),
          ...newlyAffected.filter((i) => !seenIds.has(i.id)),
        ];
        const notice: StorageWarningNotice = {
          reason: result.status === 'images_trimmed' ? 'quota_trimmed' : 'all_images_removed',
          affectedItems: merged,
          updatedAt: new Date().toISOString(),
        };
        saveStorageWarningNotice(notice);
        return notice;
      });

      setExpenses(result.persistedExpenses);
    } else if (result.status === 'failed') {
      const notice: StorageWarningNotice = {
        reason: 'save_failed',
        affectedItems: [],
        updatedAt: new Date().toISOString(),
      };
      saveStorageWarningNotice(notice);
      setStorageNotice(notice);
    }
  }, [expenses]);

  useEffect(() => {
    saveScanQueue(scanQueue);
  }, [scanQueue]);

  useEffect(() => {
    saveBudgetSettings(budgetSettings);
  }, [budgetSettings]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const refreshProxySession = (): Promise<void> => {
    if (typeof document === 'undefined') return Promise.resolve();
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.setAttribute('aria-hidden', 'true');
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        iframe.remove();
        resolve();
      };
      const timer = window.setTimeout(cleanup, 1800);
      iframe.onload = cleanup;
      iframe.onerror = cleanup;
      iframe.src = `/api/health?ts=${Date.now()}`;
      document.body.appendChild(iframe);
    });
  };

  const scanReceiptImage = async (
    dataUrl: string,
    mimeType: string,
    onProgress?: (status: string) => void
  ): Promise<ScannedReceiptDraft> => {
    onProgress?.('Checking image contrast & legibility...');
    // Pre-flight client-side validation (non-retryable if image is blank, dark, blurry, or invalid)
    await validateReceiptImage(dataUrl, mimeType);

    const MAX_ATTEMPTS = 3;
    const TIMEOUT_MS = 30_000;
    const RETRYABLE_STATUSES = new Set([408, 500, 502, 503, 504]);

    class RetryableScanError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'RetryableScanError';
      }
    }

    let currentDataUrl = dataUrl;
    let currentMimeType = mimeType;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (attempt === 1) {
        onProgress?.('Reading merchant, date, category, and line items...');
      } else {
        onProgress?.(`Retrying receipt scan (attempt ${attempt} of ${MAX_ATTEMPTS})...`);
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const response = await fetch('/api/receipts/scan', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            imageBase64: currentDataUrl,
            mimeType: currentMimeType,
          }),
        });

        const rawBody = await response.text();
        const looksLikeHtml = /^\s*</.test(rawBody);

        if (looksLikeHtml) {
          const isPayloadTooLarge =
            response.status === 413 ||
            /413|Request Entity Too Large|Payload Too Large/i.test(rawBody);

          if (isPayloadTooLarge) {
            if (attempt < MAX_ATTEMPTS) {
              const smaller = await compressReceiptImage(currentDataUrl, 800, 0.55, 420_000);
              currentDataUrl = smaller.dataUrl;
              currentMimeType = smaller.mimeType;
              throw new RetryableScanError('Photo size exceeded proxy limit; optimizing and retrying...');
            }
            throw new Error(
              'Receipt photo is too large for the server. Please try a closer or lower-resolution photo.'
            );
          }

          const isSessionRedirect =
            response.redirected ||
            response.url.includes('__cookie_check') ||
            /__cookie_check|_aistudio-iframe|302 Found|accounts\.google\.com|Sign in/i.test(rawBody);

          if (isSessionRedirect) {
            if (attempt < MAX_ATTEMPTS) {
              await refreshProxySession();
              throw new RetryableScanError('Refreshing session and retrying scan...');
            }
            throw new Error(
              'Preview session expired or cookies are blocked. Please reload the page and try again.'
            );
          }

          throw new RetryableScanError(
            response.status >= 500
              ? `The receipt scanner server is temporarily unavailable (HTTP ${response.status}). Please wait a moment and try again.`
              : `Unexpected server response (HTTP ${response.status}). Please try again.`
          );
        }

        let data: Record<string, unknown> | null = null;
        try {
          data = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          if (response.status === 413) {
            if (attempt < MAX_ATTEMPTS) {
              const smaller = await compressReceiptImage(currentDataUrl, 800, 0.55, 420_000);
              currentDataUrl = smaller.dataUrl;
              currentMimeType = smaller.mimeType;
              throw new RetryableScanError('Optimizing photo size and retrying...');
            }
            throw new Error('Receipt image is too large. Please try a smaller photo.');
          }
          throw new RetryableScanError(
            'The receipt scanner returned an incomplete response.'
          );
        }

        if (!response.ok) {
          const errMsg =
            typeof data?.error === 'string' && data.error
              ? data.error
              : `Receipt scan failed (HTTP ${response.status}).`;

          if (response.status === 413 && attempt < MAX_ATTEMPTS) {
            const smaller = await compressReceiptImage(currentDataUrl, 800, 0.55, 420_000);
            currentDataUrl = smaller.dataUrl;
            currentMimeType = smaller.mimeType;
            throw new RetryableScanError(errMsg);
          }

          if (RETRYABLE_STATUSES.has(response.status)) {
            throw new RetryableScanError(errMsg);
          }
          // Non-retryable 4xx (e.g. 400 invalid image, 403 key/permissions, 429 rate limit)
          throw new Error(errMsg);
        }

        const rawCat = typeof data.category === 'string' ? data.category : '';
        const validCategory: ExpenseCategory = EXPENSE_CATEGORIES.includes(rawCat as ExpenseCategory)
          ? (rawCat as ExpenseCategory)
          : 'Other';

        const rawConfidence = data.confidence;
        const confidence: 'high' | 'medium' | 'low' =
          rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low'
            ? rawConfidence
            : 'medium';

        const toSafeNum = (val: unknown, fallback = 0) => {
          const n = Number(val);
          return Number.isFinite(n) && n >= 0 ? n : fallback;
        };

        return {
          merchant:
            typeof data.merchant === 'string' && data.merchant.trim()
              ? data.merchant.trim()
              : 'Unknown Merchant',
          date:
            typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)
              ? data.date
              : new Date().toISOString().slice(0, 10),
          currency: typeof data.currency === 'string' && data.currency.trim() ? data.currency.trim() : 'MYR',
          category: validCategory,
          subtotal: toSafeNum(data.subtotal),
          tax: toSafeNum(data.tax),
          total: toSafeNum(data.total),
          paymentMethod: typeof data.paymentMethod === 'string' ? data.paymentMethod : '',
          notes: typeof data.notes === 'string' ? data.notes : '',
          ocrConfidence: confidence,
          receiptImage: dataUrl,
          items: Array.isArray(data.items)
            ? data.items
                .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
                .map((item) => ({
                  id: generateId('item'),
                  name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Item',
                  quantity: toSafeNum(item.quantity, 1) || 1,
                  price: toSafeNum(item.price, 0),
                }))
            : [],
        };
      } catch (err) {
        if (err instanceof ReceiptValidationError) {
          throw err;
        }

        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        const isNetworkError = err instanceof TypeError;
        const isRetryable =
          err instanceof RetryableScanError || isAbort || isNetworkError;

        lastError = isAbort
          ? new Error('Receipt scan timed out. Please check your connection and try again.')
          : isNetworkError
            ? new Error('Network connection interrupted while uploading receipt.')
            : err instanceof Error
              ? err
              : new Error('Unable to scan receipt.');

        if (!isRetryable || attempt === MAX_ATTEMPTS) {
          throw lastError;
        }

        // Exponential backoff with jitter: ~750ms, then ~1500ms
        const baseDelay = 700 * 2 ** (attempt - 1);
        const jitter = Math.floor(Math.random() * 250);
        await new Promise((resolve) => window.setTimeout(resolve, baseDelay + jitter));
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    throw lastError ?? new Error('Unable to scan receipt after multiple attempts.');
  };

  const handleImageReadyForScan = async (dataUrl: string, mimeType: string) => {
    setIsScanning(true);
    setScanError(null);
    setScanStatus('Checking image contrast & legibility...');
    try {
      const draft = await scanReceiptImage(dataUrl, mimeType, setScanStatus);
      setIsCaptureOpen(false);
      setActiveDraft(draft);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to scan receipt.';
      setScanError(message);
    } finally {
      setIsScanning(false);
      setScanStatus(null);
    }
  };

  const handleQueueOfflineScan = (dataUrl: string, mimeType: string) => {
    const entry: QueuedReceiptScan = {
      id: generateId('queue'),
      imageDataUrl: dataUrl,
      mimeType,
      capturedAt: new Date().toISOString(),
    };
    setScanQueue((prev) => [...prev, entry]);
    setToastMessage('Receipt saved to offline queue for AI scanning.');
  };

  const handleProcessQueue = async () => {
    if (scanQueue.length === 0 || isProcessingQueue) return;
    setIsProcessingQueue(true);
    const remaining: QueuedReceiptScan[] = [];
    let processedCount = 0;

    for (const queued of scanQueue) {
      try {
        const draft = await scanReceiptImage(queued.imageDataUrl, queued.mimeType);
        const now = new Date().toISOString();
        const expId = generateId('exp');
        const shouldKeepImage = imageRetentionMode === 'keep_images';
        const imageToKeep = shouldKeepImage ? draft.receiptImage : undefined;

        if (imageToKeep) {
          const mediaResult = await saveReceiptImageToDb(expId, imageToKeep);
          if (mediaResult.ok) {
            idbStoredIdsRef.current.add(expId);
          }
        }

        const newExpense: Expense = {
          id: expId,
          merchant: draft.merchant,
          date: draft.date,
          currency: draft.currency,
          category: draft.category,
          subtotal: draft.subtotal,
          tax: draft.tax,
          total: draft.total,
          paymentMethod: draft.paymentMethod,
          notes: draft.notes,
          items: draft.items,
          receiptImage: imageToKeep,
          receiptImageStatus: imageToKeep ? 'saved' : 'not_retained',
          ocrConfidence: draft.ocrConfidence,
          createdAt: now,
          updatedAt: now,
        };
        setExpenses((prev) => [newExpense, ...prev]);
        processedCount += 1;
      } catch {
        remaining.push(queued);
      }
    }

    setScanQueue(remaining);
    setIsProcessingQueue(false);
    if (processedCount > 0) {
      setToastMessage(
        `Scanned ${processedCount} queued ${processedCount === 1 ? 'receipt' : 'receipts'}.`
      );
    } else {
      setToastMessage('Could not process queued receipts right now.');
    }
  };

  const handleOpenManualEntry = () => {
    setIsCaptureOpen(false);
    setScanError(null);
    setActiveDraft({
      merchant: '',
      date: new Date().toISOString().slice(0, 10),
      currency: 'MYR',
      category: 'Other',
      subtotal: 0,
      tax: 0,
      total: 0,
      paymentMethod: '',
      notes: '',
      items: [],
    });
  };

  const handleSaveDraft = async (draft: ScannedReceiptDraft) => {
    const now = new Date().toISOString();
    const targetId = draft.id || generateId('exp');

    if (draft.receiptImage && draft.receiptImageStatus !== 'not_retained') {
      const mediaRes = await saveReceiptImageToDb(targetId, draft.receiptImage);
      if (mediaRes.ok) {
        idbStoredIdsRef.current.add(targetId);
      }
    } else if (draft.id) {
      idbStoredIdsRef.current.delete(targetId);
      void deleteReceiptImageFromDb(targetId);
    }

    if (draft.id) {
      setExpenses((prev) =>
        prev.map((exp) =>
          exp.id === draft.id
            ? {
                ...exp,
                merchant: draft.merchant,
                date: draft.date,
                currency: draft.currency,
                category: draft.category,
                subtotal: draft.subtotal,
                tax: draft.tax,
                total: draft.total,
                paymentMethod: draft.paymentMethod,
                notes: draft.notes,
                items: draft.items,
                receiptImage: draft.receiptImage,
                receiptImageStatus: draft.receiptImage
                  ? 'saved'
                  : draft.receiptImageStatus,
                ocrConfidence: draft.ocrConfidence,
                updatedAt: now,
              }
            : exp
        )
      );
      setToastMessage('Expense updated.');
    } else {
      const created: Expense = {
        id: targetId,
        merchant: draft.merchant,
        date: draft.date,
        currency: draft.currency,
        category: draft.category,
        subtotal: draft.subtotal,
        tax: draft.tax,
        total: draft.total,
        paymentMethod: draft.paymentMethod,
        notes: draft.notes,
        items: draft.items,
        receiptImage: draft.receiptImage,
        receiptImageStatus: draft.receiptImage
          ? 'saved'
          : draft.receiptImageStatus,
        ocrConfidence: draft.ocrConfidence,
        createdAt: now,
        updatedAt: now,
      };
      setExpenses((prev) => [created, ...prev]);
      if (draft.date && draft.date.length >= 7) {
        setSelectedMonth(draft.date.slice(0, 7));
      }
      setToastMessage('Expense saved.');
    }
    setActiveDraft(null);
  };

  const handleDeleteExpense = (id: string) => {
    idbStoredIdsRef.current.delete(id);
    void deleteReceiptImageFromDb(id);
    setExpenses((prev) => prev.filter((exp) => exp.id !== id));
    setActiveDraft(null);
    setToastMessage('Expense deleted.');
  };

  const handleSelectExpense = (expense: Expense) => {
    setActiveDraft({
      id: expense.id,
      merchant: expense.merchant,
      date: expense.date,
      currency: expense.currency,
      category: expense.category,
      subtotal: expense.subtotal,
      tax: expense.tax,
      total: expense.total,
      paymentMethod: expense.paymentMethod,
      notes: expense.notes,
      items: expense.items,
      receiptImage: expense.receiptImage,
      receiptImageStatus: expense.receiptImageStatus,
      ocrConfidence: expense.ocrConfidence,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      {/* Top Bar Contract: Brand wordmark — Nav links — Primary action */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-4 px-4 sm:h-16 sm:gap-8 sm:px-6">
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('overview');
            }}
            className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-slate-100"
          >
            <img
              src="/icon.svg"
              alt=""
              className="h-7 w-7 rounded-lg"
            />
            RinggitKu
          </a>

          <nav className="hidden items-center gap-7 text-sm font-medium md:flex">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`min-h-[40px] border-b-2 px-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'overview'
                  ? 'border-emerald-600 text-slate-900 dark:border-emerald-500 dark:text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('transactions')}
              className={`min-h-[40px] border-b-2 px-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'transactions'
                  ? 'border-emerald-600 text-slate-900 dark:border-emerald-500 dark:text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Transactions
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('export')}
              className={`min-h-[40px] border-b-2 px-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'export'
                  ? 'border-emerald-600 text-slate-900 dark:border-emerald-500 dark:text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Export
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              data-testid="theme-toggle"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 sm:h-10 sm:w-10 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
            >
              {isDark ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => {
                setScanError(null);
                setIsCaptureOpen(true);
              }}
              className="hidden min-h-[40px] items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-medium text-white shadow-xs transition-colors hover:bg-emerald-700 whitespace-nowrap shrink-0 md:inline-flex"
            >
              <Camera className="h-4 w-4" />
              Scan Receipt
            </button>
          </div>
        </div>
      </header>

      <OfflineIndicator
        queuedCount={scanQueue.length}
        isProcessingQueue={isProcessingQueue}
        onProcessQueue={handleProcessQueue}
      />

      <StorageNoticeBanner
        notice={storageNotice}
        evictedWithImages={evictedWithImages}
        retentionMode={imageRetentionMode}
        onDownloadEvictedImages={() => {
          evictedWithImages.forEach((item) => {
            if (item.dataUrl) {
              downloadReceiptImage(item.dataUrl, `ringgitku-${item.date}-${item.merchant}`);
            }
          });
          setToastMessage(
            `Downloaded ${evictedWithImages.length} receipt ${
              evictedWithImages.length === 1 ? 'photo' : 'photos'
            }.`
          );
        }}
        onExportCsvBackup={() => {
          exportExpensesToCSV(expenses, 'ringgitku-backup-all');
          setToastMessage('Exported CSV backup of all transaction records.');
        }}
        onSwitchToDetailsOnly={() => {
          setImageRetentionMode('details_only');
          setToastMessage('Switched to Details Only mode for future scans.');
        }}
        onDismiss={() => {
          setStorageNotice(null);
          setEvictedWithImages([]);
          saveStorageWarningNotice(null);
        }}
      />

      <main>
        <DashboardView
          expenses={expenses}
          selectedMonth={selectedMonth}
          showAllMonths={showAllMonths}
          monthlyBudget={getEffectiveBudgetForMonth(budgetSettings, selectedMonth).limit}
          isBudgetOverride={getEffectiveBudgetForMonth(budgetSettings, selectedMonth).isOverride}
          imageRetentionMode={imageRetentionMode}
          onChangeImageRetentionMode={(mode) => {
            setImageRetentionMode(mode);
            setToastMessage(
              mode === 'details_only'
                ? 'Future scans will save transaction details only.'
                : 'Future scans will retain receipt photos.'
            );
          }}
          onChangeMonth={setSelectedMonth}
          onToggleAllMonths={setShowAllMonths}
          onOpenCapture={() => {
            setScanError(null);
            setIsCaptureOpen(true);
          }}
          onOpenManual={handleOpenManualEntry}
          onOpenBudget={() => setIsBudgetOpen(true)}
          onSelectExpense={handleSelectExpense}
          activeTab={activeTab}
        />
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe md:hidden dark:border-slate-800 dark:bg-slate-900/95"
      >
        <div className="grid h-16 grid-cols-5 items-end">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`flex h-full min-h-[44px] flex-col items-center justify-end gap-1 pb-2 text-[11px] font-medium transition-colors ${
              activeTab === 'overview' && !isBudgetOpen
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <LayoutGrid className="h-5 w-5" />
            <span className="leading-none">Overview</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('transactions')}
            className={`flex h-full min-h-[44px] flex-col items-center justify-end gap-1 pb-2 text-[11px] font-medium transition-colors ${
              activeTab === 'transactions' && !isBudgetOpen
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <List className="h-5 w-5" />
            <span className="leading-none">History</span>
          </button>

          <button
            type="button"
            aria-label="Scan receipt"
            onClick={() => {
              setScanError(null);
              setIsCaptureOpen(true);
            }}
            className="group flex h-full min-h-[44px] flex-col items-center justify-end pb-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400"
          >
            <span className="flex h-12 w-12 -translate-y-1.5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 ring-4 ring-white transition-transform group-hover:bg-emerald-700 group-active:scale-95 dark:ring-slate-900 dark:shadow-emerald-950/60">
              <Camera className="h-5 w-5" />
            </span>
            <span className="leading-none">Scan</span>
          </button>

          <button
            type="button"
            onClick={() => setIsBudgetOpen(true)}
            className={`flex h-full min-h-[44px] flex-col items-center justify-end gap-1 pb-2 text-[11px] font-medium transition-colors ${
              isBudgetOpen ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Wallet className="h-5 w-5" />
            <span className="leading-none">Budget</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`flex h-full min-h-[44px] flex-col items-center justify-end gap-1 pb-2 text-[11px] font-medium transition-colors ${
              activeTab === 'export' && !isBudgetOpen
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Download className="h-5 w-5" />
            <span className="leading-none">Export</span>
          </button>
        </div>
      </nav>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg md:bottom-6 dark:border dark:border-slate-700 dark:bg-slate-800">
          {toastMessage}
        </div>
      )}

      {/* Capture & AI OCR Modal */}
      <ModalErrorBoundary onReset={() => { setIsCaptureOpen(false); setIsScanning(false); }}>
        <CaptureModal
          isOpen={isCaptureOpen}
          onClose={() => {
            if (!isScanning) {
              setIsCaptureOpen(false);
              setScanError(null);
              setScanStatus(null);
            }
          }}
          onImageReadyForScan={handleImageReadyForScan}
          onQueueOfflineScan={handleQueueOfflineScan}
          onManualEntry={handleOpenManualEntry}
          isScanning={isScanning}
          scanStatus={scanStatus}
          scanError={scanError}
        />
      </ModalErrorBoundary>

      {/* Review & Edit Modal */}
      <ModalErrorBoundary onReset={() => setActiveDraft(null)}>
        <ReviewExpenseModal
          key={
            activeDraft
              ? activeDraft.id || (activeDraft.receiptImage ? 'scanned-draft' : 'manual')
              : 'closed'
          }
          draft={activeDraft}
          defaultRetentionMode={imageRetentionMode}
          onClose={() => setActiveDraft(null)}
          onSave={(savedDraft) => {
            void handleSaveDraft(savedDraft);
          }}
          onDelete={handleDeleteExpense}
        />
      </ModalErrorBoundary>

      {/* Monthly Budget Modal */}
      <BudgetModal
        key={isBudgetOpen ? `budget-${selectedMonth}` : 'budget-closed'}
        isOpen={isBudgetOpen}
        selectedMonth={selectedMonth}
        currentMonthSpend={expenses
          .filter((e) => e.date.startsWith(selectedMonth))
          .reduce((sum, e) => sum + e.total, 0)}
        settings={budgetSettings}
        onClose={() => setIsBudgetOpen(false)}
        onSave={(nextSettings) => {
          setBudgetSettings(nextSettings);
          setIsBudgetOpen(false);
          const effective = getEffectiveBudgetForMonth(nextSettings, selectedMonth);
          setToastMessage(
            effective.limit ? 'Monthly budget updated.' : 'Monthly budget limit removed.'
          );
        }}
      />
    </div>
  );
}
