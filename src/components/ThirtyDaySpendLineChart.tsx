import React, { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Expense } from '../types/expense';
import { formatCurrency } from '../utils/storage';
import { useTheme } from '../hooks/useTheme';

interface ThirtyDaySpendLineChartProps {
  expenses: Expense[];
}

interface DailyPoint {
  date: string;
  shortLabel: string;
  fullLabel: string;
  total: number;
  count: number;
}

interface LineTooltipPayloadItem {
  payload?: DailyPoint;
  value?: number;
}

interface LineTooltipProps {
  active?: boolean;
  payload?: LineTooltipPayloadItem[];
}

function formatDateFromUtcParts(year: number, monthIndex: number, day: number, style: 'short' | 'full'): string {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (style === 'short') {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const DailyLineTooltip: React.FC<LineTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="min-w-[180px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <p className="border-b border-slate-100 pb-2 font-display text-xs font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
        {point.fullLabel}
      </p>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400">Daily Spend</span>
          <span className="font-mono-num font-semibold text-slate-900 dark:text-slate-100">
            {formatCurrency(point.total)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400">Receipts</span>
          <span className="font-mono-num text-slate-600 dark:text-slate-300">
            {point.count} {point.count === 1 ? 'receipt' : 'receipts'}
          </span>
        </div>
      </div>
    </div>
  );
};

export const ThirtyDaySpendLineChart: React.FC<ThirtyDaySpendLineChartProps> = ({
  expenses,
}) => {
  const { isDark } = useTheme();

  const { chartData, totalSpend, dailyAverage, peakPoint, hasSpendInWindow, rangeLabel } =
    useMemo(() => {
      const byDate = new Map<string, { total: number; count: number }>();
      expenses.forEach((exp) => {
        const current = byDate.get(exp.date);
        if (current) {
          current.total += exp.total;
          current.count += 1;
        } else {
          byDate.set(exp.date, { total: exp.total, count: 1 });
        }
      });

      const now = new Date();
      const baseYear = now.getUTCFullYear();
      const baseMonth = now.getUTCMonth();
      const baseDay = now.getUTCDate();

      const points: DailyPoint[] = [];
      for (let offset = 29; offset >= 0; offset -= 1) {
        const d = new Date(Date.UTC(baseYear, baseMonth, baseDay - offset));
        const dateKey = d.toISOString().slice(0, 10);
        const bucket = byDate.get(dateKey);
        points.push({
          date: dateKey,
          shortLabel: formatDateFromUtcParts(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            'short'
          ),
          fullLabel: formatDateFromUtcParts(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            'full'
          ),
          total: bucket ? Number(bucket.total.toFixed(2)) : 0,
          count: bucket ? bucket.count : 0,
        });
      }

      const sum = points.reduce((acc, p) => acc + p.total, 0);
      const avg = sum / 30;
      const peak = points.reduce<DailyPoint | null>(
        (best, cur) => (cur.total > (best?.total ?? 0) ? cur : best),
        null
      );

      return {
        chartData: points,
        totalSpend: sum,
        dailyAverage: avg,
        peakPoint: peak,
        hasSpendInWindow: sum > 0,
        rangeLabel: `${points[0]?.shortLabel ?? ''} – ${points[points.length - 1]?.shortLabel ?? ''}`,
      };
    }, [expenses]);

  const gridColor = isDark ? '#1E293B' : '#E2E8F0';
  const tickColor = isDark ? '#94A3B8' : '#64748B';
  const lineColor = isDark ? '#34D399' : '#059669';
  const avgLineColor = isDark ? '#475569' : '#94A3B8';
  const dotStroke = isDark ? '#0F172A' : '#FFFFFF';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Last 30 Days Spending Trend
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{rangeLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num font-medium text-slate-800 dark:text-slate-200">
              {formatCurrency(totalSpend)} total
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-num">
              {formatCurrency(dailyAverage)}/day avg
            </span>
          </div>
        </div>

        {peakPoint && peakPoint.total > 0 && (
          <div className="text-xs text-slate-500 sm:text-right dark:text-slate-400">
            <span>Peak day</span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono-num font-medium text-slate-800 dark:text-slate-200">
              {formatCurrency(peakPoint.total)}
            </span>
            <span> on {peakPoint.shortLabel}</span>
          </div>
        )}
      </div>

      {!hasSpendInWindow ? (
        <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
          No expenses recorded in the last 30 days.
        </div>
      ) : (
        <div className="mt-5 h-[240px] w-full min-w-0" data-testid="thirty-day-line-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
              <XAxis
                dataKey="shortLabel"
                tick={{ fill: tickColor, fontSize: 11 }}
                axisLine={{ stroke: gridColor }}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                width={54}
                tick={{ fill: tickColor, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => (v >= 1000 ? `RM ${(v / 1000).toFixed(1)}k` : `RM ${v}`)}
              />
              <Tooltip
                content={<DailyLineTooltip />}
                cursor={{ stroke: avgLineColor, strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              {dailyAverage > 0 && (
                <ReferenceLine
                  y={dailyAverage}
                  stroke={avgLineColor}
                  strokeDasharray="4 4"
                />
              )}
              <Line
                type="monotone"
                dataKey="total"
                name="Daily Spend"
                stroke={lineColor}
                strokeWidth={2.5}
                dot={{ r: 2.5, fill: lineColor, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: lineColor, stroke: dotStroke, strokeWidth: 2 }}
                animationDuration={350}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
};
