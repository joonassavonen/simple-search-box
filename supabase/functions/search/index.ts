import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { site_id, query } = await req.json();
    if (!site_id || !query) {
      return new Response(JSON.stringify({ error: "site_id and query required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify site exists and is active
    const { data: site } = await supabase
      .from("sites")
      .select("id, is_active")
      .eq("id", site_id)
      .single();

    if (!site || !site.is_active) {
      return new Response(JSON.stringify({ error: "Site not found or inactive" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detect language
    const finnishChars = /[äöåÄÖÅ]/;
    const language = finnishChars.test(query) ? "fi" : "en";

    const words = query.trim().toLowerCase().split(/\s+/).filter((w: string) => w.length >= 2);

    if (words.length === 0) {
      return new Response(JSON.stringify({
        results: [],
        language,
        response_ms: Date.now() - startTime,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all pages for the site
    const { data: pages, error: pagesErr } = await supabase
      .from("pages")
      .select("url, title, content, meta_description, schema_data")
      .eq("site_id", site_id)
      .limit(500);

    if (pagesErr) throw new Error(pagesErr.message);

    // Score each page based on word matches (keyword phase)
    const scored = (pages || []).map((page) => {
      const titleLower = (page.title || "").toLowerCase();
      const contentLower = (page.content || "").toLowerCase();
      let score = 0;
      const matchedWords: string[] = [];

      for (const word of words) {
        const titleMatches = (titleLower.match(new RegExp(escapeRegex(word), "g")) || []).length;
        const contentMatches = (contentLower.match(new RegExp(escapeRegex(word), "g")) || []).length;

        if (titleMatches > 0) {
          score += titleMatches * 10;
          matchedWords.push(word);
        }
        if (contentMatches > 0) {
          score += Math.min(contentMatches, 20);
          if (!matchedWords.includes(word)) matchedWords.push(word);
        }
      }

      if (matchedWords.length === words.length && words.length > 1) {
        score *= 1.5;
      }

      // Prefer meta description as snippet, fallback to content extract
      let snippet = "";
      if (page.meta_description) {
        snippet = page.meta_description;
      } else if (score > 0 && page.content) {
        snippet = extractSnippet(page.content, words);
      }

      return {
        url: page.url,
        title: page.title || page.url,
        content: page.content || "",
        score,
        snippet,
        matchedWords,
      };
    });

    // Get top candidates from keyword search
    const keywordResults = scored
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    // --- AI Re-ranking & Summary ---
    let aiSummary: string | undefined;
    let finalResults = keywordResults;

    if (LOVABLE_API_KEY && keywordResults.length > 0) {
      try {
        const pagesContext = keywordResults.slice(0, 10).map((r, i) => 
          `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 500)}`
        ).join("\n\n");

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
                content: `You are a search assistant. The user searched a website. Given the query and page contents:
1. Return a JSON object with:
   - "summary": A helpful 1-2 sentence answer in the same language as the query (Finnish or English). Be concise and direct. Reference specific pages if helpful.
   - "ranking": An array of page indices (1-based) ordered by relevance to the query. Include only relevant pages. Max 8.
   - "reasoning": For each ranked page, a short reason why it's relevant.
2. If no pages are truly relevant, return {"summary": null, "ranking": [], "reasoning": []}.
Return ONLY valid JSON.`
              },
              {
                role: "user",
                content: `Query: "${query}"\n\nPages:\n${pagesContext}`
              }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || "";
          
          // Parse JSON from response (handle markdown code blocks)
          const jsonMatch = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(jsonMatch);

          if (parsed.summary) {
            aiSummary = parsed.summary;
          }

          if (parsed.ranking && Array.isArray(parsed.ranking) && parsed.ranking.length > 0) {
            const reranked = parsed.ranking
              .map((idx: number) => keywordResults[idx - 1])
              .filter(Boolean);
            
            if (reranked.length > 0) {
              // Add reasoning from AI
              const reasons = parsed.reasoning || [];
              reranked.forEach((r: any, i: number) => {
                if (reasons[i]) r.aiReasoning = reasons[i];
              });
              finalResults = reranked;
            }
          }
        } else {
          console.error("AI gateway error:", aiResponse.status, await aiResponse.text());
        }
      } catch (aiErr) {
        console.error("AI re-ranking failed, falling back to keyword:", aiErr);
      }
    }

    // Format final results
    const maxScore = finalResults.reduce((max, s) => Math.max(max, s.score), 1);
    const results = finalResults
      .slice(0, 8)
      .map((r) => ({
        url: r.url,
        title: r.title,
        score: Math.round(Math.min(r.score / maxScore, 1) * 100) / 100,
        snippet: r.snippet,
        reasoning: (r as any).aiReasoning || `Matched: ${r.matchedWords.join(", ")}`,
        schema_data: (r as any).schema_data || null,
      }));

    const responseMs = Date.now() - startTime;

    // Log the search
    await supabase.from("search_logs").insert({
      site_id,
      query,
      results_count: results.length,
      language,
      response_ms: responseMs,
    });

    return new Response(JSON.stringify({
      results,
      language,
      response_ms: responseMs,
      ai_summary: aiSummary || undefined,
      fallback_message: results.length === 0 ? "No results found. Try different keywords." : undefined,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Search error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSnippet(content: string, words: string[], maxLen = 200): string {
  const lower = content.toLowerCase();
  let bestPos = -1;

  for (const word of words) {
    const pos = lower.indexOf(word.toLowerCase());
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }

  if (bestPos === -1) return content.slice(0, maxLen) + "...";

  const start = Math.max(0, bestPos - 60);
  const end = Math.min(content.length, start + maxLen);
  let snippet = content.slice(start, end).trim();

  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet = snippet + "...";

  return snippet;
}
