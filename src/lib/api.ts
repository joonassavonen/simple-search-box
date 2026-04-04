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
    // Get pages count
    const { count: pagesIndexed } = await supabase
      .from("pages")
      .select("*", { count: "exact", head: true })
      .eq("site_id", siteId);

    // Get all search logs for this site
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

    // Top queries (last 30 days)
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
    // Create a demo site
    const site = await api.createSite({
      name: "Demo Site",
      domain: "demo.example.com",
      sitemap_url: "https://demo.example.com/sitemap.xml",
    });
    return site;
  },

  async search(siteId: string, query: string): Promise<SearchResponse> {
    const start = Date.now();
    
    // Simple text search on pages content/title
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

    // Log the search
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
};
