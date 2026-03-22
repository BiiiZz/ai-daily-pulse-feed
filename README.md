# ai-daily-pulse-feed

AI Daily Pulse 的中心化数据源仓库。每天 UTC 00:00（北京时间 08:00）自动运行，生成 `feed.json`。

## 数据来源

- **RSS**：18 个 AI/产品工具博客，过滤过去 24 小时内的 AI 相关文章
- **Serper**：补充当天 AI 热点（模型发布、产品更新）
- **NewsAPI**：补充当天 AI 热点（与 Serper 互补）
- **Product Hunt**：昨日热门产品 Top 3

## Feed 地址

```
https://raw.githubusercontent.com/{你的用户名}/ai-daily-pulse-feed/main/feed.json
```

## 本地测试

```bash
export SERPER_API_KEY=your_key
export NEWS_API_KEY=your_key
export PRODUCT_HUNT_TOKEN=your_token
node scripts/generate-feed.js
```

## GitHub Secrets 配置

在仓库 Settings → Secrets and variables → Actions 中添加：

| Secret 名称 | 说明 |
|---|---|
| `SERPER_API_KEY` | Serper API key |
| `NEWS_API_KEY` | NewsAPI key |
| `PRODUCT_HUNT_TOKEN` | Product Hunt API token |
