import { supabase } from "@/integrations/supabase/client";

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

export const api = {
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

  async triggerCrawl(siteId: string, _sitemapUrl?: string): Promise<CrawlJob> {
    const { data, error } = await supabase
      .from("crawl_jobs")
      .insert({ site_id: siteId })
      .select()
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

  async setupDemo(): Promise<Site> {
    const site = await api.createSite({
      name: "Demo Site",
      domain: "demo.example.com",
      sitemap_url: "https://demo.example.com/sitemap.xml",
    });
    return site;
  },

  async search(siteId: string, query: string): Promise<SearchResponse> {
    const start = Date.now();

    const { data: pages } = await supabase
      .from("pages")
      .select("url, title, content")
      .eq("site_id", siteId)
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .limit(5);

    const responseMs = Date.now() - start;
    const results: SearchResult[] = (pages || []).map((p) => ({
      url: p.url,
      title: p.title || p.url,
      score: 0.7,
      snippet: p.content?.substring(0, 200) || "",
      reasoning: "Text match",
    }));

    await supabase.from("search_logs").insert({
      site_id: siteId,
      query,
      results_count: results.length,
      language: /[äöåÄÖÅ]/.test(query) ? "fi" : "en",
      response_ms: responseMs,
    });

    return {
      results,
      language: /[äöåÄÖÅ]/.test(query) ? "fi" : "en",
      response_ms: responseMs,
      fallback_message: results.length === 0 ? "No results found. Try a different query." : undefined,
    };
  },

  // --- Learning features ---

  async getContactConfig(siteId: string): Promise<ContactConfig> {
    const { data, error } = await supabase
      .from("site_contact_configs")
      .select("*")
      .eq("site_id", siteId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data || {
      site_id: siteId,
      enabled: false,
      email: null,
      phone: null,
      chat_url: null,
      cta_text_fi: "Etkö löytänyt etsimääsi? Ota yhteyttä!",
      cta_text_en: "Didn't find what you need? Contact us!",
    };
  },

  async updateContactConfig(siteId: string, config: Partial<ContactConfig>): Promise<ContactConfig> {
    const { data, error } = await supabase
      .from("site_contact_configs")
      .upsert({ site_id: siteId, ...config }, { onConflict: "site_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ContactConfig;
  },

  async getTrending(siteId: string, limit = 5): Promise<{ trending: TrendingItem[] }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("search_logs")
      .select("query")
      .eq("site_id", siteId)
      .gte("created_at", sevenDaysAgo);

    const counts: Record<string, number> = {};
    for (const log of data || []) {
      const q = log.query.toLowerCase();
      counts[q] = (counts[q] || 0) + 1;
    }

    const trending = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));

    return { trending };
  },

  async getLearningStats(siteId: string): Promise<LearningStats> {
    const { count: boostPairs } = await supabase
      .from("query_url_boosts")
      .select("*", { count: "exact", head: true })
      .eq("site_id", siteId);

    const { count: synonymCount } = await supabase
      .from("learned_synonyms")
      .select("*", { count: "exact", head: true })
      .eq("site_id", siteId);

    return {
      site_id: siteId,
      boost_pairs: boostPairs || 0,
      synonym_count: synonymCount || 0,
      top_boosted: [],
      position_clicks: [],
    };
  },

  async discoverSynonyms(_siteId: string): Promise<{ discovered: number }> {
    // Synonym discovery runs server-side; this is a placeholder
    return { discovered: 0 };
  },
};
