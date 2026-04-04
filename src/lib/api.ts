import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Backend API URL — set via env var or defaults to localhost
// ---------------------------------------------------------------------------

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

async function backendFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BACKEND_URL}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || body.error || `Backend error ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Site {
  id: string;
  name: string;
  domain: string;
  sitemap_url: string | null;
  api_key: string;
  is_active: boolean;
  page_count: number;
  last_crawled_at: string | null;
}

export interface CrawlJob {
  job_id: string;
  status: string;
  pages_found: number;
  pages_indexed: number;
  error: string | null;
}

export interface SchemaData {
  type: string;
  name?: string;
  description?: string;
  price?: string | number;
  currency?: string;
  availability?: string;
  image?: string;
  rating?: number;
  reviewCount?: number;
  datePublished?: string;
  author?: string;
  startDate?: string;
  location?: string;
  questions?: { q: string; a: string }[];
}

export interface SearchResult {
  url: string;
  title: string;
  score: number;
  snippet: string;
  reasoning: string;
  schema_data?: SchemaData | null;
}

export interface SearchResponse {
  results: SearchResult[];
  language: string;
  response_ms: number;
  fallback_message?: string;
  search_log_id?: number;
  contact_config?: ContactConfig | null;
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

export interface ContactConfig {
  site_id: string;
  enabled: boolean;
  email: string | null;
  phone: string | null;
  chat_url: string | null;
  cta_text_fi: string;
  cta_text_en: string;
}

export interface TrendingItem {
  query: string;
  count: number;
}

export interface LearningStats {
  site_id: string;
  boost_pairs: number;
  synonym_count: number;
  top_boosted: { url: string; query: string; clicks: number; ctr: number; boost: number }[];
  position_clicks: { position: number; clicks: number }[];
}

// ---------------------------------------------------------------------------
// API object — uses backend fetch for search/crawl/learning, Supabase for CRUD
// ---------------------------------------------------------------------------

export const api = {
  // --- Sites (Supabase direct) ---

  async listSites(): Promise<Site[]> {
    const { data, error } = await supabase
      .from("sites")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data as Site[];
  },

  async getSite(id: string): Promise<Site> {
    const { data, error } = await supabase
      .from("sites")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data as Site;
  },

  async createSite(input: { name: string; domain: string; sitemap_url?: string }): Promise<Site> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data, error } = await supabase
      .from("sites")
      .insert({
        name: input.name,
        domain: input.domain,
        sitemap_url: input.sitemap_url || null,
        user_id: user.id,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Site;
  },

  // --- Crawl (Backend fetch) ---

  async triggerCrawl(siteId: string, sitemapUrl?: string): Promise<CrawlJob> {
    // Create the job record
    const { data, error } = await supabase
      .from("crawl_jobs")
      .insert({ site_id: siteId, status: "pending" })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Fire-and-forget: invoke the crawl edge function in the background
    supabase.functions.invoke("crawl", {
      body: { job_id: data.id, site_id: siteId },
    }).catch((err) => console.error("Background crawl invocation failed:", err));

    return {
      job_id: data.id,
      status: data.status,
      pages_found: data.pages_found,
      pages_indexed: data.pages_indexed,
      error: data.error,
    };
  },

  async getCrawlJob(jobId: string): Promise<CrawlJob> {
    const { data, error } = await supabase
      .from("crawl_jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    if (error) throw new Error(error.message);
    return {
      job_id: data.id,
      status: data.status,
      pages_found: data.pages_found,
      pages_indexed: data.pages_indexed,
      error: data.error,
    };
  },

  // --- Search (Backend fetch — TF-IDF + Claude re-ranking) ---

  async search(siteId: string, query: string): Promise<SearchResponse> {
    // TODO: migrate to edge function
    console.warn("Search not yet implemented on backend");
    return { results: [], language: "en", response_ms: 0, fallback_message: "Search not yet configured. Please set up crawling first." };
  },

  // --- Stats (Supabase direct) ---

  async getStats(siteId: string): Promise<SiteStats> {
    const { count: pagesIndexed } = await supabase
      .from("pages")
      .select("*", { count: "exact", head: true })
      .eq("site_id", siteId);

    const { data: allLogs } = await supabase
      .from("search_logs")
      .select("*")
      .eq("site_id", siteId);

    const logs = allLogs || [];
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recentLogs = logs.filter((l) => new Date(l.created_at) >= sevenDaysAgo);
    const clickedCount = logs.filter((l) => l.clicked).length;

    const last30 = logs.filter((l) => new Date(l.created_at) >= thirtyDaysAgo);
    const queryCounts: Record<string, number> = {};
    const failedCounts: Record<string, number> = {};
    for (const l of last30) {
      queryCounts[l.query] = (queryCounts[l.query] || 0) + 1;
      if (l.results_count === 0) {
        failedCounts[l.query] = (failedCounts[l.query] || 0) + 1;
      }
    }

    const topQueries = Object.entries(queryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([query, count]) => ({ query, count }));

    const failedSearches = Object.entries(failedCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([query, count]) => ({ query, count }));

    const avgResults = logs.length > 0
      ? logs.reduce((sum, l) => sum + l.results_count, 0) / logs.length
      : 0;

    return {
      total_searches: logs.length,
      searches_last_7d: recentLogs.length,
      click_through_rate: logs.length > 0 ? clickedCount / logs.length : 0,
      avg_results_per_search: avgResults,
      pages_indexed: pagesIndexed || 0,
      top_queries: topQueries,
      failed_searches: failedSearches,
    };
  },

  // --- Demo (Backend fetch) ---

  async setupDemo(): Promise<Site> {
    // TODO: migrate to edge function
    throw new Error("Demo setup not yet available");
  },

  async getTrending(siteId: string, limit = 5): Promise<{ trending: TrendingItem[] }> {
    // TODO: migrate to edge function
    return { trending: [] };
  },

  async getSuggestions(siteId: string, query: string, limit = 5): Promise<{ suggestions: string[] }> {
    // TODO: migrate to edge function
    return { suggestions: [] };
  },

  // --- Contact Config (Backend fetch) ---

  async getContactConfig(siteId: string): Promise<ContactConfig> {
    // TODO: migrate to edge function or DB table
    return {
      site_id: siteId,
      enabled: false,
      email: null,
      phone: null,
      chat_url: null,
      cta_text_fi: "Ota yhteyttä",
      cta_text_en: "Contact us",
    };
  },

  async updateContactConfig(siteId: string, config: Partial<ContactConfig>): Promise<ContactConfig> {
    // TODO: migrate to edge function or DB table
    console.warn("updateContactConfig not yet implemented on backend");
    return { site_id: siteId, enabled: false, email: null, phone: null, chat_url: null, cta_text_fi: "", cta_text_en: "", ...config } as ContactConfig;
  },

  // --- Learning Stats (Backend fetch) ---

  async getLearningStats(siteId: string): Promise<LearningStats> {
    // TODO: migrate to edge function
    return { site_id: siteId, boost_pairs: 0, synonym_count: 0, top_boosted: [], position_clicks: [] };
  },

  async discoverSynonyms(siteId: string): Promise<{ discovered: number }> {
    // TODO: migrate to edge function
    return { discovered: 0 };
  },

  async trackClick(searchLogId: number, clickedUrl: string, clickPosition?: number, sessionId?: string): Promise<void> {
    // TODO: migrate to edge function
    console.warn("trackClick not yet implemented");
  },
};
