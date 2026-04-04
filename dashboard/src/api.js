/**
 * API client for FindAI backend.
 * Base URL auto-detected: uses /api (proxied via Vite) in dev, or env var in prod.
 */

const BASE = import.meta.env.VITE_API_URL || "";

async function req(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  // Sites
  listSites: () => req("GET", "/api/sites"),
  getSite: (id) => req("GET", `/api/sites/${id}`),
  createSite: (data) => req("POST", "/api/sites", data),

  // Crawl
  triggerCrawl: (siteId, sitemapUrl) =>
    req("POST", "/api/crawl", { site_id: siteId, sitemap_url: sitemapUrl || undefined }),
  getCrawlJob: (jobId) => req("GET", `/api/crawl/${jobId}`),

  // Stats
  getStats: (siteId) => req("GET", `/api/sites/${siteId}/stats`),

  // Demo
  setupDemo: () => req("GET", "/api/demo/setup"),

  // Search (for preview)
  search: (siteId, query) =>
    req("POST", "/api/search", { site_id: siteId, query, max_results: 5 }),
};
