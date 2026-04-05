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
    const body = await req.json();
    const { site_id, query, action } = body;

    // Handle click tracking action
    if (action === "click") {
      return await handleClick(body);
    }

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

    // --- LEARNING: Expand query with synonyms ---
    let expandedWords = [...words];
    const { data: synonyms } = await supabase
      .from("search_synonyms")
      .select("query_to, confidence")
      .eq("site_id", site_id)
      .eq("query_from", query.trim().toLowerCase())
      .order("confidence", { ascending: false })
      .limit(3);

    const synonymQueries: string[] = [];
    if (synonyms && synonyms.length > 0) {
      for (const syn of synonyms) {
        const synWords = syn.query_to.split(/\s+/).filter((w: string) => w.length >= 2);
        for (const sw of synWords) {
          if (!expandedWords.includes(sw)) expandedWords.push(sw);
        }
        synonymQueries.push(syn.query_to);
      }
    }

    // --- LEARNING: Get click boost data ---
    const { data: clickData } = await supabase
      .from("search_clicks")
      .select("page_url, click_count")
      .eq("site_id", site_id)
      .eq("query", query.trim().toLowerCase());

    const clickBoosts: Record<string, number> = {};
    if (clickData) {
      for (const c of clickData) {
        clickBoosts[c.page_url] = c.click_count;
      }
    }

    // Also get general popularity (all queries)
    const { data: popularPages } = await supabase
      .from("search_clicks")
      .select("page_url, click_count")
      .eq("site_id", site_id)
      .order("click_count", { ascending: false })
      .limit(50);

    const popularityBoosts: Record<string, number> = {};
    if (popularPages) {
      for (const p of popularPages) {
        popularityBoosts[p.page_url] = p.click_count;
      }
    }

    // --- GA ANALYTICS BOOST: Get page analytics data ---
    const { data: gaData } = await supabase
      .from("page_analytics")
      .select("page_path, pageviews, conversions, conversion_rate")
      .eq("site_id", site_id)
      .order("conversions", { ascending: false })
      .limit(200);

    const gaBoosts: Record<string, { pageviews: number; conversions: number; convRate: number }> = {};
    if (gaData && gaData.length > 0) {
      // Normalize: find max values for relative scoring
      const maxPV = Math.max(...gaData.map(g => g.pageviews), 1);
      const maxConv = Math.max(...gaData.map(g => g.conversions), 1);
      for (const g of gaData) {
        gaBoosts[g.page_path] = {
          pageviews: g.pageviews / maxPV,         // 0-1 normalized
          conversions: g.conversions / maxConv,     // 0-1 normalized
          convRate: g.conversion_rate,
        };
      }
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
      const metaLower = (page.meta_description || "").toLowerCase();
      let score = 0;
      const matchedWords: string[] = [];

      for (const word of expandedWords) {
        const regex = new RegExp(escapeRegex(word), "gi");
        const titleMatches = (titleLower.match(regex) || []).length;
        const contentMatches = (contentLower.match(regex) || []).length;
        const metaMatches = (metaLower.match(regex) || []).length;

        if (titleMatches > 0) {
          score += titleMatches * 10;
          matchedWords.push(word);
        }
        if (metaMatches > 0) {
          score += metaMatches * 5;
          if (!matchedWords.includes(word)) matchedWords.push(word);
        }
        if (contentMatches > 0) {
          score += Math.min(contentMatches, 20);
          if (!matchedWords.includes(word)) matchedWords.push(word);
        }
      }

      // Require ALL original query words to match for multi-word queries
      if (words.length > 1) {
        const originalMatched = words.filter((w: string) => matchedWords.includes(w));
        if (originalMatched.length === words.length) {
          score *= 1.5;
        }
        // Stricter: require at least 60% of words to match
        if (originalMatched.length < Math.ceil(words.length * 0.6)) {
          score = 0;
        }
      }

      // --- LEARNING BOOST: Click-based boosting ---
      const queryClickBoost = clickBoosts[page.url] || 0;
      const generalPopularity = popularityBoosts[page.url] || 0;
      
      if (queryClickBoost > 0 && score > 0) {
        // Strong boost for pages clicked on this exact query
        score += Math.min(queryClickBoost * 3, 30);
      }
      if (generalPopularity > 0 && score > 0) {
        // Mild boost for generally popular pages
        score += Math.min(generalPopularity * 0.5, 10);
      }

      // --- GA ANALYTICS BOOST ---
      if (score > 0) {
        // Match page URL path against GA page_path
        let pagePath = "";
        try { pagePath = new URL(page.url).pathname; } catch { /* ignore */ }
        const ga = gaBoosts[pagePath];
        if (ga) {
          // Conversion boost: pages that convert well get strong boost
          score += ga.conversions * 20;   // up to +20 for top converter
          // Traffic boost: high-traffic pages are likely more relevant
          score += ga.pageviews * 8;      // up to +8 for most visited
          // Conversion rate bonus: efficient pages get extra
          if (ga.convRate > 0.05) score += 5;
          if (ga.convRate > 0.10) score += 10;
        }
      }

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
        schema_data: page.schema_data || null,
        score,
        snippet,
        matchedWords,
      };
    });

    // Get top candidates from keyword search — require minimum score
    const minScore = words.length > 1 ? 8 : 5;
    const keywordResults = scored
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    // --- AI Re-ranking & Summary ---
    let aiSummary: string | undefined;
    let finalResults = keywordResults;

    if (LOVABLE_API_KEY && keywordResults.length > 0) {
      try {
        const pagesContext = keywordResults.slice(0, 10).map((r, i) => {
          const schema = r.schema_data;
          let meta = "";
          if (schema) {
            if (schema.type === "Product") {
              const parts: string[] = [];
              if (schema.price) parts.push(`Hinta: ${schema.price}${schema.currency === "EUR" ? "€" : ""}`);
              if (schema.rating) parts.push(`Arvosana: ${schema.rating}/5`);
              if (schema.reviewCount) parts.push(`${schema.reviewCount} arvostelua`);
              if (schema.availability) parts.push(schema.availability.includes("InStock") ? "Varastossa" : "Ei varastossa");
              meta = `[TUOTE] ${parts.join(" | ")}`;
            } else if (schema.type === "Article") {
              const parts: string[] = [];
              if (schema.author) parts.push(schema.author);
              if (schema.datePublished) parts.push(schema.datePublished);
              meta = `[ARTIKKELI] ${parts.join(" | ")}`;
            } else if (schema.type === "Event") {
              const parts: string[] = [];
              if (schema.startDate) parts.push(schema.startDate);
              if (schema.location) parts.push(schema.location);
              meta = `[TAPAHTUMA] ${parts.join(" | ")}`;
            }
          }
          return `[${i + 1}] ${r.title}\nURL: ${r.url}\n${meta ? meta + "\n" : ""}${r.content.slice(0, 400)}`;
        }).join("\n\n");

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
                content: `Olet yrityksen sivustohaun avustaja. Vastaa käyttäjän hakuun SUORALLA VASTAUKSELLA yrityksen äänellä (me-muoto).

Säännöt:
- Vastaa samalla kielellä kuin haku (suomi/englanti)
- Anna 1-2 lauseen KONKREETTINEN vastaus, älä kuvailua hakutuloksista
- Tuotehaku → mainitse paras tuote nimeltä + hinta jos tiedossa. Esim: "Gree Bora 35 ilmalämpöpumppu sopii kodin viilennykseen, hinta 1 290€."
- Tietokysymys → vastaa suoraan sisällön perusteella. Esim: "Huollon voi varata verkossa tai soittamalla 09 4289 1192."
- Palveluhaku → kerro miten palvelun saa
- ÄLÄ KOSKAAN kirjoita "Löytyi X tulosta", "Sivustolta löytyy", "Valikoimasta löytyy" — käyttäjä näkee tulokset itse
- Jos sivuilta ei löydy oikeaa vastausta → summary: null

Palauta JSON:
{"summary": "Suora vastaus" tai null, "ranking": [sivunumerot max 5], "reasoning": ["perustelu per sivu"]}
Palauta VAIN validi JSON.`
              },
              {
                role: "user",
                content: `Hakusana: "${query}"\n\nSivut:\n${pagesContext}`
              }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || "";
          
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

    // --- LEARNING: Zero-result suggestions ---
    let suggestions: string[] = [];
    if (finalResults.length === 0) {
      // Find similar successful past queries
      const { data: pastQueries } = await supabase
        .from("search_logs")
        .select("query, results_count")
        .eq("site_id", site_id)
        .gt("results_count", 0)
        .order("created_at", { ascending: false })
        .limit(200);

      if (pastQueries) {
        const queryLower = query.trim().toLowerCase();
        const scored = pastQueries
          .map(pq => {
            const pqLower = pq.query.toLowerCase();
            // Score similarity: shared characters, length similarity, etc.
            let sim = 0;
            const qWords = queryLower.split(/\s+/);
            const pqWords = pqLower.split(/\s+/);
            
            // Check partial word matches
            for (const qw of qWords) {
              for (const pw of pqWords) {
                if (pw.includes(qw) || qw.includes(pw)) sim += 3;
                else if (levenshtein(qw, pw) <= 2) sim += 2;
              }
            }
            return { query: pq.query, sim };
          })
          .filter(s => s.sim > 0 && s.query.toLowerCase() !== queryLower)
          .sort((a, b) => b.sim - a.sim);

        // Deduplicate
        const seen = new Set<string>();
        for (const s of scored) {
          const key = s.query.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            suggestions.push(s.query);
          }
          if (suggestions.length >= 3) break;
        }
      }

      // Also check synonyms in reverse — maybe there's a synonym for what they searched
      if (synonymQueries.length > 0) {
        for (const sq of synonymQueries) {
          if (!suggestions.includes(sq)) suggestions.push(sq);
        }
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
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      fallback_message: results.length === 0 ? "Ei tuloksia. Kokeile eri hakusanoja." : undefined,
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

// Handle click tracking
async function handleClick(body: any) {
  const { site_id, query, url } = body;
  if (!site_id || !query || !url) {
    return new Response(JSON.stringify({ error: "site_id, query, url required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Upsert click count
  const normalizedQuery = query.trim().toLowerCase();
  
  // Try to find existing
  const { data: existing } = await supabase
    .from("search_clicks")
    .select("id, click_count")
    .eq("site_id", site_id)
    .eq("query", normalizedQuery)
    .eq("page_url", url)
    .single();

  if (existing) {
    await supabase
      .from("search_clicks")
      .update({ 
        click_count: existing.click_count + 1,
        last_clicked_at: new Date().toISOString()
      })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("search_clicks")
      .insert({ site_id, query: normalizedQuery, page_url: url, click_count: 1 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

// Simple Levenshtein distance for fuzzy matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
