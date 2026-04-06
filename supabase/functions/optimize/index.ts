import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

interface FailedQuerySuggestion {
  url: string;
  title: string;
  reason: string;
}

function extractTitleWords(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-zäöåü0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w: string) => w.length >= 3)
    .slice(0, 5)
    .join(" ");
}

// AI: match zero-result queries to existing pages & create synonyms
async function suggestPagesForFailedQueries(
  supabase: ReturnType<typeof createClient>,
  siteId: string,
  failedQueries: { query: string; count: number }[],
): Promise<{ suggestions: Record<string, FailedQuerySuggestion[]>; synonymsCreated: number }> {
  if (!LOVABLE_API_KEY || failedQueries.length === 0) {
    return { suggestions: {}, synonymsCreated: 0 };
  }

  const { data: pages } = await supabase
    .from("pages")
    .select("url, title, meta_description")
    .eq("site_id", siteId)
    .not("title", "is", null);

  if (!pages?.length) return { suggestions: {}, synonymsCreated: 0 };

  const pageList = pages
    .map((p: any, i: number) => `${i + 1}. "${p.title}" — ${p.url}${p.meta_description ? ` (${String(p.meta_description).slice(0, 80)})` : ""}`)
    .join("\n");

  const queries = failedQueries.slice(0, 20).map((q) => q.query);

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You are a search optimization assistant. You'll receive search queries that returned no results, and all pages on a site.

For each query, suggest 1-2 pages that could be relevant matches. Consider semantic similarity, products/services matching the intent, and category pages.

Respond using the suggest_pages tool.`,
        },
        {
          role: "user",
          content: `Failed search queries:\n${queries.map((q, i) => `${i + 1}. "${q}"`).join("\n")}\n\nAvailable pages:\n${pageList}`,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "suggest_pages",
            description: "Suggest matching pages for failed search queries",
            parameters: {
              type: "object",
              properties: {
                matches: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                      suggestions: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            url: { type: "string" },
                            title: { type: "string" },
                            reason: { type: "string" },
                          },
                          required: ["url", "title", "reason"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["query", "suggestions"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["matches"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "suggest_pages" } },
    }),
  });

  if (!aiRes.ok) throw new Error(`Failed-query AI analysis failed: ${aiRes.status}`);

  const aiData = await aiRes.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  const suggestions: Record<string, FailedQuerySuggestion[]> = {};
  let synonymsCreated = 0;

  if (!toolCall?.function?.arguments) return { suggestions, synonymsCreated };

  const parsed = JSON.parse(toolCall.function.arguments);
  for (const match of parsed.matches || []) {
    if (!match.suggestions?.length) continue;
    suggestions[match.query] = match.suggestions;

    // Create synonyms from AI suggestions
    for (const suggestion of match.suggestions) {
      const titleWords = extractTitleWords(suggestion.title || "");
      const queryNorm = String(match.query || "").trim().toLowerCase();
      if (!titleWords || !queryNorm) continue;

      const { data: existing } = await supabase
        .from("search_synonyms")
        .select("id, confidence, times_used")
        .eq("site_id", siteId)
        .eq("query_from", queryNorm)
        .eq("query_to", titleWords)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("search_synonyms")
          .update({
            confidence: Math.min((existing as any).confidence * 0.7 + 0.6 * 0.3, 1.0),
            times_used: (existing as any).times_used + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", (existing as any).id);
      } else {
        await supabase
          .from("search_synonyms")
          .insert({
            site_id: siteId,
            query_from: queryNorm,
            query_to: titleWords,
            confidence: 0.6,
          });
        synonymsCreated++;
      }
    }
  }

  return { suggestions, synonymsCreated };
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
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    log.push(`Optimization started at ${now.toISOString()}`);

    // 1. Gather data
    const { data: searchLogs } = await supabase
      .from("search_logs")
      .select("query, results_count, clicked, created_at")
      .eq("site_id", site_id)
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(2000);

    log.push(`Search logs (30d): ${searchLogs?.length || 0}`);

    const { data: clickData } = await supabase
      .from("search_clicks")
      .select("query, page_url, click_count")
      .eq("site_id", site_id)
      .order("click_count", { ascending: false })
      .limit(500);

    log.push(`Click records: ${clickData?.length || 0}`);

    // 2. Analyze search patterns
    const queryStats: Record<string, { total: number; clicked: number; zeroResults: number }> = {};
    for (const l of searchLogs || []) {
      const q = (l as any).query.trim().toLowerCase();
      if (!queryStats[q]) queryStats[q] = { total: 0, clicked: 0, zeroResults: 0 };
      queryStats[q].total++;
      if ((l as any).clicked) queryStats[q].clicked++;
      if ((l as any).results_count === 0) queryStats[q].zeroResults++;
    }

    const zeroResultQueries = Object.entries(queryStats)
      .filter(([, s]) => s.zeroResults > 0)
      .sort((a, b) => b[1].zeroResults - a[1].zeroResults)
      .slice(0, 20)
      .map(([q, s]) => ({ query: q, count: s.zeroResults }));

    // High-CTR patterns from click data (pure data, no AI needed)
    const highCtrPatterns: HighCtrPattern[] = [];
    if (clickData) {
      const queryClicks: Record<string, { url: string; clicks: number }[]> = {};
      for (const c of clickData) {
        const q = (c as any).query;
        if (!queryClicks[q]) queryClicks[q] = [];
        queryClicks[q].push({ url: (c as any).page_url, clicks: (c as any).click_count });
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
    log.push(`Zero-result queries: ${zeroResultQueries.length}`);

    // 3. AI: analyze failed queries and create synonyms
    let failedQuerySuggestions: Record<string, FailedQuerySuggestion[]> = {};
    let failedQuerySynonymsCreated = 0;
    if (zeroResultQueries.length > 0) {
      try {
        const result = await suggestPagesForFailedQueries(supabase, site_id, zeroResultQueries);
        failedQuerySuggestions = result.suggestions;
        failedQuerySynonymsCreated = result.synonymsCreated;
        log.push(`AI page matches: ${Object.keys(failedQuerySuggestions).length}`);
        log.push(`Synonyms created: ${failedQuerySynonymsCreated}`);
      } catch (err) {
        log.push(`AI analysis skipped: ${(err as Error).message}`);
      }
    }

    // 4. Write to DB (only data-driven fields, no AI-generated "strategy" text)
    const strategyData = {
      site_id,
      high_ctr_patterns: highCtrPatterns.slice(0, 50),
      failed_query_suggestions: failedQuerySuggestions,
      last_optimized_at: now.toISOString(),
      optimization_log: log.join("\n"),
    };

    const { data: existing } = await supabase
      .from("site_search_strategy")
      .select("id")
      .eq("site_id", site_id)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("site_search_strategy")
        .update(strategyData)
        .eq("id", (existing as any).id);
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
      suggestions: failedQuerySuggestions,
      synonyms_created: failedQuerySynonymsCreated,
      log,
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
