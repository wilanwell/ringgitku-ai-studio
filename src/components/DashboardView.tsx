import React, { useMemo, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Search,
  Download,
  FileSpreadsheet,
  FileText,
  Receipt,
  ChevronRight as DisclosureIcon,
  PenLine,
  SlidersHorizontal,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Calendar,
  X,
  ImageOff,
  HardDrive,
} from 'lucide-react';
import {
  CATEGORY_META,
  EXPENSE_CATEGORIES,
  Expense,
  ExpenseCategory,
  ImageRetentionMode,
} from '../types/expense';
import {
  formatCurrency,
  formatMonthLabel,
  formatStorageBytes,
  getLocalStorageUsageBytes,
  shiftMonth,
} from '../utils/storage';
import { exportExpensesToCSV, exportExpensesToPDF } from '../utils/export';
import { SixMonthTrendsChart } from './SixMonthTrendsChart';
import { CategorySpendPieChart } from './CategorySpendPieChart';
import { ThirtyDaySpendLineChart } from './ThirtyDaySpendLineChart';

interface DashboardViewProps {
  expenses: Expense[];
  selectedMonth: string;
  showAllMonths: boolean;
  monthlyBudget: number | null;
  isBudgetOverride: boolean;
  imageRetentionMode: ImageRetentionMode;
  onChangeImageRetentionMode: (mode: ImageRetentionMode) => void;
  onChangeMonth: (month: string) => void;
  onToggleAllMonths: (all: boolean) => void;
  onOpenCapture: () => void;
  onOpenManual: () => void;
  onOpenBudget: () => void;
  onSelectExpense: (expense: Expense) => void;
  activeTab: 'overview' | 'transactions' | 'export';
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  expenses,
  selectedMonth,
  showAllMonths,
  monthlyBudget,
  isBudgetOverride,
  imageRetentionMode,
  onChangeImageRetentionMode,
  onChangeMonth,
  onToggleAllMonths,
  onOpenCapture,
  onOpenManual,
  onOpenBudget,
  onSelectExpense,
  activeTab,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | 'All'>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [lastExportNotice, setLastExportNotice] = useState<{
    filename: string;
    count: number;
  } | null>(null);

  const hasCustomDateRange = Boolean(dateFrom || dateTo);
  const hasActiveFilters = Boolean(
    searchQuery.trim() || selectedCategory !== 'All' || dateFrom || dateTo
  );

  const periodExpenses = useMemo(() => {
    const base = showAllMonths
      ? expenses
      : expenses.filter((e) => e.date.startsWith(selectedMonth));
    return [...base].sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, selectedMonth, showAllMonths]);

  const filteredExpenses = useMemo(() => {
    // When user specifies a custom date range, search across all expenses so cross-month ranges work
    const source = hasCustomDateRange
      ? [...expenses].sort((a, b) => b.date.localeCompare(a.date))
      : periodExpenses;

    return source.filter((exp) => {
      const matchesCategory = selectedCategory === 'All' || exp.category === selectedCategory;
      const matchesFrom = !dateFrom || exp.date >= dateFrom;
      const matchesTo = !dateTo || exp.date <= dateTo;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        exp.merchant.toLowerCase().includes(q) ||
        exp.category.toLowerCase().includes(q) ||
        exp.notes.toLowerCase().includes(q) ||
        exp.items.some((item) => item.name.toLowerCase().includes(q));
      return matchesCategory && matchesFrom && matchesTo && matchesQuery;
    });
  }, [expenses, periodExpenses, hasCustomDateRange, selectedCategory, dateFrom, dateTo, searchQuery]);

  const filteredTotal = useMemo(
    () => filteredExpenses.reduce((sum, e) => sum + e.total, 0),
    [filteredExpenses]
  );

  const applyQuickDateRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setDateFrom(start.toISOString().slice(0, 10));
    setDateTo(end.toISOString().slice(0, 10));
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setDateFrom('');
    setDateTo('');
  };

  const totalSpend = useMemo(
    () => periodExpenses.reduce((sum, e) => sum + e.total, 0),
    [periodExpenses]
  );

  const avgSpend = periodExpenses.length > 0 ? totalSpend / periodExpenses.length : 0;

  const categoryBreakdown = useMemo(() => {
    return EXPENSE_CATEGORIES.map((cat) => {
      const catExpenses = periodExpenses.filter((e) => e.category === cat);
      const amount = catExpenses.reduce((sum, e) => sum + e.total, 0);
      return {
        category: cat,
        count: catExpenses.length,
        amount,
        percentage: totalSpend > 0 ? (amount / totalSpend) * 100 : 0,
        meta: CATEGORY_META[cat],
      };
    })
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [periodExpenses, totalSpend]);

  const topCategory = categoryBreakdown[0] ?? null;

  // Daily spend bars for selected month (or last 14 days when viewing all months)
  const dailyChartData = useMemo(() => {
    const byDate = new Map<string, number>();
    periodExpenses.forEach((exp) => {
      byDate.set(exp.date, (byDate.get(exp.date) || 0) + exp.total);
    });

    if (!showAllMonths) {
      const [yStr, mStr] = selectedMonth.split('-');
      const daysInMonth = new Date(Number(yStr), Number(mStr), 0).getDate();
      const points: { label: string; date: string; amount: number }[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dayStr = String(d).padStart(2, '0');
        const dateKey = `${selectedMonth}-${dayStr}`;
        points.push({
          label: d % 5 === 1 || d === daysInMonth ? String(d) : '',
          date: dateKey,
          amount: byDate.get(dateKey) || 0,
        });
      }
      return points;
    }

    const sortedDates = Array.from(byDate.keys()).sort().slice(-14);
    return sortedDates.map((dateKey) => ({
      label: dateKey.slice(5),
      date: dateKey,
      amount: byDate.get(dateKey) || 0,
    }));
  }, [periodExpenses, selectedMonth, showAllMonths]);

  const maxDailySpend = Math.max(...dailyChartData.map((d) => d.amount), 1);

  const periodLabel = hasCustomDateRange
    ? `${dateFrom || 'Start'} to ${dateTo || 'Today'}`
    : showAllMonths
      ? 'All Recorded Months'
      : formatMonthLabel(selectedMonth);

  const fileSlug = useMemo(() => {
    const base = hasCustomDateRange
      ? `ringgitku-${dateFrom || 'start'}-to-${dateTo || 'today'}`
      : showAllMonths
        ? 'ringgitku-all-expenses'
        : `ringgitku-${selectedMonth}`;
    const catPart =
      selectedCategory !== 'All'
        ? `-${selectedCategory.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
        : '';
    const queryPart = searchQuery.trim() ? '-filtered' : '';
    return `${base}${catPart}${queryPart}`;
  }, [hasCustomDateRange, dateFrom, dateTo, showAllMonths, selectedMonth, selectedCategory, searchQuery]);

  const handleDownloadCsv = () => {
    if (filteredExpenses.length === 0) return;
    const filename = exportExpensesToCSV(filteredExpenses, fileSlug);
    setLastExportNotice({ filename, count: filteredExpenses.length });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 pb-24 sm:px-6 md:pb-12">
      {/* Period Selector & Quick Export */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => {
                onToggleAllMonths(false);
                onChangeMonth(shiftMonth(selectedMonth, -1));
              }}
              aria-label="Previous month"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[144px] px-3 text-center font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {showAllMonths ? 'All Months' : formatMonthLabel(selectedMonth)}
            </span>
            <button
              type="button"
              onClick={() => {
                onToggleAllMonths(false);
                onChangeMonth(shiftMonth(selectedMonth, 1));
              }}
              aria-label="Next month"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => onToggleAllMonths(false)}
              className={`min-h-[36px] rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                !showAllMonths
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => onToggleAllMonths(true)}
              className={`min-h-[36px] rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                showAllMonths
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              All Time
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenBudget}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            {monthlyBudget ? `Budget: ${formatCurrency(monthlyBudget)}` : 'Set Budget'}
          </button>

          {periodExpenses.length > 0 && activeTab !== 'export' && (
            <div className="hidden items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => exportExpensesToPDF(filteredExpenses, periodLabel, fileSlug)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FileText className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
                Export PDF
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Export Tab Dedicated View */}
      {activeTab === 'export' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-slate-100">
                Export Expense Records
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Download {filteredExpenses.length}{' '}
                {filteredExpenses.length === 1 ? 'transaction' : 'transactions'} totaling{' '}
                <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                  {formatCurrency(filteredTotal)}
                </span>{' '}
                for {periodLabel}
                {selectedCategory !== 'All' ? ` (${selectedCategory})` : ''}
                {searchQuery.trim() ? ` matching “${searchQuery.trim()}”` : ''}.
              </p>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                CSV includes Date, Merchant, Category, Subtotal, Tax, Total, Currency, Payment Method, Line Items, and Notes for the filtered rows below.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={filteredExpenses.length === 0}
                onClick={handleDownloadCsv}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Download className="h-4 w-4" />
                Download CSV
              </button>
              <button
                type="button"
                disabled={filteredExpenses.length === 0}
                onClick={() => exportExpensesToPDF(filteredExpenses, periodLabel, fileSlug)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Download PDF Report
              </button>
            </div>
          </div>

          {lastExportNotice && (
            <div
              role="status"
              className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-xs text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-200"
            >
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="truncate">
                  Downloaded <span className="font-mono-num font-semibold">{lastExportNotice.filename}</span> ({lastExportNotice.count}{' '}
                  {lastExportNotice.count === 1 ? 'record' : 'records'}).
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLastExportNotice(null)}
                aria-label="Dismiss export notice"
                className="shrink-0 rounded-md p-1 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Receipt Photo Retention & Storage Separation */}
          <div className="mt-5 flex flex-col justify-between gap-4 border-t border-slate-200 pt-5 sm:flex-row sm:items-center dark:border-slate-800">
            <div className="flex items-start gap-2.5">
              <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
              <div className="text-xs text-slate-600 dark:text-slate-400">
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  Transaction records & receipt photo storage
                </p>
                <p className="mt-0.5">
                  Ledger usage: <span className="font-mono-num font-medium">{formatStorageBytes(getLocalStorageUsageBytes())}</span>
                  {' · '}
                  <span className="font-mono-num">{expenses.filter((e) => Boolean(e.receiptImage)).length}</span> photos saved
                  {expenses.some((e) => e.receiptImageStatus === 'removed_quota') && (
                    <>
                      {' · '}
                      <span className="font-medium text-amber-700 dark:text-amber-400">
                        {expenses.filter((e) => e.receiptImageStatus === 'removed_quota').length} removed by quota
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center self-start rounded-xl bg-slate-100 p-1 sm:self-auto dark:bg-slate-800">
              <button
                type="button"
                onClick={() => onChangeImageRetentionMode('keep_images')}
                className={`min-h-[34px] rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  imageRetentionMode === 'keep_images'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                Keep Photos
              </button>
              <button
                type="button"
                onClick={() => onChangeImageRetentionMode('details_only')}
                className={`min-h-[34px] rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  imageRetentionMode === 'details_only'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                Details Only
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Empty State when no expenses exist at all */}
      {expenses.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <Receipt className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-slate-900 text-balance dark:text-slate-100">
            Track expenses straight from your receipts
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Snap a photo or upload a receipt to extract the merchant, date, category, and line items automatically. Everything saves offline on your device.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onOpenCapture}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-emerald-600 px-6 text-sm font-medium text-white shadow-xs transition-colors hover:bg-emerald-700"
            >
              <Camera className="h-4 w-4" />
              Scan First Receipt
            </button>
            <button
              type="button"
              onClick={onOpenManual}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <PenLine className="h-4 w-4" />
              Add Manual Expense
            </button>
          </div>
        </section>
      ) : (
        <>
          {/* KPI Strip */}
          {activeTab !== 'transactions' && (
            <section className="grid grid-cols-2 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              <div className="p-5">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Spend</p>
                <p className="font-mono-num mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
                  {formatCurrency(totalSpend)}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{periodLabel}</p>
              </div>
              <div className="border-l border-slate-200 p-5 sm:border-l-0 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Receipts</p>
                <p className="font-mono-num mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
                  {periodExpenses.length}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Logged transactions</p>
              </div>
              <div className="p-5">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Average Receipt</p>
                <p className="font-mono-num mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">
                  {formatCurrency(avgSpend)}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Per transaction</p>
              </div>
              <div className="border-l border-slate-200 p-5 sm:border-l-0 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Top Category</p>
                <p className="mt-2 truncate font-display text-lg font-semibold text-slate-900 sm:text-xl dark:text-slate-100">
                  {topCategory ? topCategory.category : '—'}
                </p>
                <p className="font-mono-num mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {topCategory ? `${topCategory.percentage.toFixed(0)}% of spend` : 'No data in period'}
                </p>
              </div>
            </section>
          )}

          {/* Monthly Budget Progress Bar */}
          {!showAllMonths && activeTab === 'overview' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              {monthlyBudget && monthlyBudget > 0 ? (
                (() => {
                  const pctConsumed = (totalSpend / monthlyBudget) * 100;
                  const barWidth = Math.min(pctConsumed, 100);
                  const remaining = monthlyBudget - totalSpend;
                  const isOver = pctConsumed >= 100;
                  const isWarning = !isOver && pctConsumed >= 80;

                  return (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                              Monthly Budget
                            </h2>
                            <span aria-hidden="true">·</span>
                            <span>{formatMonthLabel(selectedMonth)}</span>
                            {isBudgetOverride && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>Custom month limit</span>
                              </>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                            <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                              {formatCurrency(totalSpend)}
                            </span>{' '}
                            spent of{' '}
                            <span className="font-mono-num font-medium text-slate-800 dark:text-slate-200">
                              {formatCurrency(monthlyBudget)}
                            </span>
                          </p>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="font-mono-num text-lg font-semibold text-slate-900 dark:text-slate-100">
                              {pctConsumed.toFixed(1)}%
                            </p>
                            <div className="flex items-center justify-end gap-1.5 text-xs font-medium">
                              {isOver ? (
                                <>
                                  <AlertCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                                  <span className="text-rose-700 dark:text-rose-400">
                                    Over by {formatCurrency(Math.abs(remaining))}
                                  </span>
                                </>
                              ) : isWarning ? (
                                <>
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                  <span className="text-amber-700 dark:text-amber-400">
                                    Approaching limit · {formatCurrency(remaining)} left
                                  </span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                  <span className="text-emerald-700 dark:text-emerald-400">
                                    On track · {formatCurrency(remaining)} left
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={onOpenBudget}
                            className="min-h-[38px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            Edit
                          </button>
                        </div>
                      </div>

                      <div
                        role="progressbar"
                        aria-valuenow={Math.round(pctConsumed)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Monthly budget consumed"
                        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                      >
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isOver
                              ? 'bg-rose-600'
                              : isWarning
                                ? 'bg-amber-500'
                                : 'bg-emerald-600'
                          }`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                      Monthly Budget
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Define a spending limit for {formatMonthLabel(selectedMonth)} to track how much of your budget is consumed.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenBudget}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Set Monthly Limit
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Breakdown & Trend Charts (Overview Tab) */}
          {activeTab === 'overview' && (
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Category Breakdown */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                      Spend by Category
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{periodLabel}</p>
                  </div>
                  {selectedCategory !== 'All' && (
                    <button
                      type="button"
                      onClick={() => setSelectedCategory('All')}
                      className="text-xs font-medium text-emerald-700 hover:underline whitespace-nowrap shrink-0 dark:text-emerald-400"
                    >
                      Clear filter
                    </button>
                  )}
                </div>

                {categoryBreakdown.length === 0 ? (
                  <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    No expenses recorded for {periodLabel}.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    <CategorySpendPieChart
                      data={categoryBreakdown}
                      totalSpend={totalSpend}
                      selectedCategory={selectedCategory}
                      onSelectCategory={(cat) =>
                        setSelectedCategory((cur) => (cur === cat ? 'All' : cat))
                      }
                    />

                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {categoryBreakdown.map((entry) => {
                        const isSelected = selectedCategory === entry.category;
                        return (
                          <button
                            key={entry.category}
                            type="button"
                            onClick={() =>
                              setSelectedCategory((cur) =>
                                cur === entry.category ? 'All' : entry.category
                              )
                            }
                            className={`flex min-h-[44px] w-full items-center justify-between gap-3 py-2 text-left transition-colors ${
                              isSelected
                                ? 'bg-slate-50 px-2 -mx-2 rounded-lg dark:bg-slate-800/80'
                                : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-xs"
                                  style={{ backgroundColor: entry.meta.barHex }}
                                />
                                <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                                  {entry.category}
                                </span>
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                  {entry.count}
                                </span>
                              </div>
                              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.max(entry.percentage, 3)}%`,
                                    backgroundColor: entry.meta.barHex,
                                  }}
                                />
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="font-mono-num text-sm font-medium text-slate-900 dark:text-slate-100">
                                {formatCurrency(entry.amount)}
                              </p>
                              <p className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                                {entry.percentage.toFixed(1)}%
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Daily Spending Trend */}
              <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                      Daily Spending Pace
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{periodLabel}</p>
                  </div>
                  <span className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                    Peak: {formatCurrency(Math.max(...dailyChartData.map((d) => d.amount), 0))}
                  </span>
                </div>

                {periodExpenses.length === 0 ? (
                  <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
                    Add receipts to visualize daily spend trends.
                  </p>
                ) : (
                  <div className="mt-6">
                    <div className="flex h-48 items-end gap-1 border-b border-slate-200 pb-2 dark:border-slate-800">
                      {dailyChartData.map((bar) => {
                        const heightPct = bar.amount > 0 ? Math.max((bar.amount / maxDailySpend) * 100, 6) : 0;
                        return (
                          <div
                            key={bar.date}
                            title={`${bar.date}: ${formatCurrency(bar.amount)}`}
                            className="group relative flex h-full flex-1 flex-col justify-end"
                          >
                            <div
                              className={`w-full rounded-t-sm transition-colors ${
                                bar.amount > 0
                                  ? 'bg-slate-900 group-hover:bg-emerald-600 dark:bg-emerald-500/85 dark:group-hover:bg-emerald-400'
                                  : 'bg-slate-100 h-[2px] dark:bg-slate-800'
                              }`}
                              style={bar.amount > 0 ? { height: `${heightPct}%` } : undefined}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono-num dark:text-slate-500">
                      {dailyChartData.map((bar, idx) => (
                        <span key={bar.date} className="flex-1 text-center">
                          {bar.label || (idx === 0 ? bar.date.slice(8) : '')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Last 30 Days Daily Spending Trend Line Chart (Recharts) */}
          {activeTab === 'overview' && (
            <ThirtyDaySpendLineChart expenses={expenses} />
          )}

          {/* 6-Month Category Spending Trends (Recharts) */}
          {activeTab === 'overview' && (
            <SixMonthTrendsChart
              expenses={expenses}
              anchorMonth={showAllMonths ? new Date().toISOString().slice(0, 7) : selectedMonth}
            />
          )}

          {/* Transactions Ledger */}
          <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="space-y-4 border-b border-slate-200 p-5 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                    Transactions
                  </h2>
                  <p className="font-mono-num mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {filteredExpenses.length} {filteredExpenses.length === 1 ? 'record' : 'records'}
                    {hasCustomDateRange ? ` (${dateFrom || '...'} to ${dateTo || '...'})` : ''}
                    {' · '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(filteredTotal)}</span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applyQuickDateRange(7)}
                    className="min-h-[36px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Last 7 days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickDateRange(30)}
                    className="min-h-[36px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Last 30 days
                  </button>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-rose-400 dark:hover:bg-rose-950/60"
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear filters
                    </button>
                  )}
                </div>
              </div>

              {/* Search Bar + Category + Date Range Filters */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-12">
                {/* Merchant / Keyword Search */}
                <div className="relative sm:col-span-2 lg:col-span-5">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search merchant, item, or notes..."
                    aria-label="Search expenses by merchant name or item"
                    className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500 dark:focus:bg-slate-800"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search query"
                      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Category Select */}
                <div className="lg:col-span-3">
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value as ExpenseCategory | 'All')}
                    aria-label="Filter by category"
                    className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-emerald-500"
                  >
                    <option value="All">All Categories</option>
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Range: From & To */}
                <div className="grid grid-cols-2 gap-2 sm:col-span-1 lg:col-span-4">
                  <div className="relative">
                    <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                    <input
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={(e) => setDateFrom(e.target.value)}
                      aria-label="Start date"
                      title="Start date"
                      className="font-mono-num min-h-[42px] w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-700 focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-emerald-500"
                    />
                  </div>
                  <div className="relative">
                    <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                    <input
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={(e) => setDateTo(e.target.value)}
                      aria-label="End date"
                      title="End date"
                      className="font-mono-num min-h-[42px] w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-700 focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Quick Interactive Category Filter Bar on Transactions Tab */}
              {activeTab === 'transactions' && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('All')}
                    className={`min-h-[34px] rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      selectedCategory === 'All'
                        ? 'bg-slate-900 text-white dark:bg-emerald-600'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
                    }`}
                  >
                    All
                  </button>
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory((cur) => (cur === cat ? 'All' : cat))}
                      className={`min-h-[34px] rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        selectedCategory === cat
                          ? 'bg-slate-900 text-white dark:bg-emerald-600'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {filteredExpenses.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  No matching transactions
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Try adjusting your search or filter criteria, or scan a new receipt.
                </p>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="mt-4 inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Mobile Touch List */}
                <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
                  {filteredExpenses.map((exp) => (
                    <button
                      key={exp.id}
                      type="button"
                      onClick={() => onSelectExpense(exp)}
                      className="flex min-h-[68px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors active:bg-slate-50 dark:active:bg-slate-800/70"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {exp.receiptImage ? (
                            <img
                              src={exp.receiptImage}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="h-full w-full rounded-xl object-cover"
                            />
                          ) : exp.receiptImageStatus === 'removed_quota' ? (
                            <span
                              title="Receipt image removed due to storage limit"
                              aria-label="Receipt image removed due to storage limit"
                              className="flex h-full w-full items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400"
                            >
                              <ImageOff className="h-4 w-4" />
                            </span>
                          ) : (
                            <Receipt className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {exp.merchant}
                          </p>
                          <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
                            <span>{exp.category}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-num">{exp.date}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="font-mono-num text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {formatCurrency(exp.total, exp.currency)}
                        </span>
                        <DisclosureIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                      </div>
                    </button>
                  ))}
                </div>

                {/* Desktop High-Density Table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                        <th className="py-3 pl-5 pr-3">Date</th>
                        <th className="px-3 py-3">Merchant</th>
                        <th className="px-3 py-3">Category</th>
                        <th className="px-3 py-3">Items</th>
                        <th className="px-3 py-3">Payment</th>
                        <th className="py-3 pl-3 pr-5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                      {filteredExpenses.map((exp) => (
                        <tr
                          key={exp.id}
                          onClick={() => onSelectExpense(exp)}
                          className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <td className="font-mono-num whitespace-nowrap py-3.5 pl-5 pr-3 text-xs text-slate-600 dark:text-slate-400">
                            {exp.date}
                          </td>
                          <td className="px-3 py-3.5">
                            <div className="flex items-center gap-3">
                              {exp.receiptImage ? (
                                <img
                                  src={exp.receiptImage}
                                  alt=""
                                  referrerPolicy="no-referrer"
                                  className="h-8 w-8 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                                />
                              ) : exp.receiptImageStatus === 'removed_quota' ? (
                                <div
                                  title="Receipt image removed due to storage limit"
                                  aria-label="Receipt image removed due to storage limit"
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-400"
                                >
                                  <ImageOff className="h-3.5 w-3.5" />
                                </div>
                              ) : (
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500">
                                  <Receipt className="h-3.5 w-3.5" />
                                </div>
                              )}
                              <span className="font-medium text-slate-900 dark:text-slate-100">{exp.merchant}</span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-xs text-slate-600 dark:text-slate-400">
                            {exp.category}
                          </td>
                          <td className="font-mono-num whitespace-nowrap px-3 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                            {exp.items.length > 0 ? `${exp.items.length} items` : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                            {exp.paymentMethod || '—'}
                          </td>
                          <td className="font-mono-num whitespace-nowrap py-3.5 pl-3 pr-5 text-right font-semibold text-slate-900 dark:text-slate-100">
                            {formatCurrency(exp.total, exp.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
};
