const MEDIA_DB_NAME = 'ringgitku.media.v1';
const MEDIA_DB_VERSION = 1;
const RECEIPT_STORE_NAME = 'receipt_images';

interface StoredReceiptMedia {
  id: string;
  dataUrl: string;
  updatedAt: string;
}

export interface SaveMediaResult {
  ok: boolean;
  quotaExceeded?: boolean;
  unavailable?: boolean;
}

export interface StorageEstimateInfo {
  usageBytes: number;
  quotaBytes: number;
  percentUsed: number;
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECEIPT_STORE_NAME)) {
        db.createObjectStore(RECEIPT_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open receipt media store'));
  });
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = 'name' in err ? String((err as { name?: unknown }).name) : '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

export async function saveReceiptImageToDb(
  expenseId: string,
  dataUrl: string
): Promise<SaveMediaResult> {
  if (!isIndexedDbAvailable()) {
    return { ok: false, unavailable: true };
  }

  let db: IDBDatabase | null = null;
  try {
    db = await openMediaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(RECEIPT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(RECEIPT_STORE_NAME);
      const record: StoredReceiptMedia = {
        id: expenseId,
        dataUrl,
        updatedAt: new Date().toISOString(),
      };
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      quotaExceeded: isQuotaError(err),
    };
  } finally {
    db?.close();
  }
}

export async function loadAllReceiptImagesFromDb(): Promise<{
  ok: boolean;
  images: Map<string, string>;
}> {
  if (!isIndexedDbAvailable()) {
    return { ok: false, images: new Map() };
  }

  let db: IDBDatabase | null = null;
  try {
    db = await openMediaDb();
    const records = await new Promise<StoredReceiptMedia[]>((resolve, reject) => {
      const tx = db!.transaction(RECEIPT_STORE_NAME, 'readonly');
      const store = tx.objectStore(RECEIPT_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error ?? new Error('Failed to read receipt images'));
    });
    const map = new Map<string, string>();
    records.forEach((rec) => {
      if (rec && typeof rec.id === 'string' && typeof rec.dataUrl === 'string') {
        map.set(rec.id, rec.dataUrl);
      }
    });
    return { ok: true, images: map };
  } catch {
    return { ok: false, images: new Map() };
  } finally {
    db?.close();
  }
}

export async function deleteReceiptImageFromDb(expenseId: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;

  let db: IDBDatabase | null = null;
  try {
    db = await openMediaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(RECEIPT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(RECEIPT_STORE_NAME);
      store.delete(expenseId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore cleanup errors
  } finally {
    db?.close();
  }
}

export async function clearAllReceiptImagesFromDb(): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;

  let db: IDBDatabase | null = null;
  try {
    db = await openMediaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(RECEIPT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(RECEIPT_STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function estimateDeviceStorage(): Promise<StorageEstimateInfo | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usageBytes = typeof estimate.usage === 'number' ? estimate.usage : 0;
    const quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : 0;
    const percentUsed = quotaBytes > 0 ? Math.min(100, (usageBytes / quotaBytes) * 100) : 0;
    return { usageBytes, quotaBytes, percentUsed };
  } catch {
    return null;
  }
}
