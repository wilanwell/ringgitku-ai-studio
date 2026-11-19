import React, { useState } from 'react';
import { X, Check, Trash2, SlidersHorizontal } from 'lucide-react';
import { BudgetSettings } from '../types/expense';
import {
  formatCurrency,
  formatMonthLabel,
  getEffectiveBudgetForMonth,
} from '../utils/storage';

interface BudgetModalProps {
  isOpen: boolean;
  selectedMonth: string;
  currentMonthSpend: number;
  settings: BudgetSettings;
  onClose: () => void;
  onSave: (nextSettings: BudgetSettings) => void;
}

const PRESET_AMOUNTS = [500, 1000, 2000, 3500];

export const BudgetModal: React.FC<BudgetModalProps> = ({
  isOpen,
  selectedMonth,
  currentMonthSpend,
  settings,
  onClose,
  onSave,
}) => {
  const effective = getEffectiveBudgetForMonth(settings, selectedMonth);
  const [scope, setScope] = useState<'default' | 'month'>(
    effective.isOverride ? 'month' : 'default'
  );
  const [limitInput, setLimitInput] = useState<string>(
    effective.limit ? String(effective.limit) : ''
  );
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const parsedLimit = Number(limitInput);
  const hasValidPreview = !Number.isNaN(parsedLimit) && parsedLimit > 0;
  const previewPct = hasValidPreview ? (currentMonthSpend / parsedLimit) * 100 : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!limitInput.trim() || Number.isNaN(parsedLimit) || parsedLimit <= 0) {
      setError('Please enter a monthly limit greater than 0.');
      return;
    }

    const nextOverrides = { ...settings.monthlyOverrides };
    let nextDefault = settings.defaultMonthlyLimit;

    if (scope === 'month') {
      nextOverrides[selectedMonth] = parsedLimit;
    } else {
      nextDefault = parsedLimit;
      // Clear month-specific override if applying a new default across all months
      delete nextOverrides[selectedMonth];
    }

    onSave({
      defaultMonthlyLimit: nextDefault,
      monthlyOverrides: nextOverrides,
    });
  };

  const handleClearBudget = () => {
    const nextOverrides = { ...settings.monthlyOverrides };
    if (scope === 'month') {
      delete nextOverrides[selectedMonth];
      onSave({
        defaultMonthlyLimit: settings.defaultMonthlyLimit,
        monthlyOverrides: nextOverrides,
      });
    } else {
      delete nextOverrides[selectedMonth];
      onSave({
        defaultMonthlyLimit: null,
        monthlyOverrides: nextOverrides,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <SlidersHorizontal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                Monthly Budget
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Set a spending target to monitor monthly progress.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close budget settings"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form id="budget-settings-form" onSubmit={handleSubmit} className="space-y-5 overflow-y-auto p-5">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-200">
              {error}
            </div>
          )}

          {/* Scope selector */}
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Apply limit to
            </label>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setScope('default');
                  if (settings.defaultMonthlyLimit) {
                    setLimitInput(String(settings.defaultMonthlyLimit));
                  }
                }}
                className={`min-h-[40px] rounded-lg px-3 text-xs font-medium transition-colors truncate ${
                  scope === 'default'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                All Months (Default)
              </button>
              <button
                type="button"
                onClick={() => {
                  setScope('month');
                  const mOverride = settings.monthlyOverrides[selectedMonth];
                  if (mOverride) {
                    setLimitInput(String(mOverride));
                  }
                }}
                className={`min-h-[40px] rounded-lg px-3 text-xs font-medium transition-colors truncate ${
                  scope === 'month'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {formatMonthLabel(selectedMonth)}
              </button>
            </div>
          </div>

          {/* Amount input */}
          <div>
            <label htmlFor="monthly-budget-input" className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Spending Limit
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono-num text-sm font-medium text-slate-400 dark:text-slate-500">
                RM
              </span>
              <input
                id="monthly-budget-input"
                type="number"
                step="0.01"
                min="1"
                autoFocus
                value={limitInput}
                onChange={(e) => {
                  setLimitInput(e.target.value);
                  setError(null);
                }}
                placeholder="1500.00"
                className="font-mono-num min-h-[46px] w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-base font-semibold text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-500"
              />
            </div>

            <div className="mt-2.5 grid grid-cols-4 gap-2">
              {PRESET_AMOUNTS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setLimitInput(String(preset));
                    setError(null);
                  }}
                  className={`font-mono-num min-h-[36px] rounded-lg border text-xs font-medium transition-colors ${
                    Number(limitInput) === preset
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-emerald-500 dark:bg-emerald-600'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {formatCurrency(preset).replace('.00', '')}
                </button>
              ))}
            </div>
          </div>

          {/* Live Preview against selected month spend */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>{formatMonthLabel(selectedMonth)} spent</span>
              <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
                {formatCurrency(currentMonthSpend)}
              </span>
            </div>
            {hasValidPreview && (
              <>
                <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className={`h-full rounded-full transition-all ${
                      previewPct >= 100
                        ? 'bg-rose-600'
                        : previewPct >= 80
                          ? 'bg-amber-500'
                          : 'bg-emerald-600'
                    }`}
                    style={{ width: `${Math.min(previewPct, 100)}%` }}
                  />
                </div>
                <p className="font-mono-num mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {previewPct.toFixed(1)}% of {formatCurrency(parsedLimit)} limit
                </p>
              </>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900/90">
          <div>
            {(effective.limit !== null || (scope === 'default' && settings.defaultMonthlyLimit !== null)) && (
              <button
                type="button"
                onClick={handleClearBudget}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/60"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
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
              form="budget-settings-form"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-emerald-700"
            >
              <Check className="h-4 w-4" />
              Save Budget
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
