import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface OfflineIndicatorProps {
  queuedCount: number;
  isProcessingQueue: boolean;
  onProcessQueue: () => void;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  queuedCount,
  isProcessingQueue,
  onProcessQueue,
}) => {
  const isOnline = useOnlineStatus();

  if (isOnline && queuedCount === 0) {
    return null;
  }

  return (
    <div className="border-b border-slate-200 bg-slate-100/90 px-4 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-300">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        {!isOnline ? (
          <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Offline mode — Expenses save locally. Receipts can be entered manually or queued for AI scanning.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
            <RefreshCw className={`h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 ${isProcessingQueue ? 'animate-spin' : ''}`} />
            <span>
              {queuedCount} offline {queuedCount === 1 ? 'receipt' : 'receipts'} waiting for AI scan
            </span>
          </div>
        )}

        {isOnline && queuedCount > 0 && (
          <button
            type="button"
            disabled={isProcessingQueue}
            onClick={onProcessQueue}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {isProcessingQueue ? 'Scanning...' : 'Scan Queued Receipts'}
          </button>
        )}
      </div>
    </div>
  );
};
