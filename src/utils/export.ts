import { jsPDF } from 'jspdf';
import { Expense, EXPENSE_CATEGORIES } from '../types/expense';
import { formatCurrency } from './storage';

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildExpensesCsv(expenses: Expense[]): string {
  const headers = [
    'Date',
    'Merchant',
    'Category',
    'Subtotal',
    'Tax',
    'Total',
    'Currency',
    'Payment Method',
    'Line Items',
    'Notes',
  ];

  const rows = expenses.map((exp) => {
    const lineSummary = (exp.items || [])
      .map((item) => `${item.quantity}x ${item.name} (${item.price.toFixed(2)})`)
      .join('; ');

    return [
      escapeCsvCell(exp.date),
      escapeCsvCell(exp.merchant),
      escapeCsvCell(exp.category),
      escapeCsvCell(exp.subtotal.toFixed(2)),
      escapeCsvCell(exp.tax.toFixed(2)),
      escapeCsvCell(exp.total.toFixed(2)),
      escapeCsvCell(exp.currency || 'MYR'),
      escapeCsvCell(exp.paymentMethod || ''),
      escapeCsvCell(lineSummary),
      escapeCsvCell(exp.notes || ''),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

export function exportExpensesToCSV(expenses: Expense[], filenamePrefix: string): string {
  const csvContent = `\uFEFF${buildExpensesCsv(expenses)}`;
  const filename = `${filenamePrefix}.csv`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export function downloadReceiptImage(dataUrl: string, filenameBase: string): string {
  const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
  const mimeType = mimeMatch?.[1] || 'image/jpeg';
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const safeBase =
    filenameBase
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-|-$/g, '') || 'receipt';
  const filename = `${safeBase}.${ext}`;

  const link = document.createElement('a');
  link.download = filename;
  link.style.display = 'none';

  let objectUrl: string | null = null;
  try {
    const base64Part = dataUrl.split(',')[1];
    if (base64Part) {
      const binary = atob(base64Part);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });
      objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
    } else {
      link.href = dataUrl;
    }
  } catch {
    link.href = dataUrl;
  }

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (objectUrl) {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl!), 1000);
  }
  return filename;
}

export function exportExpensesToPDF(
  expenses: Expense[],
  periodLabel: string,
  filenamePrefix: string
): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  let y = 52;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text('RinggitKu Expense Report', margin, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Period: ${periodLabel}   |   Generated: ${new Date().toLocaleDateString('en-US')}`, margin, y + 18);

  y += 38;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageWidth - margin, y);
  y += 22;

  // Summary Stats
  const totalSpend = expenses.reduce((sum, e) => sum + e.total, 0);
  const totalTax = expenses.reduce((sum, e) => sum + e.tax, 0);
  const avgSpend = expenses.length > 0 ? totalSpend / expenses.length : 0;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`Total Spend: ${formatCurrency(totalSpend)}`, margin, y);
  doc.text(`Transactions: ${expenses.length}`, margin + 170, y);
  doc.text(`Total Tax: ${formatCurrency(totalTax)}`, margin + 300, y);
  doc.text(`Average: ${formatCurrency(avgSpend)}`, margin + 420, y);
  y += 28;

  // Category Breakdown
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Category Breakdown', margin, y);
  y += 16;

  const totalsByCategory = EXPENSE_CATEGORIES.map((cat) => ({
    category: cat,
    amount: expenses
      .filter((e) => e.category === cat)
      .reduce((acc, cur) => acc + cur.total, 0),
  })).filter((entry) => entry.amount > 0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  totalsByCategory.forEach((entry) => {
    const pct = totalSpend > 0 ? ((entry.amount / totalSpend) * 100).toFixed(1) : '0.0';
    doc.setTextColor(51, 65, 85);
    doc.text(entry.category, margin, y);
    doc.text(`${formatCurrency(entry.amount)} (${pct}%)`, pageWidth - margin, y, {
      align: 'right',
    });
    y += 16;
  });

  y += 16;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageWidth - margin, y);
  y += 22;

  // Transaction Ledger Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('Itemized Transactions', margin, y);
  y += 18;

  const drawTableHeader = () => {
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y - 12, pageWidth - margin * 2, 20, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('DATE', margin + 6, y);
    doc.text('MERCHANT', margin + 84, y);
    doc.text('CATEGORY', margin + 270, y);
    doc.text('ITEMS', margin + 375, y);
    doc.text('TOTAL', pageWidth - margin - 6, y, { align: 'right' });
    y += 18;
  };

  drawTableHeader();

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);

  expenses.forEach((exp) => {
    if (y > pageHeight - 60) {
      doc.addPage();
      y = 52;
      drawTableHeader();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
    }

    const merchantLabel = exp.merchant.length > 28 ? `${exp.merchant.slice(0, 26)}...` : exp.merchant;
    doc.setTextColor(15, 23, 42);
    doc.text(exp.date, margin + 6, y);
    doc.text(merchantLabel, margin + 84, y);
    doc.setTextColor(71, 85, 105);
    doc.text(exp.category, margin + 270, y);
    doc.text(String(exp.items.length || 1), margin + 375, y);
    doc.setTextColor(15, 23, 42);
    doc.text(formatCurrency(exp.total, exp.currency), pageWidth - margin - 6, y, {
      align: 'right',
    });

    y += 8;
    doc.setDrawColor(241, 245, 249);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;
  });

  doc.save(`${filenamePrefix}.pdf`);
}
