import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

// This function processes search logs and builds learned synonyms/associations
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

    // 1. Get recent search logs with results
    const { data: logs } = await supabase
      .from("search_logs")
      .select("query, results_count, created_at")
      .eq("site_id", site_id)
      .order("created_at", { ascending: false })
      .limit(500);

    if (!logs || logs.length === 0) {
      return new Response(JSON.stringify({ message: "No search data to learn from", synonyms_created: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Get click data to find which queries lead to same pages
    const { data: clicks } = await supabase
      .from("search_clicks")
      .select("query, page_url, click_count")
      .eq("site_id", site_id)
      .order("click_count", { ascending: false })
      .limit(500);

    // 3. Build query associations from clicks on same pages
    const pageToQueries: Record<string, { query: string; count: number }[]> = {};
    if (clicks) {
      for (const c of clicks) {
        if (!pageToQueries[c.page_url]) pageToQueries[c.page_url] = [];
        pageToQueries[c.page_url].push({ query: c.query, count: c.click_count });
      }
    }

    // Find query pairs that lead to same pages
    const queryPairs: { from: string; to: string; confidence: number }[] = [];
    for (const [, queries] of Object.entries(pageToQueries)) {
      if (queries.length < 2) continue;
      for (let i = 0; i < queries.length; i++) {
        for (let j = i + 1; j < queries.length; j++) {
          const q1 = queries[i], q2 = queries[j];
          if (q1.query === q2.query) continue;
          const confidence = Math.min((q1.count + q2.count) / 10, 1.0);
          if (confidence >= 0.2) {
            queryPairs.push({ from: q1.query, to: q2.query, confidence });
            queryPairs.push({ from: q2.query, to: q1.query, confidence });
          }
        }
      }
    }

    // 4. Use AI to discover semantic synonyms from search patterns
    let aiSynonyms: { from: string; to: string; confidence: number }[] = [];
    if (LOVABLE_API_KEY && logs.length >= 10) {
      try {
        // Get unique queries with their success rates
        const queryStats: Record<string, { total: number; withResults: number }> = {};
        for (const log of logs) {
          const q = log.query.toLowerCase().trim();
          if (!queryStats[q]) queryStats[q] = { total: 0, withResults: 0 };
          queryStats[q].total++;
          if (log.results_count > 0) queryStats[q].withResults++;
        }

        const queryList = Object.entries(queryStats)
          .filter(([, s]) => s.total >= 2)
          .map(([q, s]) => `"${q}" (${s.withResults}/${s.total} tuloksellisia)`)
          .slice(0, 50)
          .join("\n");

        if (queryList) {
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
                  content: `Analyze these search queries from a website and identify synonym pairs or related terms that users likely mean the same thing. 
Return ONLY a JSON array of objects with "from", "to", and "confidence" (0-1). 
Only include high-confidence pairs where the terms genuinely mean the same or very similar things.
Example: [{"from":"ilp","to":"ilmalämpöpumppu","confidence":0.9}]
Return [] if no clear synonyms found.`
                },
                {
                  role: "user",
                  content: `Search queries:\n${queryList}`
                }
              ],
            }),
          });

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            const content = aiData.choices?.[0]?.message?.content || "[]";
            const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            aiSynonyms = JSON.parse(jsonStr);
          }
        }
      } catch (e) {
        console.error("AI synonym discovery failed:", e);
      }
    }

    // 5. Merge and upsert all synonyms
    const allPairs = [...queryPairs, ...aiSynonyms];
    let synonymsCreated = 0;

    for (const pair of allPairs) {
      const { data: existing } = await supabase
        .from("search_synonyms")
        .select("id, confidence, times_used")
        .eq("site_id", site_id)
        .eq("query_from", pair.from)
        .eq("query_to", pair.to)
        .single();

      if (existing) {
        // Update confidence (moving average) and increment usage
        const newConfidence = (existing.confidence * 0.7 + pair.confidence * 0.3);
        await supabase
          .from("search_synonyms")
          .update({
            confidence: Math.min(newConfidence, 1.0),
            times_used: existing.times_used + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("search_synonyms")
          .insert({
            site_id,
            query_from: pair.from,
            query_to: pair.to,
            confidence: pair.confidence,
          });
        synonymsCreated++;
      }
    }

    return new Response(JSON.stringify({
      message: "Learning complete",
      logs_analyzed: logs.length,
      clicks_analyzed: clicks?.length || 0,
      click_pairs_found: queryPairs.length,
      ai_synonyms_found: aiSynonyms.length,
      synonyms_created: synonymsCreated,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Learn error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
