#!/usr/bin/env node

// ============================================================================
// AI Daily Pulse — Central Feed Generator
// ============================================================================
// 运行环境：GitHub Actions（每天一次）
// 抓取来源：
//   - RSS：18 个产品/AI 工具博客，过滤过去 24 小时内的新文章
//   - Serper API：补充当天 AI 热点（模型发布、产品更新）
//   - NewsAPI：补充当天 AI 热点（与 Serper 互补，去重合并）
//   - Product Hunt API：昨日热门产品 Top 3
// 输出：feed.json（提交回仓库，供 skill 拉取）
//
// 环境变量（存在 GitHub Secrets）：
//   SERPER_API_KEY
//   NEWS_API_KEY
//   PRODUCT_HUNT_TOKEN
// ============================================================================

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

// ── 常量 ────────────────────────────────────────────────────────────────────

const MAX_NEWS_ITEMS = 10;
const LOOKBACK_HOURS = 24;

const RSS_SOURCES = [
  { name: 'ClickUp Blog',       url: 'https://clickup.com/blog/feed/' },
  { name: 'Airtable Blog',      url: 'https://blog.airtable.com/feed/' },
  { name: 'Asana Blog',         url: 'https://blog.asana.com/feed/' },
  { name: 'Linear Changelog',   url: 'https://linear.app/changelog/rss' },
  { name: 'Monday.com Blog',    url: 'https://monday.com/blog/feed/' },
  { name: 'Glide Blog',         url: 'https://www.glideapps.com/blog/rss.xml' },
  { name: 'Softr Blog',         url: 'https://www.softr.io/blog/rss.xml' },
  { name: 'Framer Blog',        url: 'https://www.framer.com/blog/rss.xml' },
  { name: 'Google AI Blog',     url: 'https://blog.google/technology/ai/rss/' },
  { name: 'LottieFiles Blog',   url: 'https://lottiefiles.com/blog/rss.xml' },
  { name: 'RunwayML Blog',      url: 'https://runwayml.com/blog/rss.xml' },
  { name: 'Gamma Blog',         url: 'https://gamma.app/blog/rss.xml' },
  { name: 'Lovable Blog',       url: 'https://lovable.dev/blog/rss.xml' },
  { name: 'Notion Blog',        url: 'https://www.notion.so/blog/rss.xml' },
  { name: 'Figma Blog',         url: 'https://www.figma.com/blog/feed/atom.xml' },
  { name: 'Vercel Blog',        url: 'https://vercel.com/blog/feed' },
  { name: 'Replit Blog',        url: 'https://blog.replit.com/feed.xml' },
  { name: 'Cursor Changelog',   url: 'https://cursor.com/changelog/rss.xml' },
];

// AI 相关关键词，用于过滤 RSS 文章和搜索结果
const AI_KEYWORDS = [
  'ai', 'llm', 'gpt', 'claude', 'gemini', 'agent', 'anthropic', 'openai',
  'deepmind', 'grok', 'perplexity', 'cursor', 'copilot', 'replit',
  'machine learning', 'neural', 'model', 'generative', 'automation',
  '大模型', '人工智能',
];

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function isAIRelated(text) {
  const lower = (text || '').toLowerCase();
  return AI_KEYWORDS.some(kw => lower.includes(kw));
}

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

// ── RSS 抓取 ──────────────────────────────────────────────────────────────────

async function parseRSSFeed(source, errors) {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'AI-Daily-Pulse-Bot/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      errors.push(`RSS ${source.name}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = [];

    // 同时支持 RSS 2.0 和 Atom 格式
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

      const summary = (
        block.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/s)?.[1] ||
        block.match(/<description[^>]*>(.*?)<\/description>/s)?.[1] ||
        block.match(/<summary[^>]*>(.*?)<\/summary>/s)?.[1] || ''
      ).replace(/<[^>]+>/g, '').trim().slice(0, 200);

      const pubDate =
        block.match(/<pubDate>(.*?)<\/pubDate>/s)?.[1] ||
        block.match(/<published>(.*?)<\/published>/s)?.[1] ||
        block.match(/<updated>(.*?)<\/updated>/s)?.[1] || '';

      if (!title || !url) continue;
      if (!isWithinLookback(pubDate)) continue;

      items.push({
        title: title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        summary,
        url: url.trim(),
        source: source.name,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
        type: 'rss',
      });
    }

    return items;
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

// ── Serper 搜索 ───────────────────────────────────────────────────────────────

async function fetchSerperNews(apiKey, errors) {
  try {
    const query = 'AI news today LLM model release product launch agent';
    const res = await fetch('https://google.serper.dev/news', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10, tbs: 'qdr:d1' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      errors.push(`Serper: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.news || data.organic || [])
      .filter(item => isAIRelated(item.title + ' ' + (item.snippet || '')))
      .map(item => ({
        title: item.title || '',
        summary: (item.snippet || '').slice(0, 200),
        url: item.link || '',
        source: item.source || extractDomain(item.link),
        publishedAt: item.date ? new Date(item.date).toISOString() : null,
        type: 'search',
      }));
  } catch (err) {
    errors.push(`Serper: ${err.message}`);
    return [];
  }
}

// ── NewsAPI ───────────────────────────────────────────────────────────────────

async function fetchNewsAPI(apiKey, errors) {
  try {
    const res = await fetch(
      `https://newsapi.org/v2/everything?` +
      `q=AI+OR+LLM+OR+ChatGPT+OR+Claude+OR+Gemini+OR+"language+model"` +
      `&language=en&sortBy=publishedAt&pageSize=10` +
      `&from=${new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()}`,
      {
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) {
      errors.push(`NewsAPI: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.articles || [])
      .filter(a => a.url && !a.url.includes('[Removed]'))
      .filter(a => isAIRelated(a.title + ' ' + (a.description || '')))
      .map(a => ({
        title: a.title || '',
        summary: (a.description || '').slice(0, 200),
        url: a.url,
        source: a.source?.name || extractDomain(a.url),
        publishedAt: a.publishedAt || null,
        type: 'search',
      }));
  } catch (err) {
    errors.push(`NewsAPI: ${err.message}`);
    return [];
  }
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

// ── 工具 ──────────────────────────────────────────────────────────────────────

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

async function main() {
  const serperKey  = process.env.SERPER_API_KEY;
  const newsApiKey = process.env.NEWS_API_KEY;
  const phToken    = process.env.PRODUCT_HUNT_TOKEN;

  if (!serperKey)  { console.error('❌ SERPER_API_KEY not set');  process.exit(1); }
  if (!newsApiKey) { console.error('❌ NEWS_API_KEY not set');    process.exit(1); }
  if (!phToken)    { console.error('❌ PRODUCT_HUNT_TOKEN not set'); process.exit(1); }

  const errors = [];

  console.error('📡 Fetching RSS feeds...');
  const rssItems = await fetchAllRSS(errors);
  console.error(`   ${rssItems.length} articles from RSS (last 24h, no filter)`);

  console.error('🔍 Fetching Serper news...');
  const serperItems = await fetchSerperNews(serperKey, errors);
  console.error(`   ${serperItems.length} articles from Serper`);

  console.error('📰 Fetching NewsAPI...');
  const newsApiItems = await fetchNewsAPI(newsApiKey, errors);
  console.error(`   ${newsApiItems.length} articles from NewsAPI`);

  console.error('🚀 Fetching Product Hunt...');
  const products = await fetchProductHunt(phToken, errors);
  console.error(`   ${products.length} products`);

  // 合并、去重、取前 MAX_NEWS_ITEMS 条
  // 优先级：RSS（来源可控）> Serper > NewsAPI
  const allNews = dedupeByTitle(dedupeByUrl([
    ...rssItems,
    ...serperItems,
    ...newsApiItems,
  ])).slice(0, MAX_NEWS_ITEMS);

  const feed = {
    generatedAt: new Date().toISOString(),
    lookbackHours: LOOKBACK_HOURS,
    news: allNews,
    products,
    stats: {
      total: allNews.length,
      fromRSS: allNews.filter(i => i.type === 'rss').length,
      fromSearch: allNews.filter(i => i.type === 'search').length,
      products: products.length,
    },
    errors: errors.length > 0 ? errors : undefined,
  };

  await writeFile('feed.json', JSON.stringify(feed, null, 2));
  console.error(`✅ feed.json written: ${allNews.length} news, ${products.length} products`);
  if (errors.length > 0) {
    console.error(`⚠️  ${errors.length} non-fatal errors:`, errors);
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
