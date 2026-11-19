export const EXPENSE_CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Utilities',
  'Transport',
  'Shopping',
  'Healthcare',
  'Entertainment',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface LineItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

export type ReceiptImageStatus = 'saved' | 'not_retained' | 'removed_quota';

export type ImageRetentionMode = 'keep_images' | 'details_only';

export interface Expense {
  id: string;
  merchant: string;
  date: string; // YYYY-MM-DD
  currency: string;
  category: ExpenseCategory;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
  notes: string;
  items: LineItem[];
  receiptImage?: string;
  receiptImageStatus?: ReceiptImageStatus;
  ocrConfidence?: 'high' | 'medium' | 'low';
  createdAt: string;
  updatedAt: string;
}

export interface ScannedReceiptDraft {
  id?: string;
  merchant: string;
  date: string;
  currency: string;
  category: ExpenseCategory;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
  notes: string;
  items: LineItem[];
  receiptImage?: string;
  receiptImageStatus?: ReceiptImageStatus;
  ocrConfidence?: 'high' | 'medium' | 'low';
}

export interface QueuedReceiptScan {
  id: string;
  imageDataUrl: string;
  mimeType: string;
  capturedAt: string;
}

export interface BudgetSettings {
  defaultMonthlyLimit: number | null;
  monthlyOverrides: Record<string, number>;
}

export const CATEGORY_META: Record<
  ExpenseCategory,
  { color: string; bgClass: string; textClass: string; barHex: string }
> = {
  'Food & Dining': {
    color: '#059669',
    bgClass: 'bg-emerald-50',
    textClass: 'text-emerald-700',
    barHex: '#059669',
  },
  Groceries: {
    color: '#0D9488',
    bgClass: 'bg-teal-50',
    textClass: 'text-teal-700',
    barHex: '#0D9488',
  },
  Utilities: {
    color: '#0284C7',
    bgClass: 'bg-sky-50',
    textClass: 'text-sky-700',
    barHex: '#0284C7',
  },
  Transport: {
    color: '#D97706',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-700',
    barHex: '#D97706',
  },
  Shopping: {
    color: '#4F46E5',
    bgClass: 'bg-indigo-50',
    textClass: 'text-indigo-700',
    barHex: '#4F46E5',
  },
  Healthcare: {
    color: '#DC2626',
    bgClass: 'bg-rose-50',
    textClass: 'text-rose-700',
    barHex: '#DC2626',
  },
  Entertainment: {
    color: '#7C3AED',
    bgClass: 'bg-violet-50',
    textClass: 'text-violet-700',
    barHex: '#7C3AED',
  },
  Other: {
    color: '#475569',
    bgClass: 'bg-slate-100',
    textClass: 'text-slate-700',
    barHex: '#475569',
  },
};
