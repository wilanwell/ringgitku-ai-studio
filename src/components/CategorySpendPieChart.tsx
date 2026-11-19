import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ExpenseCategory } from '../types/expense';
import { formatCurrency } from '../utils/storage';
import { useTheme } from '../hooks/useTheme';

export interface CategoryBreakdownItem {
  category: ExpenseCategory;
  count: number;
  amount: number;
  percentage: number;
  meta: {
    color: string;
    bgClass: string;
    textClass: string;
    barHex: string;
  };
}

interface CategorySpendPieChartProps {
  data: CategoryBreakdownItem[];
  totalSpend: number;
  selectedCategory: ExpenseCategory | 'All';
  onSelectCategory: (category: ExpenseCategory) => void;
}

interface PieTooltipPayloadItem {
  payload?: CategoryBreakdownItem;
}

interface PieTooltipProps {
  active?: boolean;
  payload?: PieTooltipPayloadItem[];
}

const CategoryPieTooltip: React.FC<PieTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const item = payload[0]?.payload;
  if (!item) {
    return null;
  }

  return (
    <div className="min-w-[176px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-xs"
          style={{ backgroundColor: item.meta.barHex }}
        />
        <span className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
          {item.category}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400">Spent</span>
          <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
            {formatCurrency(item.amount)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400">Share</span>
          <span className="font-mono-num font-medium text-slate-700 dark:text-slate-300">
            {item.percentage.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400">Receipts</span>
          <span className="font-mono-num text-slate-600 dark:text-slate-400">
            {item.count}
          </span>
        </div>
      </div>
    </div>
  );
};

export const CategorySpendPieChart: React.FC<CategorySpendPieChartProps> = ({
  data,
  totalSpend,
  selectedCategory,
  onSelectCategory,
}) => {
  const { isDark } = useTheme();
  const activeEntry =
    selectedCategory !== 'All'
      ? data.find((d) => d.category === selectedCategory) ?? null
      : data[0] ?? null;

  return (
    <div className="space-y-3">
      <div className="h-[220px] w-full min-w-0" data-testid="category-pie-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="category"
              cx="50%"
              cy="50%"
              innerRadius={0}
              outerRadius={86}
              paddingAngle={data.length > 1 ? 1.5 : 0}
              stroke={isDark ? '#0F172A' : '#FFFFFF'}
              strokeWidth={2}
              animationDuration={350}
              className="cursor-pointer outline-none"
              onClick={(_slice, index: number) => {
                const target = data[index];
                if (target) {
                  onSelectCategory(target.category);
                }
              }}
            >
              {data.map((entry) => {
                const isDimmed =
                  selectedCategory !== 'All' && selectedCategory !== entry.category;
                return (
                  <Cell
                    key={entry.category}
                    fill={entry.meta.barHex}
                    fillOpacity={isDimmed ? 0.3 : 1}
                  />
                );
              })}
            </Pie>
            <Tooltip content={<CategoryPieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {activeEntry && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {selectedCategory !== 'All' ? 'Selected category' : 'Leading share'}
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-xs"
                style={{ backgroundColor: activeEntry.meta.barHex }}
              />
              <span className="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                {activeEntry.category}
              </span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono-num text-sm font-semibold text-slate-900 dark:text-slate-100">
              {formatCurrency(activeEntry.amount)}
            </p>
            <p className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
              {activeEntry.percentage.toFixed(1)}% of {formatCurrency(totalSpend)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
