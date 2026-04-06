import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

function normalizeQuery(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function lexicalSimilarity(a: string, b: string): number {
  const aTokens = new Set(normalizeQuery(a).split(/\s+/).filter((token) => token.length >= 2));
  const bTokens = new Set(normalizeQuery(b).split(/\s+/).filter((token) => token.length >= 2));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
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

    // 1. Get recent search logs
    const { data: logs } = await supabase
      .from("search_logs")
      .select("query, results_count, created_at")
      .eq("site_id", site_id)
      .order("created_at", { ascending: false })
      .limit(500);

    if (!logs || logs.length === 0) {
      return new Response(JSON.stringify({ message: "No search data to learn from", discovered: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Use AI to discover semantic synonyms
    let aiSynonyms: { from: string; to: string; confidence: number }[] = [];
    if (LOVABLE_API_KEY && logs.length >= 10) {
      try {
        const queryStats: Record<string, { total: number; withResults: number }> = {};
        for (const log of logs) {
          const q = (log as any).query.toLowerCase().trim();
          if (!queryStats[q]) queryStats[q] = { total: 0, withResults: 0 };
          queryStats[q].total++;
          if ((log as any).results_count > 0) queryStats[q].withResults++;
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

    // 3. Store synonyms
    let created = 0;
    let updated = 0;
    for (const pair of aiSynonyms) {
      const from = normalizeQuery(pair.from);
      const to = normalizeQuery(pair.to);
      if (!from || !to || from === to) continue;
      if (lexicalSimilarity(from, to) < 0.2 && pair.confidence < 0.85) continue;

      const { data: existing } = await supabase
        .from("search_synonyms")
        .select("id, confidence, times_used")
        .eq("site_id", site_id)
        .eq("query_from", from)
        .eq("query_to", to)
        .maybeSingle();

      if (existing) {
        const newConfidence = ((existing as any).confidence * 0.7 + pair.confidence * 0.3);
        await supabase
          .from("search_synonyms")
          .update({
            confidence: Math.min(newConfidence, 1.0),
            times_used: (existing as any).times_used + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", (existing as any).id);
        updated++;
      } else {
        await supabase
          .from("search_synonyms")
          .insert({
            site_id,
            query_from: from,
            query_to: to,
            confidence: pair.confidence,
          });
        created++;
      }
    }

    return new Response(JSON.stringify({
      message: "Learning complete",
      logs_analyzed: logs.length,
      ai_synonyms_found: aiSynonyms.length,
      discovered: created,
      updated,
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
