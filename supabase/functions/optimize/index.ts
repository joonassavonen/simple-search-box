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

interface ContactTriggerRules {
  show_on_zero_results: boolean;
  show_on_low_ctr_queries: boolean;
  low_ctr_threshold: number;
  trigger_categories: string[];
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

function truncateText(value: string | null | undefined, maxLength: number): string {
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

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

  if (!pages?.length) {
    return { suggestions: {}, synonymsCreated: 0 };
  }

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
          content: `You are a search optimization assistant. You'll receive a list of search queries that returned no results on a website, and a list of all pages on that site.

For each query, suggest 1-2 pages that could be relevant matches (if any exist). Consider:
- Semantic similarity (the page covers the topic even if wording differs)
- Products/services that match the search intent
- Category pages that could contain what the user was looking for

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

  if (!aiRes.ok) {
    throw new Error(`Failed-query AI analysis failed: ${aiRes.status}`);
  }

  const aiData = await aiRes.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  const suggestions: Record<string, FailedQuerySuggestion[]> = {};
  let synonymsCreated = 0;

  if (!toolCall?.function?.arguments) {
    return { suggestions, synonymsCreated };
  }

  const parsed = JSON.parse(toolCall.function.arguments);
  for (const match of parsed.matches || []) {
    if (!match.suggestions?.length) continue;
    suggestions[match.query] = match.suggestions;

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

    log.push(`Optimization started at ${now.toISOString()}`);

    // 1. Gather data
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: site } = await supabase
      .from("sites")
      .select("name, domain, ai_context")
      .eq("id", site_id)
      .single();

    log.push(`Site loaded: ${site?.domain || "unknown"}`);

    const { data: existingStrategy } = await supabase
      .from("site_search_strategy")
      .select("prompt_additions, conversion_insights, contact_trigger_rules, high_ctr_patterns, optimization_log, last_optimized_at")
      .eq("site_id", site_id)
      .maybeSingle();

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

    const { data: synonymsData } = await supabase
      .from("search_synonyms")
      .select("query_from, query_to, confidence")
      .eq("site_id", site_id)
      .order("confidence", { ascending: false })
      .limit(100);

    log.push(`Synonyms: ${synonymsData?.length || 0}`);

    const { data: gaData } = await supabase
      .from("page_analytics")
      .select("page_path, pageviews, conversions, conversion_rate")
      .eq("site_id", site_id)
      .order("conversions", { ascending: false })
      .limit(200);

    log.push(`GA analytics rows: ${gaData?.length || 0}`);

    const { data: contactConfig } = await supabase
      .from("site_contact_configs")
      .select("enabled, email, phone, chat_url")
      .eq("site_id", site_id)
      .maybeSingle();

    const hasContactMethods = contactConfig &&
      contactConfig.enabled &&
      (contactConfig.phone || contactConfig.email || contactConfig.chat_url);

    // 2. Analyze search patterns
    const queryStats: Record<string, { total: number; clicked: number; zeroResults: number }> = {};
    for (const l of searchLogs || []) {
      const q = (l as any).query.trim().toLowerCase();
      if (!queryStats[q]) queryStats[q] = { total: 0, clicked: 0, zeroResults: 0 };
      queryStats[q].total++;
      if ((l as any).clicked) queryStats[q].clicked++;
      if ((l as any).results_count === 0) queryStats[q].zeroResults++;
    }

    const lowCtrQueries = Object.entries(queryStats)
      .filter(([, s]) => s.total >= 3 && (s.clicked / s.total) < 0.1)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 20)
      .map(([q, s]) => ({ query: q, searches: s.total, ctr: s.clicked / s.total }));

    const zeroResultQueries = Object.entries(queryStats)
      .filter(([, s]) => s.zeroResults > 0)
      .sort((a, b) => b[1].zeroResults - a[1].zeroResults)
      .slice(0, 20)
      .map(([q, s]) => ({ query: q, count: s.zeroResults }));

    // High-CTR patterns from click data
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

    const topConverters = (gaData || [])
      .filter((g: any) => g.conversions > 0)
      .slice(0, 10)
      .map((g: any) => ({
        path: g.page_path,
        conversions: g.conversions,
        rate: g.conversion_rate,
        views: g.pageviews,
      }));

    // AI analysis for failed queries
    let failedQuerySuggestions: Record<string, FailedQuerySuggestion[]> = {};
    let failedQuerySynonymsCreated = 0;
    if (zeroResultQueries.length > 0) {
      try {
        const failedAnalysis = await suggestPagesForFailedQueries(supabase, site_id, zeroResultQueries);
        failedQuerySuggestions = failedAnalysis.suggestions;
        failedQuerySynonymsCreated = failedAnalysis.synonymsCreated;
        log.push(`Failed-query AI matches: ${Object.keys(failedQuerySuggestions).length}`);
        log.push(`Failed-query synonyms created: ${failedQuerySynonymsCreated}`);
      } catch (failedErr) {
        log.push(`Failed-query AI analysis skipped: ${(failedErr as Error).message}`);
      }
    }

    // 3. AI strategy generation
    let promptAdditions = (existingStrategy as any)?.prompt_additions || "";
    let conversionInsights = (existingStrategy as any)?.conversion_insights || "";
    let contactTriggerRules: ContactTriggerRules = {
      show_on_zero_results: (existingStrategy as any)?.contact_trigger_rules?.show_on_zero_results ?? true,
      show_on_low_ctr_queries: (existingStrategy as any)?.contact_trigger_rules?.show_on_low_ctr_queries ?? !!hasContactMethods,
      low_ctr_threshold: (existingStrategy as any)?.contact_trigger_rules?.low_ctr_threshold ?? 0.1,
      trigger_categories: (existingStrategy as any)?.contact_trigger_rules?.trigger_categories || [],
    };

    if (LOVABLE_API_KEY && (searchLogs?.length || 0) >= 10) {
      try {
        const dataContext = JSON.stringify({
          site: {
            name: (site as any)?.name || null,
            domain: (site as any)?.domain || null,
            ai_context: truncateText((site as any)?.ai_context, 4000) || null,
          },
          current_strategy: existingStrategy ? {
            last_optimized_at: (existingStrategy as any).last_optimized_at || null,
            prompt_additions: (existingStrategy as any).prompt_additions || "",
            conversion_insights: (existingStrategy as any).conversion_insights || "",
            contact_trigger_rules: (existingStrategy as any).contact_trigger_rules || null,
            previous_high_ctr_patterns: (existingStrategy as any).high_ctr_patterns || [],
          } : null,
          total_searches_30d: searchLogs?.length || 0,
          unique_queries: Object.keys(queryStats).length,
          avg_ctr: searchLogs?.length
            ? (searchLogs.filter((l: any) => l.clicked).length / searchLogs.length * 100).toFixed(1) + "%"
            : "0%",
          low_ctr_queries: lowCtrQueries.slice(0, 10),
          zero_result_queries: zeroResultQueries.slice(0, 10),
          high_ctr_patterns: highCtrPatterns.slice(0, 10),
          top_converting_pages: topConverters,
          synonyms: (synonymsData || []).slice(0, 25),
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
You are improving an existing strategy, not starting from scratch, unless the data strongly indicates the previous strategy is wrong.

Your output MUST be valid JSON with these fields:
{
  "prompt_additions": "Extra instructions to add to the search AI's system prompt. Max 200 words. Write in Finnish if queries are mostly Finnish.",
  "contact_trigger_rules": {
    "show_on_zero_results": true/false,
    "show_on_low_ctr_queries": true/false,
    "low_ctr_threshold": 0.0-1.0,
    "trigger_categories": ["keyword categories that should trigger contact CTA"]
  },
  "conversion_insights": "Brief summary of conversion patterns. Max 150 words."
}

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
      if (zeroResultQueries.length > 5) {
        promptAdditions += "Monet haut eivät tuota tuloksia. Yritä löytää osittaisia vastaavuuksia.";
      }
      if (topConverters.length > 0) {
        const paths = topConverters.slice(0, 3).map((p: any) => p.path).join(", ");
        promptAdditions += ` Parhaiten konvertoivat sivut: ${paths}.`;
      }
      conversionInsights = `${Object.keys(queryStats).length} uniikkia hakua, ${zeroResultQueries.length} nollatuloshakua.`;
      log.push("Rule-based strategy generated");
    }

    // 4. Write strategy to DB
    const strategyData = {
      site_id,
      prompt_additions: promptAdditions,
      contact_trigger_rules: contactTriggerRules,
      high_ctr_patterns: highCtrPatterns.slice(0, 50),
      conversion_insights: conversionInsights,
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
