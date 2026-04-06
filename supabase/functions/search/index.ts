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
      .select("id, is_active, ai_context, name, domain")
      .eq("id", site_id)
      .single();

    if (!site || !site.is_active) {
      return new Response(JSON.stringify({ error: "Site not found or inactive" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- STRATEGY: Read optimization strategy (written by optimize agent) ---
    const { data: strategy } = await supabase
      .from("site_search_strategy")
      .select("contact_trigger_rules, high_ctr_patterns")
      .eq("site_id", site_id)
      .single();

    const triggerRules = strategy?.contact_trigger_rules || { show_on_zero_results: true };
    const highCtrPatterns: { pattern: string; top_url: string; ctr: number }[] =
      strategy?.high_ctr_patterns || [];

    // --- CONTACT CONFIG: Read from DB ---
    const { data: contactConfig } = await supabase
      .from("site_contact_configs")
      .select("enabled, email, phone, chat_url, cta_text_fi, cta_text_en")
      .eq("site_id", site_id)
      .single();

    // Detect language
    const language = detectLanguage(query);

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
      .eq("status", "approved")
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
    // Uses visitor-weighted key event rate: (key_events / pageviews) * pageviews_normalized
    // This rewards pages that have both good conversion AND meaningful traffic
    const { data: gaData } = await supabase
      .from("page_analytics")
      .select("page_path, pageviews, conversions")
      .eq("site_id", site_id)
      .order("conversions", { ascending: false })
      .limit(200);

    const gaBoosts: Record<string, { pageviews: number; keyEvents: number; weightedRate: number }> = {};
    if (gaData && gaData.length > 0) {
      const maxPV = Math.max(...gaData.map(g => g.pageviews), 1);
      const totalPV = gaData.reduce((s, g) => s + g.pageviews, 0) || 1;
      for (const g of gaData) {
        if (g.page_path === "/") continue; // Skip homepage
        const keyEventRate = g.pageviews > 0 ? g.conversions / g.pageviews : 0;
        // Weighted rate = key_event_rate * (pageviews / total_pageviews)
        // This penalizes pages with few visits even if their rate is high
        const pvWeight = g.pageviews / totalPV;
        const weightedRate = keyEventRate * pvWeight;
        gaBoosts[g.page_path] = {
          pageviews: g.pageviews / maxPV,
          keyEvents: g.conversions,
          weightedRate,
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
    const queryLower = query.trim().toLowerCase();
    const scored = (pages || []).filter((page) => {
      try { return new URL(page.url).pathname !== "/"; } catch { return true; }
    }).map((page) => {
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

      // --- STRATEGY BOOST: High-CTR patterns from optimize agent ---
      if (score > 0 && highCtrPatterns.length > 0) {
        for (const p of highCtrPatterns) {
          if (queryLower.includes(p.pattern) && page.url === p.top_url) {
            score += Math.min(p.ctr * 20, 15);
            break;
          }
        }
      }

      // --- GA ANALYTICS BOOST: visitor-weighted key event rate ---
      if (score > 0) {
        let pagePath = "";
        try { pagePath = new URL(page.url).pathname; } catch { /* ignore */ }
        const ga = gaBoosts[pagePath];
        if (ga) {
          // Weighted rate boost: max +25 for best weighted key event rate
          const maxWeightedRate = Math.max(...Object.values(gaBoosts).map(g => g.weightedRate), 0.0001);
          const normalizedWR = ga.weightedRate / maxWeightedRate;
          score += normalizedWR * 25;
          // Traffic boost: high-traffic pages get up to +8
          score += ga.pageviews * 8;
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
    // Higher thresholds reduce noise: title match = 10pts, meta = 5pts, content = 1pt each
    const minScore = words.length > 1 ? 12 : 8;
    const keywordResults = scored
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Further filtering: if top result is much stronger, drop weak tail
    if (keywordResults.length > 1) {
      const topScore = keywordResults[0].score;
      const threshold = topScore * 0.15; // results must be at least 15% of top score
      const filtered = keywordResults.filter(r => r.score >= threshold);
      if (filtered.length > 0) {
        keywordResults.length = 0;
        keywordResults.push(...filtered);
      }
    }

    // --- AI Semantic Fallback + Re-ranking & Guidance ---
    let aiSummary: string | undefined;
    let finalResults = keywordResults;

    const isQuestion = /\?|mikä|mitä|miksi|miten|kumpi|vertailu|ero |eroa |paras|suosit|kannat|asennat|teette/i.test(query);
    const isConstrainedRecommendationQuery =
      /paras|sopi|sopii|suosit|kannat|mikä on|which|best|recommend|suitable/i.test(query) &&
      /kerrostalo|rivitalo|parveke|taloyhtiö|viilenn|jäähdy|cool|apartment|flat|m2|neli|size|square|asuin/i.test(query);
    const hasStrongResults = keywordResults.length > 0 && keywordResults[0].score >= 15;
    const useAiGuidance = keywordResults.length === 0 || (!hasStrongResults && keywordResults.length <= 2) || isQuestion;

    // When zero keyword results, do AI semantic search over all pages with FULL context
    if (LOVABLE_API_KEY && keywordResults.length === 0 && pages && pages.length > 0) {
      try {
        const filteredPages = (pages || [])
          .filter((p) => { try { return new URL(p.url).pathname !== "/"; } catch { return true; } })
          .slice(0, 40);
        // Give AI much more content per page so it can understand context (regions, services, etc.)
        const allPagesContext = filteredPages
          .map((p, i) => `[${i + 1}] ${p.title || "?"} — ${p.url}\n${(p.content || p.meta_description || "").slice(0, 600)}`)
          .join("\n\n");

        const semanticRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `Olet sivustohaun semanttinen hakukone ja asiakaspalvelija. Käyttäjän avainsanahaku ei löytänyt tuloksia. Tehtäväsi on:

1. Lukea YRITYSKONTEKSTI ja sivujen sisältö huolellisesti
2. Löytää VAIN ne sivut jotka OIKEASTI vastaavat käyttäjän tarpeeseen
3. Vastata asiakaspalvelijana yrityksen me-muodossa KONTEKSTIN ja sivujen perusteella

TÄRKEÄÄ:
- Käytä yrityskontekstia (palvelualueet, palvelut, yhteystiedot) vastauksesi pohjana
- ÄLÄ palauta sivuja jotka vain sattuvat liittymään samaan aihepiiriin mutta eivät vastaa KYSYTTYYN asiaan
- Esim. "asennatteko hyvinkäällä" → tarkista kontekstista palvelualue, palauta VAIN sivu joka kattaa alueen
- Jos käyttäjä kysyy RAJATUSTA suosituksesta tai yhteensopivuudesta (esim. käyttökohde, asumismuoto, lupa, viilennys vs lämmitys, koko) → älä suosittele tiettyä tuotetta tai mallia ilman eksplisiittistä näyttöä sivuista
- Vastaa rehellisesti — älä keksi tietoa

Palauta JSON:
{"summary": "Tarkka vastaus kontekstin ja sivujen perusteella" tai null, "pages": [sivunumerot max 2, VAIN tarkalleen relevantit]}
Jos yhtään sivua ei oikeasti vastaa hakuun → {"summary": null, "pages": []}
Palauta VAIN validi JSON.`,
              },
              { role: "user", content: `Hakusana: "${query}"\n\n${site.ai_context ? `YRITYSKONTEKSTI:\n${site.ai_context}\n\n` : ""}Sivut:\n${allPagesContext}` },
            ],
          }),
        });

        if (semanticRes.ok) {
          const semanticData = await semanticRes.json();
          const sContent = semanticData.choices?.[0]?.message?.content || "";
          const jsonStr = sContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const sParsed = JSON.parse(jsonStr);

          if (sParsed.summary) aiSummary = sParsed.summary;

          if (sParsed.pages && Array.isArray(sParsed.pages) && sParsed.pages.length > 0) {
            finalResults = sParsed.pages
              .map((idx: number) => filteredPages[idx - 1])
              .filter(Boolean)
              .map((p: any) => ({
                url: p.url,
                title: p.title || p.url,
                content: p.content || "",
                schema_data: p.schema_data || null,
                score: 50,
                snippet: p.meta_description || (p.content || "").slice(0, 200),
                matchedWords: [],
              }));
          }
        }
      } catch (e) {
        console.error("AI semantic fallback failed:", e);
      }
    }

    // AI Re-ranking (when keyword results exist)
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

        const systemPrompt = useAiGuidance
          ? `Olet yrityksen asiakaspalvelija ja neuvoja. Käyttäjä hakee sivustolta tietoa.

Säännöt:
- Vastaa samalla kielellä kuin haku (suomi/englanti)
- Käytä me-muotoa (yrityksen ääni)
- ${isQuestion ? "Käyttäjä kysyy kysymystä tai vertailua → anna konkreettinen, hyödyllinen vastaus kuin asiantunteva myyjä. Vertaa tuotteita, suosittele, kerro erot." : "Tulokset ovat heikkoja → auta asiakasta: kerro mitä löytyi ja ehdota ottamaan yhteyttä lisätietojen saamiseksi."}
- 1-3 lausetta, konkreettinen ja hyödyllinen
- ÄLÄ kirjoita "Löytyi X tulosta", "Sivustolta löytyy" — käyttäjä näkee tulokset itse
- Jos sivuilta ei löydy oikeaa vastausta → summary: null

Palauta JSON:
{"summary": "Asiakaspalvelijan vastaus" tai null, "ranking": [sivunumerot max 5, VAIN relevantit], "reasoning": ["perustelu per sivu"]}
Palauta VAIN validi JSON.`
          : `Olet hakutulosten uudelleenjärjestäjä. ÄLÄ anna yhteenvetoa, anna vain ranking.

Palauta JSON:
{"summary": null, "ranking": [sivunumerot max 5, VAIN relevantit], "reasoning": ["perustelu per sivu"]}
Palauta VAIN validi JSON.`;

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
                content: `Olet sivustohaun tekoälyavustaja. Päätä ensin TARVITSEEKO käyttäjä tiivistelmää vai riittävätkö hakutulokset sellaisenaan.

MILLOIN summary: null (EI tiivistelmää):
- Tuotenimi/brändi-haku (esim "haori", "mitsubishi", "gree bora") → käyttäjä haluaa selata tuotteita, ei lukea tekstiä
- Yleinen selailu (esim "ilmalämpöpumput", "tuotteet") → tulokset puhuvat puolestaan
- Haku jossa tulokset vastaavat suoraan → turha toistaa samaa tekstinä

MILLOIN summary on hyödyllinen:
- Kysymys (esim "miten tilaan huollon?", "mikä on takuuaika?") → vastaa suoraan 1 lauseella
- Palveluhaku jossa tarvitaan toimintaohje (esim "asennus", "huolto") → kerro miten saa palvelun
- Vertailuhaku (esim "ero mallien välillä") → tiivistä oleellinen ero

Säännöt:
- Vastaa samalla kielellä kuin haku (suomi/englanti)
- Max 1-2 lausetta, yrityksen äänellä (me-muoto)
- ÄLÄ KOSKAAN listaa hintoja tai toista tuotetietoja jotka näkyvät jo tuloksissa
- ÄLÄ KOSKAAN kirjoita "Löytyi X tulosta", "Sivustolta löytyy", "Valikoimasta löytyy"
- Epävarmoissa tapauksissa → summary: null (parempi olla hiljaa kuin olla tyhmä)
- Jos käyttäjä kysyy rajatusta suosituksesta tai yhteensopivuudesta, älä nimeä tiettyä tuotetta, mallia tai brändiä ellei sivuissa sanota eksplisiittisesti että se sopii KAIKKIIN pyydettyihin rajoitteisiin
- Jos näyttö ei riitä täydelliseen suositukseen, anna korkeintaan yleinen ohje ilman mallinimeä TAI palauta summary: null
Palauta JSON:
{"summary": "Suora vastaus" tai null, "ranking": [sivunumerot max 5], "reasoning": ["perustelu per sivu"]}
Palauta VAIN validi JSON.`
              },
              {
                role: "user",
                content: `Hakusana: "${query}"\n\n${site.ai_context ? `YRITYSKONTEKSTI:\n${site.ai_context}\n\n` : ""}Sivut:\n${pagesContext}`
              }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || "";
          
          const jsonMatch = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(jsonMatch);

          if (parsed.summary && useAiGuidance) {
            aiSummary = parsed.summary;
            if (isConstrainedRecommendationQuery && summaryMentionsSpecificBrandOrModel(aiSummary, keywordResults)) {
              aiSummary = undefined;
            }
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
              finalResults = stabilizeRerankedResults(reranked, keywordResults, queryLower, words);
            }
          }
        } else {
          console.error("AI gateway error:", aiResponse.status, await aiResponse.text());
        }
      } catch (aiErr) {
        console.error("AI re-ranking failed, falling back to keyword:", aiErr);
      }
    }

    if (aiSummary && isQuestion && finalResults.length > 1) {
      finalResults = pruneWeakResultsForQuestionQuery(finalResults, queryLower, words);
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
      .slice(0, 5)
      .map((r) => {
        const sd = (r as any).schema_data;
        const isProduct = sd?.type === "Product";
        return {
          url: r.url,
          title: r.title,
          score: Math.round(Math.min(r.score / maxScore, 1) * 100) / 100,
          snippet: r.snippet,
          reasoning: (r as any).aiReasoning || `Matched: ${r.matchedWords.join(", ")}`,
          schema_data: sd || null,
          ...(isProduct && sd?.price ? { price: sd.price, currency: sd.currency || "EUR" } : {}),
        };
      });
      

    const responseMs = Date.now() - startTime;

    // --- STRATEGY: Decide whether to show contact CTA ---
    const interventionIntent = detectQueryIntent(queryLower, triggerRules?.trigger_categories || []);
    let contactConfigResponse: any = undefined;
    let interventionCard: any = undefined;
    if (contactConfig && contactConfig.enabled &&
        (contactConfig.phone || contactConfig.email || contactConfig.chat_url)) {
      let shouldShowContact = false;

      // Rule 1: Show on zero results
      if (results.length === 0 && triggerRules.show_on_zero_results) {
        shouldShowContact = true;
      }

      // Rule 2: Show on low-CTR query patterns
      if (triggerRules.show_on_low_ctr_queries && results.length > 0) {
        // Check total clicks for this query vs how often it was searched
        const totalQueryClicks = Object.values(clickBoosts).reduce((s, c) => s + c, 0);
        // If we have click data and it's low, show contact
        if (totalQueryClicks === 0) {
          shouldShowContact = true;
        }
      }

      // Rule 3: Check trigger categories (keyword match)
      const categories: string[] = triggerRules.trigger_categories || [];
      if (categories.length > 0) {
        for (const cat of categories) {
          if (queryLower.includes(cat.toLowerCase())) {
            shouldShowContact = true;
            break;
          }
        }
      }

      if (shouldShowContact) {
        contactConfigResponse = {
          enabled: true,
          phone: contactConfig.phone,
          email: contactConfig.email,
          chat_url: contactConfig.chat_url,
          cta_text_fi: (contactConfig as any).cta_text_fi || "Etkö löytänyt etsimääsi? Ota yhteyttä!",
          cta_text_en: (contactConfig as any).cta_text_en || "Didn't find what you need? Contact us!",
        };
      }

      interventionCard = await buildInterventionCard({
        query,
        language,
        intent: interventionIntent,
        contactConfig,
        results,
        highCtrPatterns,
        site,
      });
      if (interventionCard) {
        contactConfigResponse = undefined;
      }
    }

    // Log the search
    const { data: insertedSearchLog, error: searchLogErr } = await supabase
      .from("search_logs")
      .insert({
        site_id,
        query,
        results_count: results.length,
        language,
        response_ms: responseMs,
      })
      .select("id")
      .single();

    if (searchLogErr) {
      throw new Error(searchLogErr.message);
    }

    return new Response(JSON.stringify({
      results,
      language,
      response_ms: responseMs,
      search_log_id: insertedSearchLog?.id || undefined,
      ai_summary: aiSummary || undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      intervention_card: interventionCard || undefined,
      contact_config: contactConfigResponse || undefined,
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
  const { site_id, query, url, search_log_id, click_id, session_id, click_position } = body;
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

  // search_click_events table removed – skip insert

  if (search_log_id) {
    await supabase
      .from("search_logs")
      .update({ clicked: true })
      .eq("id", search_log_id)
      .eq("site_id", site_id);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBrandLikeTerms(results: any[]): string[] {
  const stopWords = new Set([
    "paras", "opas", "guide", "kerrostalo", "kerrostalon", "rivitalo", "viilennys",
    "viilennykseen", "jäähdytys", "lämmitys", "cooling", "heating", "apartment",
    "product", "products", "tuote", "tuotteet", "malli", "mallisto", "sarja",
  ]);
  const terms = new Set<string>();

  for (const result of results || []) {
    const title = String(result?.title || "");
    const schema = result?.schema_data;
    if (schema?.brand && typeof schema.brand === "string") {
      terms.add(schema.brand.trim());
    }

    const matches = title.match(/\b[A-ZÅÄÖ][A-Za-zÅÄÖåäö0-9-]{2,}\b/g) || [];
    for (const match of matches) {
      const token = match.trim();
      if (!token || stopWords.has(token.toLowerCase())) continue;
      terms.add(token);
    }
  }

  return Array.from(terms).sort((a, b) => b.length - a.length);
}

function summaryMentionsSpecificBrandOrModel(summary: string | undefined, results: any[]): boolean {
  const text = String(summary || "").trim();
  if (!text) return false;

  const terms = extractBrandLikeTerms(results);
  return terms.some((term) => {
    const pattern = new RegExp(`\\b${escapeRegex(term)}(?:in|n|lle|lta|sta|stä)?\\b`, "i");
    return pattern.test(text);
  });
}

function detectQueryIntent(queryLower: string, triggerCategories: string[]): {
  type: "contact" | "service" | "commercial" | "urgent" | null;
  confidence: number;
  matchedTerms: string[];
} {
  const contactTerms = [
    "yhteystiedot", "yhteystieto", "puhelin", "numero", "sähköposti", "email", "e-mail",
    "asiakaspalvelu", "contact", "contacts", "phone", "call", "whatsapp",
  ];
  const serviceTerms = [
    "huolto", "huoltaa", "asennus", "asentaa", "ajanvaraus", "varaa", "korjaus",
    "repair", "service", "support", "maintenance", "tuki", "varaosa", "varaosat",
  ];
  const commercialTerms = [
    "hinta", "hinnat", "tarjous", "quote", "price", "pricing", "osta", "tilaa", "buy", "order",
  ];
  const urgentTerms = [
    "vika", "rikki", "ei toimi", "vuotaa", "kiire", "heti", "urgent", "broken", "fault",
  ];

  const matchedTerms = new Set<string>();
  let type: "contact" | "service" | "commercial" | "urgent" | null = null;
  let confidence = 0;

  const scoreTerms = (terms: string[], intentType: "contact" | "service" | "commercial" | "urgent", base: number) => {
    const hits = terms.filter((term) => queryLower.includes(term));
    if (hits.length > 0 && base > confidence) {
      type = intentType;
      confidence = base + Math.min(hits.length - 1, 2) * 0.08;
      hits.forEach((hit) => matchedTerms.add(hit));
    }
  };

  scoreTerms(contactTerms, "contact", 0.88);
  scoreTerms(urgentTerms, "urgent", 0.86);
  scoreTerms(serviceTerms, "service", 0.76);
  scoreTerms(commercialTerms, "commercial", 0.72);

  const categoryHits = (triggerCategories || []).filter((cat) => cat && queryLower.includes(String(cat).toLowerCase()));
  if (categoryHits.length > 0) {
    categoryHits.forEach((hit) => matchedTerms.add(String(hit)));
    if (!type) type = "service";
    confidence = Math.max(confidence, 0.78);
  }

  return { type, confidence: Math.min(confidence, 0.98), matchedTerms: Array.from(matchedTerms) };
}

function detectLanguage(query: string): "fi" | "en" {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return "fi";

  if (/[äöå]/i.test(normalized)) return "fi";

  const finnishSignals = [
    "yhteystiedot", "yhteystieto", "puhelin", "numero", "sähköposti", "huolto", "asennus",
    "hinta", "tarjous", "varaus", "ajanvaraus", "vika", "korjaus", "mikä", "mitä", "missä",
    "voiko", "onko", "etsi", "hae", "lähetä", "soita", "näytä",
  ];
  const englishSignals = [
    "contact", "contacts", "phone", "email", "service", "repair", "support", "price",
    "quote", "book", "call", "show", "find", "where", "what", "how", "can i", "urgent",
  ];

  const finnishScore = finnishSignals.reduce((sum, token) => sum + (normalized.includes(token) ? 1 : 0), 0);
  const englishScore = englishSignals.reduce((sum, token) => sum + (normalized.includes(token) ? 1 : 0), 0);
  return finnishScore >= englishScore ? "fi" : "en";
}

async function buildInterventionCard(params: {
  query: string;
  language: "fi" | "en";
  intent: { type: "contact" | "service" | "commercial" | "urgent" | null; confidence: number; matchedTerms: string[] };
  contactConfig: any;
  results: any[];
  highCtrPatterns: { pattern: string; top_url: string; ctr: number }[];
  site: { ai_context?: string | null; name?: string | null; domain?: string | null };
}) {
  const { query, language, intent, contactConfig, results, highCtrPatterns, site } = params;
  if (!intent.type || intent.confidence < 0.72) return undefined;
  if (!results || results.length === 0) return undefined;

  const bestPattern = (highCtrPatterns || []).find((pattern) =>
    pattern?.pattern && query.toLowerCase().includes(pattern.pattern.toLowerCase()),
  );
  const fallbackUrl = bestPattern?.top_url || results[0]?.url || null;

  const actions: Array<{ label: string; url: string; kind: "phone" | "chat" | "email" | "page" }> = [];
  if ((intent.type === "contact" || intent.type === "urgent") && contactConfig.phone) {
    actions.push({
      label: language === "fi" ? `Soita ${contactConfig.phone}` : `Call ${contactConfig.phone}`,
      url: `tel:${contactConfig.phone}`,
      kind: "phone",
    });
  }

  if ((intent.type === "service" || intent.type === "commercial" || intent.type === "urgent") && fallbackUrl) {
    actions.push({
      label: interventionPageLabel(intent.type, language),
      url: fallbackUrl,
      kind: "page",
    });
  }

  if (actions.length < 2 && contactConfig.chat_url) {
    actions.push({
      label: language === "fi" ? "Lähetä viesti" : "Send message",
      url: contactConfig.chat_url,
      kind: "chat",
    });
  }

  if (actions.length < 2 && contactConfig.email) {
    actions.push({
      label: language === "fi" ? "Lähetä sähköposti" : "Send email",
      url: `mailto:${contactConfig.email}`,
      kind: "email",
    });
  }

  if (actions.length === 0) return undefined;

  const contextHint = String(site?.ai_context || "").toLowerCase();
  const coolingHint = /\bviilenn|jäähdy|cool/i.test(query);
  const fallbackTitle = interventionTitle(intent.type, query, language);
  const fallbackBody = interventionBody(intent.type, language, coolingHint, contextHint);
  const aiCopy = await generateInterventionCopy({
    query,
    language,
    intentType: intent.type,
    actions,
    site,
    topResult: results[0],
    fallbackTitle,
    fallbackBody,
  });

  return {
    type: intent.type,
    title: aiCopy?.title || fallbackTitle,
    body: aiCopy?.body || fallbackBody,
    position: intent.type === "contact" || intent.type === "urgent" ? 0 : 2,
    actions: actions.slice(0, 2),
  };
}

async function generateInterventionCopy(params: {
  query: string;
  language: "fi" | "en";
  intentType: "contact" | "service" | "commercial" | "urgent";
  actions: Array<{ label: string; url: string; kind: "phone" | "chat" | "email" | "page" }>;
  site: { ai_context?: string | null; name?: string | null; domain?: string | null };
  topResult?: any;
  fallbackTitle: string;
  fallbackBody: string;
}) {
  if (!LOVABLE_API_KEY) return null;

  const { query, language, intentType, actions, site, topResult, fallbackTitle, fallbackBody } = params;

  try {
    const actionSummary = actions
      .slice(0, 2)
      .map((action) => `${action.kind}: ${action.label}`)
      .join(" | ");

    const prompt = `Kirjoita hakutulos-widgetin intervention-kortille LUONNOLLINEN otsikko ja 1 lyhyt kuvauslause.

Säännöt:
- Kieli: ${language === "fi" ? "suomi" : "english"}
- Ääni: luonnollinen, avulias, kaupallinen mutta ei aggressiivinen
- Älä toista hakua kömpelösti sellaisenaan lainausmerkeissä ellei se ole oikeasti luontevaa
- Älä lupaa mitään mitä konteksti ei tue
- Otsikko max 70 merkkiä
- Kuvaus max 140 merkkiä
- Tee copystä vähemmän geneerinen kuin fallback
- Jos näyttö ei riitä, palauta lähes fallbackin tasoinen turvallinen versio

Konteksti:
- Intent: ${intentType}
- Haku: ${query}
- Yritys: ${site?.name || site?.domain || "site"}
- CTA:t: ${actionSummary}
- Paras osuma: ${topResult?.title || "-"}
${site?.ai_context ? `- Sivustokonteksti: ${String(site.ai_context).slice(0, 900)}` : ""}

Fallback:
- title: ${fallbackTitle}
- body: ${fallbackBody}

Palauta VAIN validi JSON:
{"title":"...", "body":"..."}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            content: "You write concise onsite conversion microcopy. Return JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    const title = String(parsed?.title || "").trim();
    const body = String(parsed?.body || "").trim();
    if (!title) return null;
    return {
      title: title.slice(0, 90),
      body: body ? body.slice(0, 180) : fallbackBody,
    };
  } catch (error) {
    console.error("Intervention copy generation failed:", error);
    return null;
  }
}

function interventionTitle(type: "contact" | "service" | "commercial" | "urgent", query: string, language: "fi" | "en") {
  const cleanQuery = query.replace(/[?!.]+$/g, "").trim();
  if (language === "fi") {
    if (type === "contact") return "Haluatko yhteystiedot heti?";
    if (type === "urgent") return `Tarvitsetko apua nopeasti: ${cleanQuery}?`;
    if (type === "service") return `Etsitkö palvelua hakuun "${cleanQuery}"?`;
    return `Haluatko edetä nopeasti haulla "${cleanQuery}"?`;
  }
  if (type === "contact") return "Do you want the contact details right away?";
  if (type === "urgent") return `Need help quickly with "${cleanQuery}"?`;
  if (type === "service") return `Looking for help with "${cleanQuery}"?`;
  return `Want to move faster with "${cleanQuery}"?`;
}

function interventionBody(
  type: "contact" | "service" | "commercial" | "urgent",
  language: "fi" | "en",
  coolingHint: boolean,
  contextHint: string,
) {
  const mentionsOnlyCooling = coolingHint && /(viilennys|jäähdytys|cool)/i.test(contextHint) && !/(lämmitys|heating)/i.test(contextHint);
  if (language === "fi") {
    if (type === "contact") return "Voit avata yhteystiedot suoraan tästä ilman ylimääräisiä klikkauksia.";
    if (type === "urgent") return "Kun intentti on selvästi kiireellinen, suora yhteydenotto toimii usein nopeammin kuin lisähaku.";
    if (mentionsOnlyCooling) return "Näytämme tähän suoran etenemisvaihtoehdon, koska haussa on vahva palveluintentti ja sisältö viittaa rajattuun käyttötarkoitukseen.";
    if (type === "service") return "Hakusi viittaa vahvaan palveluintenttiin, joten voit siirtyä suoraan sopivalle sivulle tai ottaa yhteyttä heti.";
    return "Hakusi näyttää kaupalliselta, joten tarjoamme suoran etenemisvaihtoehdon hakutulosten rinnalle.";
  }
  if (type === "contact") return "You can open the contact details directly from here without extra searching.";
  if (type === "urgent") return "When the intent looks urgent, direct contact often works faster than browsing more results.";
  if (type === "service") return "Your query shows strong service intent, so we offer a direct next step alongside the results.";
  return "Your query looks commercially strong, so we surface a direct next step next to the results.";
}

function interventionPageLabel(type: "contact" | "service" | "commercial" | "urgent", language: "fi" | "en") {
  if (language === "fi") {
    if (type === "contact") return "Näytä yhteystiedot";
    if (type === "urgent") return "Avaa sopiva sivu";
    if (type === "service") return "Avaa sopiva sivu";
    return "Katso vaihtoehto";
  }
  if (type === "contact") return "View contact details";
  if (type === "urgent") return "Open suggested page";
  if (type === "service") return "Open suggested page";
  return "View option";
}

function stabilizeRerankedResults(reranked: any[], keywordResults: any[], queryLower: string, words: string[]) {
  const serviceQuery = /\b(asennus|asentaa|huolto|huoltaa|korjaus|repair|service|support|maintenance)\b/i.test(queryLower);
  const explicitProductIntent = /\b(mitsubishi|toshiba|gree|daikin|haori|tuote|tuotteet|product|products|malli|mallit)\b/i.test(queryLower);
  const locationWords = words.filter((word) =>
    word.length >= 4 &&
    !/\b(asennus|asentaa|huolto|huoltaa|korjaus|repair|service|support|maintenance|ilmalämpöpumppu|ilmalämpöpumput|lämpöpumppu|lämpöpumput)\b/i.test(word),
  );

  if (!serviceQuery || explicitProductIntent) {
    return reranked;
  }

  const aiOrder = new Map(reranked.map((item, idx) => [item.url, idx]));
  const keywordOrder = new Map(keywordResults.map((item, idx) => [item.url, idx]));

  const scoreResult = (result: any) => {
    const haystack = `${result.title || ""} ${(result.snippet || "")} ${(result.content || "").slice(0, 250)} ${result.url || ""}`.toLowerCase();
    const schema = result.schema_data;
    const isProduct = schema?.type === "Product" || /\/products?\//i.test(String(result.url || ""));
    const locationMatches = locationWords.filter((word) => haystack.includes(word)).length;
    const serviceMatches = /\b(asennus|asentaa|huolto|huoltaa|korjaus|repair|service|support|maintenance)\b/i.test(haystack) ? 1 : 0;

    let guardScore = 0;
    if (!isProduct) guardScore += 3;
    if (locationMatches > 0) guardScore += locationMatches * 4;
    if (serviceMatches) guardScore += 2;
    if (isProduct) guardScore -= 4;
    guardScore += Math.min(Number(result.score) || 0, 100) / 100;

    return guardScore;
  };

  return [...reranked].sort((a, b) => {
    const diff = scoreResult(b) - scoreResult(a);
    if (Math.abs(diff) > 0.75) return diff;
    return (aiOrder.get(a.url) ?? 999) - (aiOrder.get(b.url) ?? 999)
      || (keywordOrder.get(a.url) ?? 999) - (keywordOrder.get(b.url) ?? 999);
  });
}

function pruneWeakResultsForQuestionQuery(finalResults: any[], queryLower: string, words: string[]) {
  const specificTerms = extractSpecificQueryTerms(queryLower, words);
  if (specificTerms.length === 0) {
    return finalResults.slice(0, 3);
  }

  const scored = finalResults.map((result, idx) => {
    const haystack = `${result.title || ""} ${result.snippet || ""} ${(result.content || "").slice(0, 500)}`.toLowerCase();
    const termMatches = specificTerms.filter((term) => haystack.includes(term)).length;
    const exactQuestionHit = specificTerms.some((term) => (result.title || "").toLowerCase().includes(term));
    return { result, idx, termMatches, exactQuestionHit };
  });

  const filtered = scored.filter((entry) => entry.termMatches > 0 || entry.exactQuestionHit);
  if (filtered.length > 0) {
    return filtered
      .sort((a, b) => b.termMatches - a.termMatches || Number(b.exactQuestionHit) - Number(a.exactQuestionHit) || a.idx - b.idx)
      .map((entry) => entry.result)
      .slice(0, 3);
  }

  return finalResults.slice(0, Math.min(2, finalResults.length));
}

function extractSpecificQueryTerms(queryLower: string, words: string[]) {
  const genericTerms = new Set([
    "mitä", "miten", "miksi", "milloin", "missä", "voiko", "onko", "jos", "kun", "että", "tehdä",
    "ilmalämpöpumppu", "ilmalämpöpumput", "lämpöpumppu", "lämpöpumput", "laite", "laitteet",
    "se", "ne", "tämä", "tuo", "with", "what", "how", "why", "when", "where", "can", "should",
    "if", "the", "a", "an", "do", "does",
  ]);

  return words
    .map((word) => String(word || "").trim().toLowerCase())
    .filter((word) => word.length >= 4 && !genericTerms.has(word));
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
