import React from 'react';
import { AlertTriangle, Download, FileSpreadsheet, SlidersHorizontal, X } from 'lucide-react';
import { ImageRetentionMode } from '../types/expense';
import { EvictedImageInfo, StorageWarningNotice } from '../utils/storage';

interface StorageNoticeBannerProps {
  notice: StorageWarningNotice | null;
  evictedWithImages: EvictedImageInfo[];
  retentionMode: ImageRetentionMode;
  onDownloadEvictedImages: () => void;
  onExportCsvBackup: () => void;
  onSwitchToDetailsOnly: () => void;
  onDismiss: () => void;
}

export const StorageNoticeBanner: React.FC<StorageNoticeBannerProps> = ({
  notice,
  evictedWithImages,
  retentionMode,
  onDownloadEvictedImages,
  onExportCsvBackup,
  onSwitchToDetailsOnly,
  onDismiss,
}) => {
  if (!notice) return null;

  const affectedCount = notice.affectedItems.length;
  const previewMerchants = notice.affectedItems
    .slice(0, 3)
    .map((item) => `${item.merchant} (${item.date})`)
    .join(', ');
  const remainingCount = Math.max(0, affectedCount - 3);

  const isSaveFailed = notice.reason === 'save_failed';

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
      <div
        role="alert"
        data-testid="storage-eviction-alert"
        className={`rounded-2xl border p-4 ${
          isSaveFailed
            ? 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-100'
            : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-100'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                isSaveFailed
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            />
            <div className="min-w-0 space-y-1.5">
              <h3 className="font-display text-sm font-semibold">
                {isSaveFailed
                  ? 'Device storage is full — unable to save changes'
                  : notice.reason === 'media_store_evicted'
                    ? 'Saved receipt photos were cleared by browser storage'
                    : 'Storage limit reached — receipt photo(s) removed to protect your records'}
              </h3>

              <p className="text-xs leading-relaxed opacity-90">
                {isSaveFailed
                  ? 'Your browser rejected saving new expense data because local storage is full. Export a CSV backup or remove older saved photos before adding more entries.'
                  : `All transaction details, amounts, and line items remain safely saved, but ${affectedCount} receipt ${
                      affectedCount === 1 ? 'photo could' : 'photos could'
                    } not be kept on this device due to storage limits.`}
              </p>

              {previewMerchants && (
                <p className="text-xs font-medium opacity-95">
                  Affected {affectedCount === 1 ? 'record' : 'records'}: {previewMerchants}
                  {remainingCount > 0 ? ` and ${remainingCount} more` : ''}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1.5">
                {evictedWithImages.length > 0 && (
                  <button
                    type="button"
                    onClick={onDownloadEvictedImages}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-amber-900 px-3 text-xs font-medium text-white transition-colors hover:bg-amber-800 whitespace-nowrap shrink-0 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download {evictedWithImages.length === 1 ? 'Photo' : `${evictedWithImages.length} Photos`}
                  </button>
                )}

                <button
                  type="button"
                  onClick={onExportCsvBackup}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 text-xs font-medium text-amber-950 transition-colors hover:bg-amber-100/60 whitespace-nowrap shrink-0 dark:border-amber-500/40 dark:bg-slate-900 dark:text-amber-100 dark:hover:bg-slate-800"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Export CSV Backup
                </button>

                {retentionMode === 'keep_images' && !isSaveFailed && (
                  <button
                    type="button"
                    onClick={onSwitchToDetailsOnly}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 text-xs font-medium text-amber-950 transition-colors hover:bg-amber-100/60 whitespace-nowrap shrink-0 dark:border-amber-500/40 dark:bg-slate-900 dark:text-amber-100 dark:hover:bg-slate-800"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Save Details Only Going Forward
                  </button>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Acknowledge and dismiss storage notice"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl opacity-75 transition-opacity hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
