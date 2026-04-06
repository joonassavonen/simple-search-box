import { supabase } from "@/integrations/supabase/client";

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
  brand_color: string | null;
  brand_font: string | null;
  brand_bg_color: string | null;
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
  ai_summary?: string;
  suggestions?: string[];
  error?: string;
}

export interface DailyMetric {
  date: string;
  searches: number;
  clicks: number;
  no_results: number;
  click_rate: number;
}

export interface SiteStats {
  total_searches: number;
  searches_last_7d: number;
  click_through_rate: number;
  avg_results_per_search: number;
  pages_indexed: number;
  top_queries: { query: string; count: number }[];
  failed_searches: { query: string; count: number }[];
  no_click_queries: { query: string; count: number }[];
  daily: DailyMetric[];
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
  page_path?: string;
  title?: string;
  growth?: number; // weighted growth score
}

export interface LearningStats {
  site_id: string;
  boost_pairs: number;
  synonym_count: number;
  total_learned_clicks: number;
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

  async deleteSite(id: string): Promise<void> {
    const { error } = await supabase.from("sites").delete().eq("id", id);
    if (error) throw new Error(error.message);
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

  async resumeCrawl(siteId: string, previousJobId: string): Promise<CrawlJob> {
    const { data, error } = await supabase
      .from("crawl_jobs")
      .insert({ site_id: siteId, status: "pending" })
      .select()
      .single();
    if (error) throw new Error(error.message);

    supabase.functions.invoke("crawl", {
      body: { job_id: data.id, site_id: siteId, resume_from_job: previousJobId },
    }).catch((err) => console.error("Background resume crawl failed:", err));

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
    const { data, error } = await supabase.functions.invoke("search", {
      body: { site_id: siteId, query },
    });
    if (error) throw new Error(error.message || "Search failed");
    return data as SearchResponse;
  },

  // --- Stats (Supabase direct) ---

  async getStats(siteId: string, days: number = 30): Promise<SiteStats> {
    const { count: pagesIndexed } = await supabase
      .from("pages")
      .select("*", { count: "exact", head: true })
      .eq("site_id", siteId);

    const now = new Date();
    const periodAgo = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { data: allLogs } = await supabase
      .from("search_logs")
      .select("*")
      .eq("site_id", siteId)
      .gte("created_at", periodAgo.toISOString());

    const logs = allLogs || [];
    const recentLogs = logs.filter((l) => new Date(l.created_at) >= sevenDaysAgo);
    const clickedCount = logs.filter((l) => l.clicked).length;

    const queryCounts: Record<string, number> = {};
    const failedCounts: Record<string, number> = {};
    const noClickCounts: Record<string, number> = {};
    const clickedQueries = new Set<string>();

    for (const l of logs) {
      queryCounts[l.query] = (queryCounts[l.query] || 0) + 1;
      if (l.results_count === 0) {
        failedCounts[l.query] = (failedCounts[l.query] || 0) + 1;
      }
      if (l.clicked) {
        clickedQueries.add(l.query);
      }
    }

    for (const l of logs) {
      if (l.results_count > 0 && !clickedQueries.has(l.query)) {
        noClickCounts[l.query] = (noClickCounts[l.query] || 0) + 1;
      }
    }

    const topQueries = Object.entries(queryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([query, count]) => ({ query, count }));

    const failedSearches = Object.entries(failedCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([query, count]) => ({ query, count }));

    const noClickQueries = Object.entries(noClickCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([query, count]) => ({ query, count }));

    const avgResults = logs.length > 0
      ? logs.reduce((sum, l) => sum + l.results_count, 0) / logs.length
      : 0;

    // Build daily time series
    const dailyMap: Record<string, { searches: number; clicks: number; no_results: number }> = {};
    for (let d = 0; d < days; d++) {
      const date = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
      const key = date.toISOString().slice(0, 10);
      dailyMap[key] = { searches: 0, clicks: 0, no_results: 0 };
    }
    for (const l of logs) {
      const key = l.created_at.slice(0, 10);
      if (dailyMap[key]) {
        dailyMap[key].searches++;
        if (l.clicked) dailyMap[key].clicks++;
        if (l.results_count === 0) dailyMap[key].no_results++;
      }
    }
    const daily: import("./api").DailyMetric[] = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        searches: d.searches,
        clicks: d.clicks,
        no_results: d.no_results,
        click_rate: d.searches > 0 ? Math.round((d.clicks / d.searches) * 100) : 0,
      }));

    return {
      total_searches: logs.length,
      searches_last_7d: recentLogs.length,
      click_through_rate: logs.length > 0 ? clickedCount / logs.length : 0,
      avg_results_per_search: avgResults,
      pages_indexed: pagesIndexed || 0,
      top_queries: topQueries,
      failed_searches: failedSearches,
      no_click_queries: noClickQueries,
      daily,
    };
  },


  // --- Trending (GA4 growth-based, falls back to search logs) ---

  async getTrending(siteId: string, limit = 6): Promise<{ trending: TrendingItem[]; source: "ga" | "search_logs" }> {
    // Try GA-based trending first: compare current 30d vs previous 30d
    const now = new Date();
    const currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const previousStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const currentEnd = now.toISOString().slice(0, 10);
    const previousEnd = currentStart;

    const { data: gaData } = await supabase
      .from("page_analytics")
      .select("page_path, pageviews, period_start, period_end")
      .eq("site_id", siteId);

    if (gaData && gaData.length > 0) {
      // Group by page_path, split into current and previous period
      const current: Record<string, number> = {};
      const previous: Record<string, number> = {};

      for (const row of gaData) {
        const ps = row.period_start;
        if (ps >= currentStart && ps <= currentEnd) {
          current[row.page_path] = (current[row.page_path] || 0) + row.pageviews;
        } else if (ps >= previousStart && ps < currentStart) {
          previous[row.page_path] = (previous[row.page_path] || 0) + row.pageviews;
        }
      }

      // Need both periods to calculate growth
      const hasBothPeriods = Object.keys(current).length > 0 && Object.keys(previous).length > 0;

      if (hasBothPeriods) {
        // Calculate weighted growth: growth% × log(views)
        const growthScores: { path: string; views: number; growth: number; score: number }[] = [];

        for (const [path, views] of Object.entries(current)) {
          const prevViews = previous[path] || 0;
          const growthPct = prevViews > 0
            ? (views - prevViews) / prevViews
            : views > 5 ? 1.0 : 0; // New pages with >5 views get 100% growth
          const weightedScore = growthPct * Math.log(Math.max(views, 1) + 1);

          if (weightedScore > 0) {
            growthScores.push({ path, views, growth: growthPct, score: weightedScore });
          }
        }

        if (growthScores.length > 0) {
          growthScores.sort((a, b) => b.score - a.score);

          // Fetch page titles for the top paths
          const topPaths = growthScores.slice(0, limit).map(g => g.path);
          const { data: pages } = await supabase
            .from("pages")
            .select("url, title")
            .eq("site_id", siteId);

          const pathToTitle: Record<string, string> = {};
          if (pages) {
            for (const p of pages) {
              try {
                const pagePath = new URL(p.url).pathname;
                if (topPaths.includes(pagePath)) {
                  pathToTitle[pagePath] = p.title || p.url;
                }
              } catch { /* ignore */ }
            }
          }

          const trending: TrendingItem[] = growthScores.slice(0, limit).map(g => ({
            query: pathToTitle[g.path] || g.path,
            count: g.views,
            page_path: g.path,
            title: pathToTitle[g.path] || g.path,
            growth: Math.round(g.growth * 100),
          }));

          return { trending, source: "ga" };
        }
      }
    }

    // Fallback: search-log-based trending
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("search_logs")
      .select("query")
      .eq("site_id", siteId)
      .gte("created_at", sevenDaysAgo)
      .gt("results_count", 0);

    if (!data || data.length === 0) return { trending: [], source: "search_logs" };

    const counts: Record<string, number> = {};
    for (const row of data) {
      const q = row.query.trim().toLowerCase();
      if (q.length >= 2) counts[q] = (counts[q] || 0) + 1;
    }

    const trending = Object.entries(counts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));

    return { trending, source: "search_logs" };
  },

  // --- Suggestions (Supabase direct — prefix match on past queries) ---

  async getSuggestions(siteId: string, query: string, limit = 5): Promise<{ suggestions: string[] }> {
    const prefix = query.trim().toLowerCase();
    if (prefix.length < 2) return { suggestions: [] };

    const { data } = await supabase
      .from("search_logs")
      .select("query")
      .eq("site_id", siteId)
      .gt("results_count", 0)
      .ilike("query", `${prefix}%`)
      .limit(200);

    if (!data || data.length === 0) return { suggestions: [] };

    // Deduplicate and rank by frequency
    const counts: Record<string, number> = {};
    for (const row of data) {
      const q = row.query.trim().toLowerCase();
      if (q !== prefix && q.length >= 2) counts[q] = (counts[q] || 0) + 1;
    }

    const suggestions = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([q]) => q);

    return { suggestions };
  },

  // --- Contact Config (Supabase DB) ---

  async getContactConfig(siteId: string): Promise<ContactConfig> {
    const { data, error } = await (supabase as any)
      .from("site_contact_configs")
      .select("*")
      .eq("site_id", siteId)
      .single();

    if (error || !data) {
      return {
        site_id: siteId,
        enabled: false,
        email: null,
        phone: null,
        chat_url: null,
        cta_text_fi: "Etkö löytänyt etsimääsi? Ota yhteyttä!",
        cta_text_en: "Didn't find what you need? Contact us!",
      };
    }

    return {
      site_id: data.site_id,
      enabled: data.enabled,
      email: data.email,
      phone: data.phone,
      chat_url: data.chat_url,
      cta_text_fi: data.cta_text_fi,
      cta_text_en: data.cta_text_en,
    };
  },

  async updateContactConfig(siteId: string, config: Partial<ContactConfig>): Promise<ContactConfig> {
    const current = await api.getContactConfig(siteId);
    const updated = { ...current, ...config, site_id: siteId };

    // Upsert: try update first, then insert
    const { data: existing } = await (supabase as any)
      .from("site_contact_configs")
      .select("id")
      .eq("site_id", siteId)
      .single();

    if (existing) {
      const { error } = await (supabase as any)
        .from("site_contact_configs")
        .update({
          enabled: updated.enabled,
          email: updated.email,
          phone: updated.phone,
          chat_url: updated.chat_url,
          cta_text_fi: updated.cta_text_fi,
          cta_text_en: updated.cta_text_en,
        })
        .eq("site_id", siteId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (supabase as any)
        .from("site_contact_configs")
        .insert({
          site_id: siteId,
          enabled: updated.enabled,
          email: updated.email,
          phone: updated.phone,
          chat_url: updated.chat_url,
          cta_text_fi: updated.cta_text_fi,
          cta_text_en: updated.cta_text_en,
        });
      if (error) throw new Error(error.message);
    }

    return updated;
  },

  // --- Learning Stats (Supabase direct) ---

  async getLearningStats(siteId: string): Promise<LearningStats> {
    const { data: clicks } = await supabase
      .from("search_clicks")
      .select("query, page_url, click_count")
      .eq("site_id", siteId)
      .order("click_count", { ascending: false })
      .limit(20);

    const { data: synonyms } = await supabase
      .from("search_synonyms")
      .select("query_from, query_to, confidence")
      .eq("site_id", siteId);

    const totalClicks = (clicks || []).reduce((sum: number, c: any) => sum + (c.click_count || 0), 0);

    return {
      site_id: siteId,
      boost_pairs: clicks?.length || 0,
      synonym_count: synonyms?.length || 0,
      total_learned_clicks: totalClicks,
      top_boosted: (clicks || []).slice(0, 10).map((c: any) => ({
        url: c.page_url,
        query: c.query,
        clicks: c.click_count,
        ctr: 0,
        boost: c.click_count,
      })),
      position_clicks: [],
    };
  },

  async discoverSynonyms(siteId: string): Promise<{ discovered: number }> {
    const { data, error } = await supabase.functions.invoke("learn", {
      body: { site_id: siteId },
    });
    if (error) throw new Error(error.message || "Learning failed");
    return { discovered: data?.synonyms_created || 0 };
  },

  // --- Optimization (Background AI Agent) ---

  async runOptimization(siteId: string): Promise<{ message: string; [key: string]: any }> {
    const { data, error } = await supabase.functions.invoke("optimize", {
      body: { site_id: siteId },
    });
    if (error) throw new Error(error.message || "Optimization failed");
    return data;
  },

  // --- Click tracking ---

  async trackClick(siteId: string, query: string, clickedUrl: string): Promise<void> {
    await supabase.functions.invoke("search", {
      body: { action: "click", site_id: siteId, query, url: clickedUrl },
    });
  },
};
