import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, decodeHtml, findPrices, keywordFromFileName, parsePage, ParseError, parseSales, platformOfLink } from './core';

const sample = (n: string) => decodeHtml(new Uint8Array(readFileSync(`samples/${n}`)));

describe('小函数', () => {
  it('价格：拆开的写法、千分位、两位小数', () => {
    expect(findPrices('¥59.90')).toEqual([59.9]);
    expect(findPrices('￥1,299 起 ¥ 8.5')).toEqual([1299, 8.5]);
    expect(findPrices('59元')).toEqual([]);
  });
  it('销量：多种写法和「万」', () => {
    expect(parseSales('1.2万+人付款')).toEqual({ sales: '1.2万+人付款', num: 12000 });
    expect(parseSales('已售 5000+')).toEqual({ sales: '已售 5000+', num: 5000 });
    expect(parseSales('成交 2.3万件').num).toBe(23000);
    expect(parseSales('好评率 98%')).toEqual({ sales: '', num: null });
  });
  it('平台按域名判断', () => {
    expect(platformOfLink('//item.taobao.com/item.htm?id=1')).toBe('淘宝');
    expect(platformOfLink('https://detail.tmall.com/item.htm')).toBe('淘宝');
    expect(platformOfLink('https://item.jd.com/1.html')).toBe('京东');
    expect(platformOfLink('https://detail.1688.com/offer/1.html')).toBe('1688');
    expect(platformOfLink('https://example.com/a')).toBeNull();
    expect(platformOfLink('/relative')).toBeNull();
  });
  it('关键词取自文件名', () => {
    expect(keywordFromFileName('保温杯-淘宝.html')).toBe('保温杯');
    expect(keywordFromFileName('京东 保温杯 搜索结果(2).html')).toBe('保温杯');
    expect(keywordFromFileName('淘宝.html')).toBe('淘宝');
  });
  it('GBK 声明的页面能解码', () => {
    const gbk = new Uint8Array([0x3c, 0x6d, 0x65, 0x74, 0x61, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3d, 0x67, 0x62, 0x6b, 0x3e, 0xb1, 0xa3, 0xce, 0xc2, 0xb1, 0xad]);
    expect(decodeHtml(gbk)).toContain('保温杯');
  });
});

describe('解析示例页面', () => {
  it('淘宝：拆开的价格、划线价不算、销量、店铺、链接补 https', () => {
    const r = parsePage(sample('保温杯-淘宝.html'), { keyword: '保温杯' });
    expect(r.products).toHaveLength(5);
    const p = r.products[0];
    expect(p).toMatchObject({ platform: '淘宝', title: '示例 304 不锈钢保温杯 500ml 大容量', price: 59.9, shop: '示例杯具专营店', salesNum: 2000, link: 'https://item.taobao.com/item.htm?id=1001' });
    expect(r.products[1].salesNum).toBe(12000);
    expect(r.warnings).toEqual([]);
  });
  it('京东：券后价取非划线价', () => {
    const r = parsePage(sample('保温杯-京东.html'), { keyword: '保温杯' });
    expect(r.products.map((p) => p.price)).toEqual([52.9, 99, 69.9, 42]);
    expect(r.products[0]).toMatchObject({ platform: '京东', shop: '示例杯具自营旗舰店', sales: '已售 5000+' });
  });
  it('1688：区间价取起始价并写备注', () => {
    const r = parsePage(sample('保温杯-1688.html'), { keyword: '保温杯' });
    expect(r.products.map((p) => p.price)).toEqual([18.5, 15.8, 22]);
    expect(r.products[0].note).toContain('区间价');
    expect(r.products[1].note).toBe('');
    expect(r.products[0]).toMatchObject({ platform: '1688', shop: '示例杯业有限公司', salesNum: 23000 });
  });
  it('手动指定平台会覆盖域名判断', () => {
    expect(parsePage(sample('保温杯-京东.html'), { keyword: 'k', platform: '淘宝' }).products.every((p) => p.platform === '淘宝')).toBe(true);
  });
  it('登录页：明确报错，不猜', () => {
    expect(() => parsePage(sample('台灯-京东-登录页.html'), { keyword: 'k' })).toThrow(ParseError);
    expect(() => parsePage(sample('台灯-京东-登录页.html'), { keyword: 'k' })).toThrow(/没有找到商品/);
    expect(() => parsePage('  ', { keyword: 'k' })).toThrow('文件是空的');
  });
  it('脚本里的价格不算；只有一个商品块也能识别', () => {
    const r = parsePage('<script>var a="¥1"</script><div><a href="https://item.jd.com/9.html">示例单品 保温杯</a><span>¥33.00</span></div>', { keyword: 'k' });
    expect(r.products).toHaveLength(1);
    expect(r.products[0]).toMatchObject({ price: 33, platform: '京东', title: '示例单品 保温杯' });
  });
  it('链接不是三个平台：标「未识别」并提示', () => {
    const html = '<ul><li><a href="https://a.example.com/1">示例商品甲</a> ¥5</li><li><a href="https://a.example.com/2">示例商品乙</a> ¥6</li></ul>';
    const r = parsePage(html, { keyword: 'k' });
    expect(r.products.map((p) => p.platform)).toEqual(['未识别', '未识别']);
    expect(r.warnings.join()).toContain('未识别');
  });
  it('块内有多个无法区分的价格：取第一个并备注', () => {
    const html = '<ul><li><a href="https://item.jd.com/1.html">示例甲</a> ¥5 ¥8</li><li><a href="https://item.jd.com/2.html">示例乙</a> ¥6</li></ul>';
    const r = parsePage(html, { keyword: 'k' });
    expect(r.products[0].price).toBe(5);
    expect(r.products[0].note).toContain('请核对');
  });
  it('重复商品（同链接）只留一个', () => {
    const li = '<li><a href="https://item.jd.com/1.html">示例甲</a> ¥5</li>';
    expect(parsePage(`<ul>${li}${li}</ul>`, { keyword: 'k' }).products).toHaveLength(1);
  });
});

describe('比价', () => {
  const all = ['保温杯-淘宝.html', '保温杯-京东.html', '保温杯-1688.html'].flatMap((n) => parsePage(sample(n), { keyword: '保温杯' }).products);
  it('同关键词按价格排序，最低价标记、平台汇总', () => {
    const c = compare(all);
    expect(c.keywords).toEqual(['保温杯']);
    expect(c.products).toHaveLength(12);
    expect(c.products[0]).toMatchObject({ price: 15.8, platform: '1688', flag: '全平台最低价' });
    expect(c.products[11].price).toBe(99);
    const total = c.summary.find((s) => s.platform === '全部平台')!;
    expect(total).toMatchObject({ count: 12, min: 15.8, max: 99, gap: 0 });
    expect(c.summary.find((s) => s.platform === '京东')).toMatchObject({ count: 4, min: 42, max: 99, gap: 26.2 });
    expect(c.summary.find((s) => s.platform === '淘宝')).toMatchObject({ min: 39.9, gap: 24.1 });
  });
  it('多个关键词分组；只有一个平台时不出「全部平台」行', () => {
    const t = parsePage(sample('保温杯-淘宝.html'), { keyword: '杯子' }).products;
    const c = compare([...all, ...t]);
    expect(c.keywords).toEqual(['保温杯', '杯子']);
    expect(c.summary.filter((s) => s.keyword === '杯子').map((s) => s.platform)).toEqual(['淘宝']);
  });
});
