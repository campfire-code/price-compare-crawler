// 工具声明：淘宝 / 京东 / 1688 比价采集（只整理用户自己保存的页面，不联网、不读 cookie）
import { Scale as ScaleAsIcon } from 'lucide-react';
import type { BatchTool } from '../kit/types';
import { compare, decodeHtml, keywordFromFileName, ParseError, parsePage, type PlatformName, type Product } from './core';
import { writeCompareXlsx } from './xlsx';

const tool: BatchTool = {
  id: 'e28',
  name: '淘宝 / 京东 / 1688 比价采集',
  tagline: '你在浏览器里打开搜索结果页并另存为网页，拖进来：自动整理出商品名、价格、店铺、销量、链接，多个平台合并成一张对比表，标出最低价，导出 Excel。工具本身不访问平台、不读 cookie。',
  icon: ScaleAsIcon,
  category: '电商运营',
  type: 'data',
  mode: 'batch',
  resultView: 'table',
  concurrency: 1,
  columns: [['platform', '平台'], ['keyword', '关键词'], ['count', '商品数'], ['min', '最低价'], ['max', '最高价']],
  accept: { label: '保存的网页', extensions: ['html', 'htm'] },
  params: [
    { key: 'keyword', label: '关键词', type: 'text', default: '', placeholder: '留空则取文件名里的关键词', help: '同一个关键词的多个平台页面会放在一起比价。所有拖入的文件共用此关键词，要比多个关键词就分次处理，或留空按文件名区分' },
    { key: 'platform', label: '平台', type: 'segment', options: [['auto', '自动判断'], ['淘宝', '淘宝'], ['京东', '京东'], ['1688', '1688']], default: 'auto', help: '自动判断是看商品链接的域名；链接不是这三个平台的域名时请手动指定' },
    { key: 'out', label: '保存到', type: 'folder', default: '' },
  ],
  check: (item) => (/\.(mhtml?|webarchive)$/i.test(item.name) ? '不支持 MHTML / webarchive，请用浏览器的「网页，仅 HTML」或「网页，全部」另存为 .html' : null),

  async run(item, ctx) {
    const html = decodeHtml(await ctx.readFile(item.path!));
    ctx.progress(0.3);
    const p = ctx.params;
    const keyword = String(p.keyword).trim() || keywordFromFileName(item.name);
    const platform = p.platform === 'auto' ? undefined : (String(p.platform) as PlatformName);
    let res;
    try {
      res = parsePage(html, { keyword, platform });
    } catch (e) {
      throw e instanceof ParseError ? e : new Error(`解析失败：${e instanceof Error ? e.message : e}`);
    }
    const prices = res.products.map((x) => x.price);
    const plats = [...new Set(res.products.map((x) => x.platform))].join(' / ');
    const warn = res.warnings.length ? `；注意：${res.warnings.join('；')}` : '';
    return {
      summary: `「${keyword}」${plats}：${res.products.length} 件，¥${Math.min(...prices)} – ¥${Math.max(...prices)}${warn}`,
      row: { platform: plats, keyword, count: res.products.length, min: Math.min(...prices), max: Math.max(...prices) },
      data: res.products,
    };
  },

  async afterAll(results, ctx) {
    const all = results.flatMap((r) => (r.result.data as Product[] | undefined) ?? []);
    if (!all.length) return;
    const c = compare(all);
    const path = await ctx.join(ctx.outputDir, '比价结果.xlsx');
    await ctx.writeFile(path, await writeCompareXlsx(c));
    const best = c.keywords.map((k) => {
      const top = c.products.find((p) => p.keyword === k)!;
      return `「${k}」最低 ¥${top.price}（${top.platform}）`;
    });
    return `已生成比价表：${path}。${best.join('；')}`;
  },
};

export default tool;
