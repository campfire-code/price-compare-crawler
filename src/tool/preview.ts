// 截图与预览用的示例数据（不会进入正式运行）
import type { Row } from '../kit/runner';

const files: [string, number, Row['status'], Record<string, string | number> | string][] = [
  ['保温杯-淘宝.html', 412_000, 'ok', { platform: '淘宝', keyword: '保温杯', count: 5, min: 39.9, max: 88 }],
  ['保温杯-京东.html', 366_000, 'ok', { platform: '京东', keyword: '保温杯', count: 4, min: 42, max: 99 }],
  ['保温杯-1688.html', 298_000, 'ok', { platform: '1688', keyword: '保温杯', count: 3, min: 15.8, max: 22 }],
  ['台灯-淘宝.html', 405_000, 'run', { platform: '淘宝', keyword: '台灯', count: 6, min: 36.5, max: 128 }],
  ['台灯-京东.html', 380_000, 'wait', { platform: '京东', keyword: '台灯', count: 6, min: 41.9, max: 119 }],
  ['台灯-京东-登录页.html', 21_000, 'err', '没有找到商品：页面里需要有带价格（¥ 或 ￥）和商品链接的商品块。可能原因：保存的是登录页 / 验证页，或页面内容是靠脚本后加载的。工具不会去猜页面结构。'],
];

export const rows = (state: string): Row[] =>
  state === 'empty' ? [] : files.map(([name, size, status, extra], i) => {
    const st = state === 'done' && status !== 'err' ? 'ok' : status;
    const row = typeof extra === 'object' ? extra : {};
    return {
      item: { id: `p${i}`, name, path: `/示例/${name}`, size },
      status: st,
      progress: st === 'run' ? 0.55 : st === 'ok' ? 1 : 0,
      error: st === 'err' ? String(extra) : undefined,
      result: st === 'ok' ? { summary: `「${row.keyword}」${row.platform}：${row.count} 件，¥${row.min} – ¥${row.max}`, row } : undefined,
    };
  });

export const params = { keyword: '' };
export const notice = { kind: 'ok' as const, text: '已生成比价表：比价结果.xlsx。「保温杯」最低 ¥15.8（1688）；「台灯」最低 ¥36.5（淘宝）' };
