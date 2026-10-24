// 导出比价结果为 Excel：基于 exceljs（MIT）。加粗表头、冻结首行、按内容估算列宽。
import ExcelJS from 'exceljs';
import type { Comparison } from './core';

type Cell = string | number | null;

const width = (v: Cell) => (v == null ? 0 : [...String(v)].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0));

function sheet(wb: ExcelJS.Workbook, name: string, header: string[], rows: Cell[][], moneyCols: number[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(header).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((col, ci) => {
    const w = Math.max(width(header[ci]), ...rows.slice(0, 500).map((r) => width(r[ci] ?? null)));
    col.width = Math.min(50, Math.max(8, w + 2));
    if (moneyCols.includes(ci)) col.numFmt = '0.00';
  });
}

export async function writeCompareXlsx(c: Comparison): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '篝火 · 比价采集';
  sheet(wb, '汇总', ['关键词', '平台', '商品数', '最低价', '最高价', '平均价', '比全平台最低价高（元）'], c.summary.map((s) => [s.keyword, s.platform, s.count, s.min, s.max, s.avg, s.gap]), [3, 4, 5, 6]);
  sheet(wb, '对比明细', ['关键词', '平台', '商品名', '价格（元）', '店铺', '销量', '标记', '备注', '链接'], c.products.map((p) => [p.keyword, p.platform, p.title, p.price, p.shop, p.sales, p.flag, p.note, p.link]), [3]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
