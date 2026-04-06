import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { site_id, failed_queries } = await req.json();
    if (!site_id || !failed_queries?.length) {
      return new Response(JSON.stringify({ suggestions: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Fetch all pages for this site (titles + urls)
    const { data: pages } = await sb
      .from("pages")
      .select("url, title, meta_description")
      .eq("site_id", site_id)
      .not("title", "is", null);

    if (!pages?.length) {
      return new Response(JSON.stringify({ suggestions: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build a compact page list for AI context
    const pageList = pages
      .map((p, i) => `${i + 1}. "${p.title}" — ${p.url}${p.meta_description ? ` (${p.meta_description.slice(0, 80)})` : ""}`)
      .join("\n");

    // Take top 20 failed queries max
    const queries = failed_queries.slice(0, 20).map((q: any) => q.query);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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
            content: `Failed search queries:\n${queries.map((q: string, i: number) => `${i + 1}. "${q}"`).join("\n")}\n\nAvailable pages:\n${pageList}`,
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
                        query: { type: "string", description: "The original search query" },
                        suggestions: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              url: { type: "string", description: "URL of the suggested page" },
                              title: { type: "string", description: "Title of the suggested page" },
                              reason: { type: "string", description: "Brief reason why this page matches (in Finnish)" },
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
      const errText = await aiRes.text();
      console.error("AI error:", aiRes.status, errText);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let suggestions: Record<string, any[]> = {};
    let synonymsCreated = 0;

    if (toolCall?.function?.arguments) {
      const parsed = JSON.parse(toolCall.function.arguments);
      for (const m of parsed.matches || []) {
        if (m.suggestions?.length) {
          suggestions[m.query] = m.suggestions;

          // Save each suggestion as a synonym: query → page title (for search expansion)
          for (const s of m.suggestions) {
            // Extract key words from page title for synonym mapping
            const titleWords = (s.title || "")
              .toLowerCase()
              .replace(/[^a-zäöåü0-9\s-]/g, "")
              .split(/\s+/)
              .filter((w: string) => w.length >= 3)
              .slice(0, 5)
              .join(" ");

            if (!titleWords) continue;

            const queryNorm = m.query.trim().toLowerCase();

            // Check if synonym already exists
            const { data: existing } = await sb
              .from("search_synonyms")
              .select("id, confidence, times_used")
              .eq("site_id", site_id)
              .eq("query_from", queryNorm)
              .eq("query_to", titleWords)
              .single();

            if (existing) {
              await sb
                .from("search_synonyms")
                .update({
                  confidence: Math.min(existing.confidence * 0.7 + 0.6 * 0.3, 1.0),
                  times_used: existing.times_used + 1,
                  source: "suggest-pages",
                  status: "approved",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existing.id);
            } else {
              await sb
                .from("search_synonyms")
                .insert({
                  site_id,
                  query_from: queryNorm,
                  query_to: titleWords,
                  confidence: 0.6,
                  source: "suggest-pages",
                  status: "approved",
                });
              synonymsCreated++;
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ suggestions, synonyms_created: synonymsCreated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-pages error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
