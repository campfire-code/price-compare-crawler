import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import tool from './index';
import type { InputItem, RunContext } from '../kit/types';

function fakeCtx(params: Record<string, string | number | boolean> = {}) {
  const written = new Map<string, Uint8Array>();
  const ctx = {
    params: { keyword: '', platform: 'auto', ...params },
    outputDir: '/out',
    progress() {},
    readFile: async (p: string) => new Uint8Array(readFileSync(p)),
    writeFile: async (p: string, d: Uint8Array) => { written.set(p, d); },
    join: async (...a: string[]) => a.join('/'),
  } as unknown as RunContext;
  return { ctx, written };
}
const item = (n: string): InputItem => ({ id: n, name: n, path: `samples/${n}` });

describe('整批流程', () => {
  it('三个平台页面 → 一张比价 Excel', async () => {
    const { ctx, written } = fakeCtx();
    const results: { item: InputItem; result: Awaited<ReturnType<typeof tool.run>> }[] = [];
    for (const n of ['保温杯-淘宝.html', '保温杯-京东.html', '保温杯-1688.html']) results.push({ item: item(n), result: await tool.run(item(n), ctx) });
    expect(results[0].result.row).toMatchObject({ platform: '淘宝', keyword: '保温杯', count: 5, min: 39.9, max: 88 });
    const msg = await tool.afterAll!(results, ctx);
    expect(msg).toContain('保温杯」最低 ¥15.8（1688）');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(written.get('/out/比价结果.xlsx')!.buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['汇总', '对比明细']);
    const detail = wb.getWorksheet('对比明细')!;
    expect(detail.rowCount).toBe(13);
    expect(detail.getRow(2).getCell(4).value).toBe(15.8);
    expect(detail.getRow(2).getCell(7).value).toBe('全平台最低价');
  });
  it('登录页：失败并给清楚原因；收尾只处理成功的', async () => {
    const { ctx } = fakeCtx();
    await expect(tool.run(item('台灯-京东-登录页.html'), ctx)).rejects.toThrow('没有找到商品');
    expect(await tool.afterAll!([], ctx)).toBeUndefined();
  });
  it('手动填的关键词覆盖文件名', async () => {
    const { ctx } = fakeCtx({ keyword: '水杯' });
    const r = await tool.run(item('保温杯-京东.html'), ctx);
    expect(r.row!.keyword).toBe('水杯');
  });
  it('MHTML 在处理前被拒绝', () => {
    expect(tool.check!({ id: 'x', name: 'a.mhtml' })).toContain('不支持');
  });
  it('没有大模型设置', () => {
    expect(tool.needsLLM).toBeFalsy();
  });
});
