#!/usr/bin/env node

// ============================================================================
// AI Daily Pulse — Central Feed Generator
// ============================================================================
// 运行环境：GitHub Actions（每天一次）
// 抓取来源：
//   - RSS：37 个源，分七类，只取过去 24 小时内、每源最新 5 条
//   - Product Hunt API：昨日热门产品 Top 3
// 输出：feed.json（提交回仓库，供 skill 拉取）
//
// 环境变量（存在 GitHub Secrets）：
//   PRODUCT_HUNT_TOKEN
// ============================================================================

import { writeFile } from 'fs/promises';

// ── 常量 ────────────────────────────────────────────────────────────────────

const LOOKBACK_HOURS = 24;
const MAX_ITEMS_PER_SOURCE = 5;   // 每个源最多保留最新 5 条，防止高产媒体刷屏

// 七个分类。数组顺序即 feed.json 里新闻的排列顺序，也是后续邮件分组展示的顺序
const CAT = {
  vendor:  '模型厂商官方',
  devtool: 'AI 开发工具与变更日志',
  b2b:     'B 端协作与效率产品',
  design:  '设计',
  product: '产品与商业策略',
  media:   '科技媒体',
  video:   '视频',
};
const CATEGORY_ORDER = Object.values(CAT);

const RSS_SOURCES = [
  // ① 模型厂商官方（13）—— 喂 timelines
  { name: 'Anthropic News',       url: 'https://rsshub.bestblogs.dev/anthropic/news',                                              category: CAT.vendor },
  { name: 'OpenAI News',          url: 'https://openai.com/news/rss.xml',                                                          category: CAT.vendor },
  { name: 'Google DeepMind',      url: 'https://deepmind.com/blog/feed/basic/',                                                    category: CAT.vendor },
  { name: 'Google AI Blog',       url: 'https://blog.google/technology/ai/rss/',                                                   category: CAT.vendor },
  { name: 'Google Research',      url: 'https://research.google/blog/rss/',                                                        category: CAT.vendor },
  { name: 'Hugging Face',         url: 'https://huggingface.co/blog/feed.xml',                                                     category: CAT.vendor },
  { name: '智谱',                 url: 'https://wechat2rss.bestblogs.dev/feed/433d2134dca54d80804daf32e8be546155be3300.xml',      category: CAT.vendor },
  { name: 'DeepSeek',             url: 'https://wechat2rss.bestblogs.dev/feed/1709da4f538d4ce4fb6d7a8ba1a5a1c297919601.xml',      category: CAT.vendor },
  { name: 'Kimi',                 url: 'https://wechat2rss.bestblogs.dev/feed/c5c43d4bc17bae656763859ed0903bb6314ec6fe.xml',      category: CAT.vendor },
  { name: '腾讯混元',             url: 'https://wechat2rss.bestblogs.dev/feed/306ce19a1ca590c9c2df781789e828d1acfa1356.xml',      category: CAT.vendor },
  { name: '通义',                 url: 'https://wechat2rss.bestblogs.dev/feed/4ebee6222ae08705b8aabc9116f0defbcb6b17c6.xml',      category: CAT.vendor },
  { name: '阶跃',                 url: 'https://wechat2rss.bestblogs.dev/feed/3e2714d06aa36142e8ed6b3f4e5cf9090a069dd2.xml',      category: CAT.vendor },

  // ② AI 开发工具与变更日志（4）—— agent 过程可视化 / 编辑 AI 生成内容
  { name: 'Cursor Changelog',     url: 'https://cursor.com/changelog/rss.xml',                                                     category: CAT.devtool },
  { name: 'Lovable Blog',         url: 'https://lovable.dev/blog/rss.xml',                                                         category: CAT.devtool },
  { name: 'Replit Blog',          url: 'https://blog.replit.com/feed.xml',                                                         category: CAT.devtool },
  { name: 'Vercel',               url: 'https://vercel.com/atom',                                                                  category: CAT.devtool },

  // ③ B 端协作与效率产品（5）—— 同业观察，喂 precedents
  { name: 'ClickUp Blog',         url: 'https://clickup.com/blog/feed/',                                                           category: CAT.b2b },
  { name: 'Airtable Blog',        url: 'https://blog.airtable.com/feed/',                                                          category: CAT.b2b },
  { name: 'Asana Blog',           url: 'https://blog.asana.com/feed/',                                                             category: CAT.b2b },
  { name: 'Monday.com Blog',      url: 'https://monday.com/blog/feed/',                                                            category: CAT.b2b },
  { name: 'Linear Changelog',     url: 'https://linear.app/rss/changelog.xml',                                                     category: CAT.b2b },

  // ④ 设计（4）
  { name: 'Figma Blog',           url: 'https://www.figma.com/blog/feed/atom.xml',                                                 category: CAT.design },
  { name: 'NN/g',                 url: 'https://www.nngroup.com/feed/rss/',                                                        category: CAT.design },
  { name: 'UX Collective',        url: 'https://uxdesign.cc/feed',                                                                 category: CAT.design },

  // ⑤ 产品与商业策略（2）
  { name: "Lenny's Newsletter",   url: 'https://www.lennysnewsletter.com/feed',                                                    category: CAT.product },
  { name: 'Every',                url: 'https://every.to/feed',                                                                    category: CAT.product },

  // ⑥ 科技媒体（2）—— 每日资讯摄入
  { name: 'TechCrunch AI',        url: 'https://techcrunch.com/category/artificial-intelligence/feed/',                            category: CAT.media },
  { name: '量子位',               url: 'https://www.qbitai.com/feed',                                                              category: CAT.media },

  // ⑦ 视频（5）—— 归 raw/notes
  { name: 'Jeff Su',              url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCwAnu01qlnVg1Ai2AbtTMaA',             category: CAT.video },
  { name: 'All About AI',         url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCR9j1jqqB5Rse69wjUnbYwA',             category: CAT.video },
  { name: 'Tina Huang',           url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC2UXDak6o7rBm23k3Vv5dww',             category: CAT.video },
  { name: 'Figma YouTube',        url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCQsVmhSa4X-G3lHlUtejzLA',             category: CAT.video },
  { name: 'AI Jason',             url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCrXSVX9a1mj8l0CMLwKgMVw',             category: CAT.video },
];

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function isWithinLookback(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() < LOOKBACK_HOURS * 60 * 60 * 1000;
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function dedupeByTitle(items) {
  const seen = new Set();
  return items.filter(item => {
    // 标题前20字去重，避免同一新闻被不同来源重复收录
    const key = (item.title || '').slice(0, 20).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ── RSS 抓取 ──────────────────────────────────────────────────────────────────

async function parseRSSFeed(source, errors) {
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      errors.push(`RSS ${source.name}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = [];

    // 同时支持 RSS 2.0 和 Atom 格式（GitHub Releases / YouTube / Figma 是 Atom）
    const isAtom = xml.includes('<feed');
    const entryPattern = isAtom
      ? /<entry>([\s\S]*?)<\/entry>/g
      : /<item>([\s\S]*?)<\/item>/g;

    let match;
    while ((match = entryPattern.exec(xml)) !== null) {
      const block = match[1];

      const title = (
        block.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/s)?.[1] ||
        block.match(/<title[^>]*>(.*?)<\/title>/s)?.[1] || ''
      ).trim();

      const url = isAtom
        ? (block.match(/<link[^>]*href="([^"]+)"/)?.[1] || '')
        : (block.match(/<link>(.*?)<\/link>/s)?.[1] ||
           block.match(/<link\s+href="([^"]+)"/)?.[1] || '');

      // 简介：依次尝试 description / summary / content / media:description（YouTube）
      // 先解 HTML 转义再剥标签，否则 GitHub Atom 里被转义的 <p> 会残留
      const summaryRaw = (
        block.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/s)?.[1] ||
        block.match(/<description[^>]*>(.*?)<\/description>/s)?.[1] ||
        block.match(/<summary[^>]*>(.*?)<\/summary>/s)?.[1] ||
        block.match(/<content[^>]*>(.*?)<\/content>/s)?.[1] ||
        block.match(/<media:description>(.*?)<\/media:description>/s)?.[1] || ''
      ).replace(/<!\[CDATA\[|\]\]>/g, '');
      const summary = decodeEntities(summaryRaw).replace(/<[^>]+>/g, '').trim().slice(0, 200);

      const pubDate =
        block.match(/<pubDate>(.*?)<\/pubDate>/s)?.[1] ||
        block.match(/<published>(.*?)<\/published>/s)?.[1] ||
        block.match(/<updated>(.*?)<\/updated>/s)?.[1] || '';

      if (!title || !url) continue;
      if (!isWithinLookback(pubDate)) continue;

      items.push({
        title: decodeEntities(title),
        summary,
        url: url.trim(),
        source: source.name,
        category: source.category,
        publishedAt: new Date(pubDate).toISOString(),
      });
    }

    // 按发布时间倒序，只保留每源最新 N 条
    items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    return items.slice(0, MAX_ITEMS_PER_SOURCE);
  } catch (err) {
    errors.push(`RSS ${source.name}: ${err.message}`);
    return [];
  }
}

async function fetchAllRSS(errors) {
  const results = await Promise.allSettled(
    RSS_SOURCES.map(source => parseRSSFeed(source, errors))
  );
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

// ── Product Hunt ──────────────────────────────────────────────────────────────

async function fetchProductHunt(token, errors) {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const query = `{
      posts(first: 3, order: VOTES,
        postedAfter: "${yesterday.toISOString()}") {
        edges { node { name tagline slug } }
      }
    }`;
    const res = await fetch('https://api.producthunt.com/v2/api/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      errors.push(`ProductHunt: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.data?.posts?.edges || []).map(({ node }) => ({
      name: node.name,
      tagline: node.tagline || '',
      url: `https://www.producthunt.com/posts/${node.slug}`,
    }));
  } catch (err) {
    errors.push(`ProductHunt: ${err.message}`);
    return [];
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  const phToken = process.env.PRODUCT_HUNT_TOKEN;
  if (!phToken) { console.error('❌ PRODUCT_HUNT_TOKEN not set'); process.exit(1); }

  const errors = [];

  console.error(`📡 Fetching ${RSS_SOURCES.length} RSS feeds...`);
  const rssItems = await fetchAllRSS(errors);
  console.error(`   ${rssItems.length} articles (last ${LOOKBACK_HOURS}h, max ${MAX_ITEMS_PER_SOURCE} per source)`);

  console.error('🚀 Fetching Product Hunt...');
  const products = await fetchProductHunt(phToken, errors);
  console.error(`   ${products.length} products`);

  // 去重后按「分类顺序 → 发布时间倒序」排列，feed.json 里天然按七类分组
  const news = dedupeByTitle(dedupeByUrl(rssItems)).sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  const byCategory = Object.fromEntries(CATEGORY_ORDER.map(c => [c, 0]));
  news.forEach(n => { byCategory[n.category]++; });

  const feed = {
    generatedAt: new Date().toISOString(),
    lookbackHours: LOOKBACK_HOURS,
    maxItemsPerSource: MAX_ITEMS_PER_SOURCE,
    categories: CATEGORY_ORDER,
    news,
    products,
    stats: {
      total: news.length,
      byCategory,
      sourcesTotal: RSS_SOURCES.length,
      sourcesFailed: errors.filter(e => e.startsWith('RSS ')).length,
      products: products.length,
    },
    errors: errors.length > 0 ? errors : undefined,
  };

  await writeFile('feed.json', JSON.stringify(feed, null, 2));
  console.error(`✅ feed.json written: ${news.length} news, ${products.length} products`);
  if (errors.length > 0) {
    console.error(`⚠️  ${errors.length} non-fatal errors:`, errors);
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
