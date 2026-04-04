const BASE = import.meta.env.VITE_API_URL || "";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
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

export interface Site {
  id: number;
  name: string;
  domain: string;
  sitemap_url: string;
  api_key: string;
  is_active: boolean;
  page_count: number;
  last_crawled_at: string | null;
}

export interface CrawlJob {
  job_id: number;
  status: string;
  pages_found: number;
  pages_indexed: number;
  error: string | null;
}

export interface SearchResult {
  url: string;
  title: string;
  score: number;
  snippet: string;
  reasoning: string;
}

export interface SearchResponse {
  results: SearchResult[];
  language: string;
  response_ms: number;
  fallback_message?: string;
  error?: string;
}

export interface SiteStats {
  total_searches: number;
  searches_last_7d: number;
  click_through_rate: number;
  avg_results_per_search: number;
  pages_indexed: number;
  top_queries: { query: string; count: number }[];
  failed_searches: { query: string; count: number }[];
}

export const api = {
  listSites: () => req<Site[]>("GET", "/api/sites"),
  getSite: (id: number | string) => req<Site>("GET", `/api/sites/${id}`),
  createSite: (data: { name: string; domain: string; sitemap_url?: string }) =>
    req<Site>("POST", "/api/sites", data),

  triggerCrawl: (siteId: number, sitemapUrl?: string) =>
    req<CrawlJob>("POST", "/api/crawl", { site_id: siteId, sitemap_url: sitemapUrl || undefined }),
  getCrawlJob: (jobId: number) => req<CrawlJob>("GET", `/api/crawl/${jobId}`),

  getStats: (siteId: number | string) => req<SiteStats>("GET", `/api/sites/${siteId}/stats`),

  setupDemo: () => req<Site>("GET", "/api/demo/setup"),

  search: (siteId: number | string, query: string) =>
    req<SearchResponse>("POST", "/api/search", { site_id: Number(siteId), query, max_results: 5 }),
};
