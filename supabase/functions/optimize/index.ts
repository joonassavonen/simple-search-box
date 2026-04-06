import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Optimize Edge Function — Background AI Agent
 *
 * Analyzes CTR, conversion data, and search patterns for a site.
 * Writes an optimization strategy to `site_search_strategy` that the
 * search edge function reads at query time to:
 *   - Dynamically adjust the AI re-ranking prompt
 *   - Decide when to show contact CTAs (phone/WhatsApp/email buttons)
 *   - Prioritize high-converting pages
 *
 * Invoke: supabase.functions.invoke("optimize", { body: { site_id } })
 * Recommended: run daily or after significant data changes.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

interface HighCtrPattern {
  pattern: string;
  top_url: string;
  ctr: number;
  clicks: number;
}

interface ContactTriggerRules {
  show_on_zero_results: boolean;
  show_on_low_ctr_queries: boolean;
  low_ctr_threshold: number;
  trigger_categories: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { site_id } = await req.json();
    if (!site_id) {
      return new Response(JSON.stringify({ error: "site_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const log: string[] = [];
    const now = new Date();

    log.push(`Optimization started at ${now.toISOString()}`);

    // -----------------------------------------------------------------------
    // 1. Gather data
    // -----------------------------------------------------------------------

    // Search logs (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: searchLogs } = await supabase
      .from("search_logs")
      .select("query, results_count, clicked, created_at")
      .eq("site_id", site_id)
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(2000);

    log.push(`Search logs (30d): ${searchLogs?.length || 0}`);

    // Click data
    const { data: clickData } = await supabase
      .from("search_clicks")
      .select("query, page_url, click_count")
      .eq("site_id", site_id)
      .order("click_count", { ascending: false })
      .limit(500);

    log.push(`Click records: ${clickData?.length || 0}`);

    // GA analytics
    const { data: gaData } = await supabase
      .from("page_analytics")
      .select("page_path, pageviews, conversions, conversion_rate")
      .eq("site_id", site_id)
      .order("conversions", { ascending: false })
      .limit(200);

    log.push(`GA analytics rows: ${gaData?.length || 0}`);

    // Contact config
    const { data: contactConfig } = await supabase
      .from("site_contact_configs")
      .select("enabled, email, phone, chat_url")
      .eq("site_id", site_id)
      .single();

    const hasContactMethods = contactConfig &&
      contactConfig.enabled &&
      (contactConfig.phone || contactConfig.email || contactConfig.chat_url);

    log.push(`Contact config: ${hasContactMethods ? "active" : "not configured"}`);

    // -----------------------------------------------------------------------
    // 2. Analyze search patterns
    // -----------------------------------------------------------------------

    // Query-level stats
    const queryStats: Record<string, { total: number; clicked: number; zeroResults: number }> = {};
    for (const l of searchLogs || []) {
      const q = l.query.trim().toLowerCase();
      if (!queryStats[q]) queryStats[q] = { total: 0, clicked: 0, zeroResults: 0 };
      queryStats[q].total++;
      if (l.clicked) queryStats[q].clicked++;
      if (l.results_count === 0) queryStats[q].zeroResults++;
    }

    // Find low-CTR queries (searched often but rarely clicked)
    const lowCtrQueries = Object.entries(queryStats)
      .filter(([, s]) => s.total >= 3 && (s.clicked / s.total) < 0.1)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 20)
      .map(([q, s]) => ({ query: q, searches: s.total, ctr: s.clicked / s.total }));

    log.push(`Low-CTR queries: ${lowCtrQueries.length}`);

    // Find zero-result queries
    const zeroResultQueries = Object.entries(queryStats)
      .filter(([, s]) => s.zeroResults > 0)
      .sort((a, b) => b[1].zeroResults - a[1].zeroResults)
      .slice(0, 20)
      .map(([q, s]) => ({ query: q, count: s.zeroResults }));

    log.push(`Zero-result queries: ${zeroResultQueries.length}`);

    // High-CTR patterns (query → URL pairs that convert well)
    const highCtrPatterns: HighCtrPattern[] = [];
    if (clickData) {
      // Group by query, find best URL
      const queryClicks: Record<string, { url: string; clicks: number }[]> = {};
      for (const c of clickData) {
        if (!queryClicks[c.query]) queryClicks[c.query] = [];
        queryClicks[c.query].push({ url: c.page_url, clicks: c.click_count });
      }

      for (const [query, urls] of Object.entries(queryClicks)) {
        const totalClicks = urls.reduce((sum, u) => sum + u.clicks, 0);
        const searches = queryStats[query]?.total || totalClicks;
        const bestUrl = urls.sort((a, b) => b.clicks - a.clicks)[0];
        const ctr = searches > 0 ? totalClicks / searches : 0;

        if (totalClicks >= 3 && ctr >= 0.2) {
          highCtrPatterns.push({
            pattern: query,
            top_url: bestUrl.url,
            ctr: Math.round(ctr * 100) / 100,
            clicks: totalClicks,
          });
        }
      }
      highCtrPatterns.sort((a, b) => b.clicks - a.clicks);
    }

    log.push(`High-CTR patterns: ${highCtrPatterns.length}`);

    // Top converting pages from GA
    const topConverters = (gaData || [])
      .filter(g => g.conversions > 0)
      .slice(0, 10)
      .map(g => ({
        path: g.page_path,
        conversions: g.conversions,
        rate: g.conversion_rate,
        views: g.pageviews,
      }));

    log.push(`Top converting pages: ${topConverters.length}`);

    // -----------------------------------------------------------------------
    // 3. AI agent: generate strategy based on data
    // -----------------------------------------------------------------------

    let promptAdditions = "";
    let conversionInsights = "";
    let contactTriggerRules: ContactTriggerRules = {
      show_on_zero_results: true,
      show_on_low_ctr_queries: !!hasContactMethods,
      low_ctr_threshold: 0.1,
      trigger_categories: [],
    };

    if (LOVABLE_API_KEY && (searchLogs?.length || 0) >= 10) {
      try {
        const dataContext = JSON.stringify({
          total_searches_30d: searchLogs?.length || 0,
          unique_queries: Object.keys(queryStats).length,
          avg_ctr: searchLogs?.length
            ? (searchLogs.filter(l => l.clicked).length / searchLogs.length * 100).toFixed(1) + "%"
            : "0%",
          low_ctr_queries: lowCtrQueries.slice(0, 10),
          zero_result_queries: zeroResultQueries.slice(0, 10),
          high_ctr_patterns: highCtrPatterns.slice(0, 10),
          top_converting_pages: topConverters,
          has_contact_methods: !!hasContactMethods,
        }, null, 2);

        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              {
                role: "system",
                content: `You are a search optimization agent for a website's internal search engine.
Analyze the search data and produce an optimization strategy as JSON.

Your output MUST be valid JSON with these fields:
{
  "prompt_additions": "Extra instructions to add to the search AI's system prompt to improve results. Focus on patterns you see in the data. Max 200 words. Write in Finnish if the queries are mostly Finnish.",
  "contact_trigger_rules": {
    "show_on_zero_results": true/false,
    "show_on_low_ctr_queries": true/false,
    "low_ctr_threshold": 0.0-1.0,
    "trigger_categories": ["category keywords that should trigger contact CTA, e.g. 'hinnat','tarjous','asennus'"]
  },
  "conversion_insights": "Brief summary of conversion patterns and recommendations. Max 150 words."
}

Guidelines:
- If low-CTR queries suggest users can't find what they need → recommend showing contact buttons
- If zero-result queries cluster around topics → add prompt instructions to handle those topics
- If high-CTR patterns exist → add prompt instructions to prioritize those URL patterns
- If top converting pages exist → add prompt instructions to favor those pages for relevant queries
- contact_trigger_rules.trigger_categories should contain query keywords/topics where showing contact buttons would help conversion (e.g. pricing, quotes, installation, support)
- Be conservative: only trigger contact CTAs when genuinely helpful, not on every search

Return ONLY valid JSON, no markdown.`
              },
              {
                role: "user",
                content: `Search analytics data:\n${dataContext}`
              }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || "";
          const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const strategy = JSON.parse(jsonStr);

          promptAdditions = strategy.prompt_additions || "";
          conversionInsights = strategy.conversion_insights || "";

          if (strategy.contact_trigger_rules) {
            contactTriggerRules = {
              show_on_zero_results: strategy.contact_trigger_rules.show_on_zero_results ?? true,
              show_on_low_ctr_queries: strategy.contact_trigger_rules.show_on_low_ctr_queries ?? false,
              low_ctr_threshold: strategy.contact_trigger_rules.low_ctr_threshold ?? 0.1,
              trigger_categories: strategy.contact_trigger_rules.trigger_categories || [],
            };
          }

          log.push("AI strategy generated successfully");
        } else {
          log.push(`AI gateway error: ${aiResponse.status}`);
        }
      } catch (aiErr) {
        log.push(`AI strategy generation failed: ${(aiErr as Error).message}`);
      }
    } else {
      // Fallback: rule-based strategy without AI
      if (zeroResultQueries.length > 5) {
        promptAdditions += "Monet haut eivät tuota tuloksia. Yritä löytää osittaisia vastaavuuksia ja ehdota vaihtoehtoisia hakusanoja.";
      }
      if (topConverters.length > 0) {
        const paths = topConverters.slice(0, 3).map(p => p.path).join(", ");
        promptAdditions += ` Sivuston parhaiten konvertoivat sivut: ${paths}. Priorisoi näitä relevanteille hauille.`;
      }
      conversionInsights = `${Object.keys(queryStats).length} uniikkia hakua, ${zeroResultQueries.length} nollatuloshakua, ${highCtrPatterns.length} korkean CTR:n mallia.`;
      log.push("Rule-based strategy generated (no AI key or insufficient data)");
    }

    // -----------------------------------------------------------------------
    // 4. Write strategy to DB
    // -----------------------------------------------------------------------

    const strategyData = {
      site_id,
      prompt_additions: promptAdditions,
      contact_trigger_rules: contactTriggerRules,
      high_ctr_patterns: highCtrPatterns.slice(0, 50),
      conversion_insights: conversionInsights,
      last_optimized_at: now.toISOString(),
      optimization_log: log.join("\n"),
    };

    // Upsert (one strategy per site)
    const { data: existing } = await supabase
      .from("site_search_strategy")
      .select("id")
      .eq("site_id", site_id)
      .single();

    if (existing) {
      await supabase
        .from("site_search_strategy")
        .update(strategyData)
        .eq("id", existing.id);
    } else {
      await supabase
        .from("site_search_strategy")
        .insert(strategyData);
    }

    log.push("Strategy written to DB");

    return new Response(JSON.stringify({
      message: "Optimization complete",
      searches_analyzed: searchLogs?.length || 0,
      high_ctr_patterns: highCtrPatterns.length,
      zero_result_queries: zeroResultQueries.length,
      low_ctr_queries: lowCtrQueries.length,
      contact_triggers_active: contactTriggerRules.show_on_zero_results || contactTriggerRules.show_on_low_ctr_queries,
      prompt_additions_length: promptAdditions.length,
      log: log,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Optimize error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
