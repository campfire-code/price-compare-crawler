// 纯函数：把用户自己保存下来的搜索结果页（HTML）整理成商品列表，再做多平台比价。
// 不联网、不读 cookie。解析规则是通用的「重复出现的、带价格和链接的块」，不依赖任何平台的具体类名。
import { parse, type HTMLElement } from 'node-html-parser';

export type PlatformName = '淘宝' | '京东' | '1688' | '未识别';

export interface Product {
  keyword: string;
  platform: PlatformName;
  title: string;
  /** 价格（元）；区间价取起始价 */
  price: number;
  shop: string;
  /** 页面上原样的销量文字，例如「已售 1000+」 */
  sales: string;
  salesNum: number | null;
  link: string;
  note: string;
}

export interface ParseResult {
  products: Product[];
  /** 需要用户留意的提示，例如「页面里有 2 组商品块」 */
  warnings: string[];
}

export class ParseError extends Error {}

// ---------- 文本与编码 ----------

/** 按文件头里声明的编码解码；声明 GBK 系用 gb18030，否则 UTF-8 */
export function decodeHtml(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const m = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
  const label = m?.[1].toLowerCase();
  if (label && /^(gbk|gb2312|gb18030)$/.test(label)) return new TextDecoder('gb18030').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const text = (el: HTMLElement) => clean(el.textContent.replace(/&nbsp;/g, ' '));

// ---------- 价格、销量 ----------

const PRICE_RE = /[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;

export function findPrices(s: string): number[] {
  return [...s.matchAll(PRICE_RE)].map((m) => Number(`${m[1].replace(/,/g, '')}.${m[2] ?? '0'}`));
}

/** 价格文字形如「¥10.00-¥20.00」时视为区间 */
function isRange(s: string): boolean {
  return /[¥￥]\s*\d[\d,.]*\s*[-~–—至到]\s*[¥￥]?\s*\d/.test(s);
}

const SALES_RES = [
  /((?:已售|月销|累计售|销量|成交)\s*[\d.]+\s*万?\+?\s*[件笔单]?)/,
  /([\d.]+\s*万?\+?\s*(?:人付款|人收货|人已付款|人购买|人已购|件成交|笔成交|件已售|已售|人付款))/,
];

export function parseSales(s: string): { sales: string; num: number | null } {
  for (const re of SALES_RES) {
    const m = re.exec(s);
    if (m) {
      const n = /([\d.]+)\s*(万)?/.exec(m[1]);
      const num = n ? Math.round(Number(n[1]) * (n[2] ? 10000 : 1)) : null;
      return { sales: clean(m[1]), num: num != null && Number.isFinite(num) ? num : null };
    }
  }
  return { sales: '', num: null };
}

// ---------- 平台 ----------

export function platformOfLink(link: string): PlatformName | null {
  let host = '';
  try {
    host = new URL(link.startsWith('//') ? `https:${link}` : link).hostname.toLowerCase();
  } catch {
    return null;
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  if (is('taobao.com') || is('tmall.com')) return '淘宝';
  if (is('jd.com') || is('jd.hk')) return '京东';
  if (is('1688.com')) return '1688';
  return null;
}

/** 从文件名取关键词：去掉扩展名、平台名和「搜索结果」之类的字样 */
export function keywordFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const k = base
    .replace(/淘宝|天猫|京东|阿里巴巴|阿里|1688|搜索结果|搜索页|比价|\(\d+\)|（\d+）/g, ' ')
    .replace(/[-_—·、,，.\s]+/g, ' ')
    .trim();
  return k || base;
}

// ---------- 找商品块 ----------

const SKIP_TAGS = ['script', 'style', 'noscript', 'template', 'svg', 'head'];
const priceCount = (el: HTMLElement) => findPrices(text(el)).length;
const hasLink = (el: HTMLElement) => realHref(el) != null || el.querySelectorAll('a').some((a) => realHref(a) != null);
const sig = (el: HTMLElement) => `${el.tagName}.${(el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort().join('.')}`;
const depth = (el: HTMLElement) => { let d = 0; for (let p = el.parentNode; p; p = p.parentNode) d++; return d; };

function realHref(a: HTMLElement): string | null {
  if (a.tagName !== 'A') return null;
  const h = (a.getAttribute('href') ?? '').trim();
  return !h || h.startsWith('#') || /^javascript:/i.test(h) ? null : h;
}

function contains(a: HTMLElement, b: HTMLElement): boolean {
  for (let p = b.parentNode; p; p = p.parentNode) if (p === a) return true;
  return false;
}

/** 找出商品块。优先：同一父元素下、标签和 class 相同、至少出现 2 次、且各含价格和链接的块（取最内层）；其次：没有重复块时，取各含一个价格和链接的最内层块。 */
export function findCards(root: HTMLElement): { cards: HTMLElement[]; groups: number } {
  const all = root.querySelectorAll('*').filter((e) => priceCount(e) >= 1 && hasLink(e));
  const byParent = new Map<HTMLElement, Map<string, HTMLElement[]>>();
  for (const e of all) {
    const p = e.parentNode as HTMLElement | null;
    if (!p) continue;
    const m = byParent.get(p) ?? new Map<string, HTMLElement[]>();
    const k = sig(e);
    m.set(k, [...(m.get(k) ?? []), e]);
    byParent.set(p, m);
  }
  const groups: HTMLElement[][] = [];
  for (const m of byParent.values()) for (const g of m.values()) if (g.length >= 2) groups.push(g);
  // 只留最内层：含有别的分组成员的分组被丢弃
  const members = groups.flat();
  const inner = groups.filter((g) => !g.some((e) => members.some((o) => o !== e && contains(e, o))));
  if (inner.length) return { cards: inner.flat().sort((a, b) => depth(a) - depth(b) || 0), groups: inner.length };

  const one = all.filter((e) => priceCount(e) === 1);
  const single = one.filter((e) => !one.some((o) => o !== e && contains(e, o)));
  return { cards: single, groups: single.length ? 1 : 0 };
}

// ---------- 取字段 ----------

const clsOf = (el: HTMLElement) => `${el.getAttribute('class') ?? ''} ${el.getAttribute('id') ?? ''}`;
const descendants = (el: HTMLElement) => el.querySelectorAll('*');

function pickTitle(card: HTMLElement): { title: string; anchor: HTMLElement | null } {
  const anchors = (card.tagName === 'A' ? [card] : []).concat(card.querySelectorAll('a'));
  const hrefAnchors = anchors.filter((a) => realHref(a) != null);
  for (const e of descendants(card)) {
    if (/title|subject|item-?name|prod-?name|goods-?name|product-?name/i.test(clsOf(e)) && !/price|shop|store/i.test(clsOf(e))) {
      const t = text(e);
      if (t.length >= 2 && findPrices(t).length === 0) {
        const a = e.tagName === 'A' ? e : (e.querySelector('a') ?? hrefAnchors.find((x) => contains(x, e)) ?? null);
        return { title: t, anchor: a && realHref(a) ? a : (hrefAnchors[0] ?? null) };
      }
    }
  }
  let best: HTMLElement | null = null;
  let bestText = '';
  for (const a of hrefAnchors) {
    const t = text(a);
    if (findPrices(t).length === 0 && t.length > bestText.length) { best = a; bestText = t; }
  }
  if (best && bestText.length >= 2) return { title: bestText, anchor: best };
  for (const e of [card, ...descendants(card)]) {
    const t = clean(e.getAttribute('title') ?? e.getAttribute('alt') ?? '');
    if (t.length >= 2) return { title: t, anchor: hrefAnchors[0] ?? null };
  }
  return { title: '', anchor: hrefAnchors[0] ?? null };
}

function pickPrice(card: HTMLElement): { price: number; note: string } | null {
  const mark = descendants(card).filter((e) => /price|yuan|money/i.test(clsOf(e)) && !/origin|orig|old|market|del|through|lineth/i.test(clsOf(e)) && findPrices(text(e)).length >= 1);
  // 取最内层的价格元素，其中区间价（两个价格）整体算一个
  const inner = mark.filter((e) => !mark.some((o) => o !== e && contains(e, o)));
  const pick = (el: HTMLElement, extra: string) => {
    const c = parse(el.outerHTML);
    c.querySelectorAll('del, s, strike').forEach((e) => e.remove());
    const t = text(c);
    const ps = findPrices(t);
    if (ps.length >= 2 && isRange(t)) return { price: Math.min(...ps), note: `区间价 ¥${Math.min(...ps)}–¥${Math.max(...ps)}，按起始价比较${extra}` };
    return { price: ps[0], note: extra.replace(/^；/, '') };
  };
  if (inner.length) return pick(inner[0], '');
  // 去掉划线价（del / s）后再找
  const copy = parse(card.outerHTML);
  copy.querySelectorAll('del, s, strike').forEach((e) => e.remove());
  const ps = findPrices(text(copy));
  if (!ps.length) return null;
  const t = text(copy);
  if (ps.length === 1) return { price: ps[0], note: '' };
  if (ps.length === 2 && isRange(t)) return { price: Math.min(...ps), note: `区间价 ¥${Math.min(...ps)}–¥${Math.max(...ps)}，按起始价比较` };
  return { price: ps[0], note: `块内有 ${ps.length} 个价格且无法区分，取了第一个，请核对` };
}

function pickShop(card: HTMLElement): string {
  for (const e of descendants(card)) {
    if (/shop|store|seller|merchant|company|supplier/i.test(clsOf(e)) && !/price|title|img|logo|icon/i.test(clsOf(e))) {
      const t = text(e);
      if (t.length >= 2 && t.length <= 40 && findPrices(t).length === 0) return t;
    }
  }
  return '';
}

function absLink(h: string): string {
  return h.startsWith('//') ? `https:${h}` : h;
}

// ---------- 对外：解析一页 ----------

export interface ParseOptions {
  keyword: string;
  /** 手动指定平台；不指定则按商品链接的域名判断 */
  platform?: PlatformName;
}

export function parsePage(html: string, opt: ParseOptions): ParseResult {
  if (!html.trim()) throw new ParseError('文件是空的');
  const root = parse(html, { comment: false });
  root.querySelectorAll(SKIP_TAGS.join(',')).forEach((e) => e.remove());
  const { cards, groups } = findCards(root as unknown as HTMLElement);
  if (!cards.length) {
    throw new ParseError('没有找到商品：页面里需要有带价格（¥ 或 ￥）和商品链接的商品块。可能原因：保存的是登录页 / 验证页，或页面内容是靠脚本后加载的（请等商品显示完整后再另存，或用「保存为完整网页」）。工具不会去猜页面结构。');
  }
  const warnings: string[] = [];
  const products: Product[] = [];
  const seen = new Set<string>();
  let noTitle = 0;
  for (const card of cards) {
    const { title, anchor } = pickTitle(card);
    const priced = pickPrice(card);
    if (!priced || !(priced.price > 0)) continue;
    const href = anchor ? realHref(anchor) : null;
    const link = href ? absLink(href) : '';
    const key = link || `${title}|${priced.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!title) noTitle++;
    const platform = opt.platform ?? platformOfLink(link) ?? '未识别';
    const s = parseSales(text(card));
    products.push({ keyword: opt.keyword, platform, title: title || '（未识别商品名）', price: priced.price, shop: pickShop(card), sales: s.sales, salesNum: s.num, link, note: priced.note });
  }
  if (!products.length) throw new ParseError('找到了商品块，但没能读出有效价格。工具不会去猜，请换一个页面再试。');
  if (groups > 1) warnings.push(`页面里有 ${groups} 组重复的商品块（可能含推荐位 / 广告位），已全部收录，请核对`);
  if (noTitle) warnings.push(`${noTitle} 个商品没识别出商品名`);
  const unknown = products.filter((p) => p.platform === '未识别').length;
  if (unknown) warnings.push(`${unknown} 个商品的链接不属于淘宝 / 京东 / 1688，平台标为「未识别」；可在「平台」里手动指定`);
  return { products, warnings };
}

// ---------- 比价 ----------

export interface SummaryRow {
  keyword: string;
  platform: string;
  count: number;
  min: number;
  max: number;
  avg: number;
  /** 本平台最低价比该关键词全平台最低价高多少（元） */
  gap: number;
}

export interface Comparison {
  /** 按关键词出现顺序、同关键词内按价格从低到高 */
  products: (Product & { flag: string })[];
  summary: SummaryRow[];
  keywords: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function compare(all: Product[]): Comparison {
  const keywords = [...new Set(all.map((p) => p.keyword))];
  const products: Comparison['products'] = [];
  const summary: SummaryRow[] = [];
  for (const k of keywords) {
    const ps = all.filter((p) => p.keyword === k).sort((a, b) => a.price - b.price);
    const min = ps[0].price;
    const platforms = [...new Set(ps.map((p) => p.platform))];
    for (const p of ps) {
      const flag = p.price === min ? '全平台最低价' : p.price === Math.min(...ps.filter((x) => x.platform === p.platform).map((x) => x.price)) ? `本平台最低，比全平台最低高 ¥${r2(p.price - min)}` : `比最低高 ${Math.round(((p.price - min) / min) * 100)}%`;
      products.push({ ...p, flag });
    }
    const line = (platform: string, list: Product[]) => {
      const prices = list.map((p) => p.price);
      summary.push({ keyword: k, platform, count: list.length, min: Math.min(...prices), max: Math.max(...prices), avg: r2(prices.reduce((a, b) => a + b, 0) / prices.length), gap: r2(Math.min(...prices) - min) });
    };
    if (platforms.length > 1) line('全部平台', ps);
    for (const pl of platforms) line(pl, ps.filter((p) => p.platform === pl));
  }
  return { products, summary, keywords };
}
