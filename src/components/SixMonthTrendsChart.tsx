import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CATEGORY_META,
  EXPENSE_CATEGORIES,
  Expense,
  ExpenseCategory,
} from '../types/expense';
import { formatCurrency, shiftMonth } from '../utils/storage';
import { useTheme } from '../hooks/useTheme';

interface SixMonthTrendsChartProps {
  expenses: Expense[];
  anchorMonth: string; // YYYY-MM
}

interface CustomTooltipPayloadItem {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: CustomTooltipPayloadItem[];
  label?: string;
}

function formatShortMonth(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (!year || !month) return yearMonth;
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

const TrendsTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const nonZero = [...payload]
    .filter((item) => (Number(item.value) || 0) > 0)
    .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));

  const monthTotal = nonZero.reduce((sum, item) => sum + (Number(item.value) || 0), 0);

  return (
    <div className="min-w-[196px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2 dark:border-slate-800">
        <span className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">{label}</span>
        <span className="font-mono-num text-xs font-semibold text-slate-900 dark:text-slate-100">
          {formatCurrency(monthTotal)}
        </span>
      </div>
      {nonZero.length === 0 ? (
        <p className="pt-2 text-xs text-slate-400">No expenses recorded</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {nonZero.map((entry) => (
            <div key={entry.dataKey || entry.name} className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="h-2 w-2 shrink-0 rounded-xs"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="truncate text-slate-600 dark:text-slate-300">{entry.name}</span>
              </div>
              <span className="font-mono-num shrink-0 font-medium text-slate-900 dark:text-slate-100">
                {formatCurrency(Number(entry.value) || 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const SixMonthTrendsChart: React.FC<SixMonthTrendsChartProps> = ({
  expenses,
  anchorMonth,
}) => {
  const { isDark } = useTheme();
  const [chartMode, setChartMode] = useState<'bar' | 'line'>('bar');
  const [hiddenCategories, setHiddenCategories] = useState<Set<ExpenseCategory>>(new Set());

  const sixMonths = useMemo(() => {
    const months: string[] = [];
    for (let offset = -5; offset <= 0; offset += 1) {
      months.push(shiftMonth(anchorMonth, offset));
    }
    return months;
  }, [anchorMonth]);

  const { chartData, activeCategories, sixMonthTotal, momDeltaPct } = useMemo(() => {
    const monthSet = new Set(sixMonths);
    const categoryTotals = new Map<ExpenseCategory, number>();
    EXPENSE_CATEGORIES.forEach((c) => categoryTotals.set(c, 0));

    const rows = sixMonths.map((ym) => {
      const row: Record<string, string | number> = {
        monthKey: ym,
        monthLabel: formatShortMonth(ym),
      };
      EXPENSE_CATEGORIES.forEach((cat) => {
        row[cat] = 0;
      });
      return row;
    });

    const rowMap = new Map<string, Record<string, string | number>>();
    rows.forEach((r) => rowMap.set(String(r.monthKey), r));

    expenses.forEach((exp) => {
      const ym = exp.date.slice(0, 7);
      if (!monthSet.has(ym)) return;
      const targetRow = rowMap.get(ym);
      if (!targetRow) return;
      targetRow[exp.category] = Number(targetRow[exp.category] || 0) + exp.total;
      categoryTotals.set(exp.category, (categoryTotals.get(exp.category) || 0) + exp.total);
    });

    const usedCategories = EXPENSE_CATEGORIES.filter(
      (cat) => (categoryTotals.get(cat) || 0) > 0
    );

    const visibleForTotals = usedCategories.length > 0 ? usedCategories : [...EXPENSE_CATEGORIES];
    const monthlySums = rows.map((r) =>
      visibleForTotals.reduce(
        (sum, cat) => sum + (hiddenCategories.has(cat) ? 0 : Number(r[cat] || 0)),
        0
      )
    );

    const total = monthlySums.reduce((s, v) => s + v, 0);
    const currentVal = monthlySums[monthlySums.length - 1] || 0;
    const prevVal = monthlySums[monthlySums.length - 2] || 0;
    const delta = prevVal > 0 ? ((currentVal - prevVal) / prevVal) * 100 : null;

    return {
      chartData: rows,
      activeCategories: usedCategories,
      sixMonthTotal: total,
      momDeltaPct: delta,
    };
  }, [expenses, sixMonths, hiddenCategories]);

  const toggleCategory = (cat: ExpenseCategory) => {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const visibleCategories = activeCategories.filter((cat) => !hiddenCategories.has(cat));

  const gridColor = isDark ? '#1E293B' : '#E2E8F0';
  const tickColor = isDark ? '#94A3B8' : '#64748B';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            6-Month Category Trends
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              {formatShortMonth(sixMonths[0])} – {formatShortMonth(sixMonths[5])}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num font-medium text-slate-800 dark:text-slate-200">
              {formatCurrency(sixMonthTotal)} total
            </span>
            {momDeltaPct !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`font-mono-num font-medium ${
                    momDeltaPct > 0
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {momDeltaPct > 0 ? '+' : ''}
                  {momDeltaPct.toFixed(1)}% vs prior month
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center self-start rounded-xl bg-slate-100 p-1 sm:self-auto dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setChartMode('bar')}
            className={`min-h-[34px] rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              chartMode === 'bar'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Stacked Bars
          </button>
          <button
            type="button"
            onClick={() => setChartMode('line')}
            className={`min-h-[34px] rounded-lg px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              chartMode === 'line'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Trend Lines
          </button>
        </div>
      </div>

      {activeCategories.length === 0 ? (
        <div className="py-14 text-center text-sm text-slate-500 dark:text-slate-400">
          No expenses recorded in this 6-month window yet.
        </div>
      ) : (
        <>
          <div className="mt-5 h-[280px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === 'bar' ? (
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                  <XAxis
                    dataKey="monthLabel"
                    tick={{ fill: tickColor, fontSize: 12 }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={false}
                  />
                  <YAxis
                    width={54}
                    tick={{ fill: tickColor, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => (v >= 1000 ? `RM ${(v / 1000).toFixed(1)}k` : `RM ${v}`)}
                  />
                  <Tooltip
                    content={<TrendsTooltip />}
                    cursor={{ fill: isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.04)' }}
                  />
                  {visibleCategories.map((cat, idx) => (
                    <Bar
                      key={cat}
                      dataKey={cat}
                      name={cat}
                      stackId="monthly"
                      fill={CATEGORY_META[cat].barHex}
                      radius={idx === visibleCategories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      maxBarSize={48}
                    />
                  ))}
                </BarChart>
              ) : (
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                  <XAxis
                    dataKey="monthLabel"
                    tick={{ fill: tickColor, fontSize: 12 }}
                    axisLine={{ stroke: gridColor }}
                    tickLine={false}
                  />
                  <YAxis
                    width={54}
                    tick={{ fill: tickColor, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => (v >= 1000 ? `RM ${(v / 1000).toFixed(1)}k` : `RM ${v}`)}
                  />
                  <Tooltip content={<TrendsTooltip />} />
                  {visibleCategories.map((cat) => (
                    <Area
                      key={cat}
                      type="monotone"
                      dataKey={cat}
                      name={cat}
                      stroke={CATEGORY_META[cat].barHex}
                      fill={CATEGORY_META[cat].barHex}
                      fillOpacity={0.14}
                      strokeWidth={2}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Interactive Category Visibility Toggles */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            {activeCategories.map((cat) => {
              const hidden = hiddenCategories.has(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  aria-pressed={!hidden}
                  className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    hidden
                      ? 'border-slate-200 bg-slate-50 text-slate-400 line-through dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-500'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-xs"
                    style={{
                      backgroundColor: hidden ? (isDark ? '#475569' : '#CBD5E1') : CATEGORY_META[cat].barHex,
                    }}
                  />
                  {cat}
                </button>
              );
            })}
            {hiddenCategories.size > 0 && (
              <button
                type="button"
                onClick={() => setHiddenCategories(new Set())}
                className="ml-auto text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
              >
                Show all
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
