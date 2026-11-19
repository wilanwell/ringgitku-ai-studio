import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Check,
  ZoomIn,
  ZoomOut,
  ShieldCheck,
  AlertTriangle,
  Receipt,
  Download,
  ImageOff,
  Upload,
} from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  ExpenseCategory,
  ImageRetentionMode,
  LineItem,
  ScannedReceiptDraft,
} from '../types/expense';
import { compressReceiptFile, generateId, inferCategoryFromMerchant } from '../utils/storage';
import { downloadReceiptImage } from '../utils/export';

interface ReviewExpenseModalProps {
  draft: ScannedReceiptDraft | null;
  defaultRetentionMode?: ImageRetentionMode;
  onClose: () => void;
  onSave: (draft: ScannedReceiptDraft) => void;
  onDelete?: (id: string) => void;
}

export const ReviewExpenseModal: React.FC<ReviewExpenseModalProps> = ({
  draft,
  defaultRetentionMode = 'keep_images',
  onClose,
  onSave,
  onDelete,
}) => {
  const [merchant, setMerchant] = useState(draft?.merchant ?? '');
  const [date, setDate] = useState(draft?.date ?? new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<ExpenseCategory>(draft?.category ?? 'Other');
  const [currency, setCurrency] = useState(draft?.currency ?? 'MYR');
  const [subtotal, setSubtotal] = useState(String(draft?.subtotal ?? 0));
  const [tax, setTax] = useState(String(draft?.tax ?? 0));
  const [total, setTotal] = useState(String(draft?.total ?? 0));
  const [paymentMethod, setPaymentMethod] = useState(draft?.paymentMethod ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [items, setItems] = useState<LineItem[]>(draft?.items ?? []);
  const [receiptImage, setReceiptImage] = useState<string | undefined>(draft?.receiptImage);
  const [keepReceiptImage, setKeepReceiptImage] = useState<boolean>(() => {
    if (!draft?.receiptImage) return false;
    if (draft.id) return true;
    return defaultRetentionMode === 'keep_images';
  });
  const [isAttachingPhoto, setIsAttachingPhoto] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!draft) return null;

  const isEditingExisting = Boolean(draft.id);
  const showLeftMediaPanel = Boolean(
    receiptImage ||
      draft.receiptImageStatus === 'removed_quota' ||
      draft.receiptImageStatus === 'not_retained'
  );

  const handleMerchantChange = (val: string) => {
    setMerchant(val);
    // Auto-categorize if this is a fresh manual entry still on Other
    if (!draft.receiptImage && !isEditingExisting && category === 'Other' && val.trim().length > 2) {
      const guessed = inferCategoryFromMerchant(val);
      if (guessed !== 'Other') {
        setCategory(guessed);
      }
    }
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: generateId('item'), name: '', quantity: 1, price: 0 },
    ]);
  };

  const handleUpdateItem = (id: string, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleRecalculateFromItems = () => {
    const itemsSum = items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
    const parsedTax = Number(tax) || 0;
    setSubtotal(itemsSum.toFixed(2));
    setTotal((itemsSum + parsedTax).toFixed(2));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedMerchant = merchant.trim();
    const parsedTotal = Number(total);

    if (!trimmedMerchant) {
      setValidationError('Please enter a merchant or store name.');
      return;
    }
    if (Number.isNaN(parsedTotal) || parsedTotal < 0) {
      setValidationError('Please enter a valid total amount.');
      return;
    }

    const shouldKeepPhoto = Boolean(receiptImage && keepReceiptImage);
    const nextImageStatus = shouldKeepPhoto
      ? ('saved' as const)
      : receiptImage
        ? ('not_retained' as const)
        : draft.receiptImageStatus;

    setValidationError(null);
    onSave({
      id: draft.id,
      merchant: trimmedMerchant,
      date: date || new Date().toISOString().slice(0, 10),
      currency: currency.trim().toUpperCase() || 'MYR',
      category,
      subtotal: Number(subtotal) || 0,
      tax: Number(tax) || 0,
      total: parsedTotal,
      paymentMethod: paymentMethod.trim(),
      notes: notes.trim(),
      items: items.filter((it) => it.name.trim() !== '' || it.price > 0),
      receiptImage: shouldKeepPhoto ? receiptImage : undefined,
      receiptImageStatus: nextImageStatus,
      ocrConfidence: draft.ocrConfidence,
    });
  };

  const handleAttachPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsAttachingPhoto(true);
    setValidationError(null);
    try {
      const { dataUrl } = await compressReceiptFile(file);
      setReceiptImage(dataUrl);
      setKeepReceiptImage(true);
    } catch {
      setValidationError('Could not process that image file. Please try a JPG or PNG photo.');
    } finally {
      setIsAttachingPhoto(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
              {isEditingExisting ? 'Review & Edit Expense' : 'Verify Extracted Receipt'}
            </h2>
            {draft.ocrConfidence && (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                {draft.ocrConfidence === 'high' ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                )}
                <span>
                  OCR confidence: <strong className="font-medium capitalize text-slate-700 dark:text-slate-200">{draft.ocrConfidence}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>Verify fields before saving</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close review drawer"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form id="review-expense-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
            {/* Left column: Receipt Photo & Retention Choice */}
            {showLeftMediaPanel && (
              <div className="bg-slate-50 p-5 lg:col-span-5 dark:bg-slate-950/60">
                {receiptImage ? (
                  <>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        Original Receipt
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            downloadReceiptImage(
                              receiptImage,
                              `ringgitku-${date || 'receipt'}-${merchant || 'expense'}`
                            )
                          }
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => setZoomed((z) => !z)}
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          {zoomed ? <ZoomOut className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
                          {zoomed ? 'Fit' : 'Zoom'}
                        </button>
                      </div>
                    </div>
                    <div
                      className={`overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${
                        zoomed ? 'max-h-[380px]' : ''
                      } ${!keepReceiptImage ? 'opacity-45 grayscale' : ''}`}
                    >
                      <img
                        src={receiptImage}
                        alt={`Receipt from ${merchant || 'merchant'}`}
                        referrerPolicy="no-referrer"
                        className={`w-full rounded-xl object-contain transition-transform ${
                          zoomed ? 'scale-150 origin-top-left' : 'max-h-[340px]'
                        }`}
                      />
                    </div>
                    <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3 text-xs transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/70">
                      <input
                        type="checkbox"
                        checked={keepReceiptImage}
                        onChange={(e) => setKeepReceiptImage(e.target.checked)}
                        data-testid="keep-receipt-image-toggle"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="space-y-0.5">
                        <span className="block font-medium text-slate-800 dark:text-slate-200">
                          Keep receipt photo on device
                        </span>
                        <span className="block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                          {keepReceiptImage
                            ? 'Photo is saved separately from transaction data. Uncheck to keep only extracted details.'
                            : 'Only transaction details will be saved; this photo will not be stored on your device.'}
                        </span>
                      </span>
                    </label>
                  </>
                ) : (
                  <div
                    data-testid="evicted-image-notice"
                    className={`rounded-xl border p-4 text-xs ${
                      draft.receiptImageStatus === 'removed_quota'
                        ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100'
                        : 'border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <ImageOff
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          draft.receiptImageStatus === 'removed_quota'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      />
                      <div className="space-y-1.5">
                        <p className="font-semibold">
                          {draft.receiptImageStatus === 'removed_quota'
                            ? 'Receipt photo removed due to storage limit'
                            : 'Saved with transaction details only'}
                        </p>
                        <p className="leading-relaxed opacity-85">
                          {draft.receiptImageStatus === 'removed_quota'
                            ? 'Your browser ran out of space previously, so this photo was cleared to protect your expense record. All amounts and items remain intact.'
                            : 'You chose not to store the receipt image for this entry. You can attach a photo below anytime.'}
                        </p>
                        <label className="mt-2 inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">
                          <Upload className="h-3.5 w-3.5" />
                          {isAttachingPhoto ? 'Processing photo...' : 'Attach Receipt Photo'}
                          <input
                            type="file"
                            accept="image/*"
                            disabled={isAttachingPhoto}
                            onChange={handleAttachPhoto}
                            className="sr-only"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Right column: Fields & Line Items */}
            <div className={`p-5 space-y-5 ${showLeftMediaPanel ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
              {validationError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-200">
                  {validationError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5 dark:text-slate-400">
                    Merchant / Store Name
                  </label>
                  <input
                    type="text"
                    value={merchant}
                    onChange={(e) => handleMerchantChange(e.target.value)}
                    placeholder="e.g., Roastery & Co."
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5 dark:text-slate-400">
                    Date
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="font-mono-num w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5 dark:text-slate-400">
                    Payment Method
                  </label>
                  <input
                    type="text"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    placeholder="e.g., Visa •••• 4821"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Category selector */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2 dark:text-slate-400">
                  Category
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {EXPENSE_CATEGORIES.map((cat) => {
                    const active = category === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategory(cat)}
                        className={`min-h-[40px] rounded-xl border px-2.5 py-2 text-xs font-medium transition-colors truncate ${
                          active
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-700'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Amounts */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5 dark:text-slate-400">
                    Subtotal
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={subtotal}
                    onChange={(e) => setSubtotal(e.target.value)}
                    className="font-mono-num w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5 dark:text-slate-400">
                    Tax
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tax}
                    onChange={(e) => setTax(e.target.value)}
                    className="font-mono-num w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-900 mb-1.5 dark:text-slate-200">
                    Total ({currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    className="font-mono-num w-full min-h-[44px] rounded-xl border border-emerald-600/40 bg-emerald-50/40 px-3 text-sm font-semibold text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-emerald-500/50 dark:bg-emerald-950/40 dark:text-emerald-200 dark:focus:border-emerald-400"
                    required
                  />
                </div>
              </div>

              {/* Line Items */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      Line Items ({items.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {items.length > 0 && (
                      <button
                        type="button"
                        onClick={handleRecalculateFromItems}
                        className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                      >
                        Sync total from items
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleAddItem}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add item
                    </button>
                  </div>
                </div>

                {items.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 py-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    No itemized lines recorded.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {items.map((item) => (
                      <div key={item.id} className="grid grid-cols-12 items-center gap-2 p-2">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => handleUpdateItem(item.id, { name: e.target.value })}
                          placeholder="Item description"
                          className="col-span-6 min-h-[38px] rounded-lg border border-transparent bg-transparent px-2 text-xs text-slate-900 hover:border-slate-200 focus:border-emerald-600 focus:outline-none dark:text-slate-100 dark:hover:border-slate-700"
                        />
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={item.quantity}
                          onChange={(e) =>
                            handleUpdateItem(item.id, { quantity: Number(e.target.value) || 1 })
                          }
                          aria-label="Quantity"
                          className="font-mono-num col-span-2 min-h-[38px] rounded-lg border border-transparent bg-transparent px-2 text-right text-xs text-slate-700 hover:border-slate-200 focus:border-emerald-600 focus:outline-none dark:text-slate-300 dark:hover:border-slate-700"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.price}
                          onChange={(e) =>
                            handleUpdateItem(item.id, { price: Number(e.target.value) || 0 })
                          }
                          aria-label="Line price"
                          className="font-mono-num col-span-3 min-h-[38px] rounded-lg border border-transparent bg-transparent px-2 text-right text-xs font-medium text-slate-900 hover:border-slate-200 focus:border-emerald-600 focus:outline-none dark:text-slate-100 dark:hover:border-slate-700"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          aria-label="Remove item"
                          className="col-span-1 flex h-9 w-full items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Notes & Currency */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5 dark:text-slate-400">
                    Notes
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional memo or tax reference"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5 dark:text-slate-400">
                    Currency
                  </label>
                  <input
                    type="text"
                    maxLength={3}
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    className="font-mono-num w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm uppercase text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900/90">
          <div>
            {isEditingExisting && draft.id && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(draft.id!)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/60"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="review-expense-form"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-emerald-700"
            >
              <Check className="h-4 w-4" />
              Save Expense
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
