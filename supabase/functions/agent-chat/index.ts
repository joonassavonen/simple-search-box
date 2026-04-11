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

  try {
    const body = await req.json();
    const { site_id, messages, query } = body;

    if (!site_id || (!messages && !query)) {
      return new Response(JSON.stringify({ error: "site_id and messages/query required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify site exists and is active
    const { data: site } = await supabase
      .from("sites")
      .select("id, is_active, ai_context, agent_prompt, name, domain")
      .eq("id", site_id)
      .single();

    if (!site || !site.is_active) {
      return new Response(JSON.stringify({ error: "Site not found or inactive" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gather context: pages (titles, URLs, snippets)
    const { data: pages } = await supabase
      .from("pages")
      .select("url, title, content, meta_description, schema_data")
      .eq("site_id", site_id)
      .limit(200);

    const filteredPages = (pages || []).filter((p) => {
      try { return new URL(p.url).pathname !== "/"; } catch { return true; }
    });

    // Build page context (concise for token efficiency)
    const pagesContext = filteredPages.slice(0, 60).map((p, i) => {
      const schema = p.schema_data;
      let meta = "";
      if (schema?.type === "Product") {
        const parts: string[] = [];
        if (schema.price) parts.push(`${schema.price}€`);
        if (schema.availability) {
          const avail = String(schema.availability).split("/").pop() || "";
          if (avail.toLowerCase() === "instock") parts.push("Varastossa");
          else if (avail.toLowerCase() === "outofstock") parts.push("Loppu");
        }
        if (schema.rating) parts.push(`${schema.rating}/5`);
        if (schema.image) parts.push(`kuva:${schema.image}`);
        meta = ` [TUOTE: ${parts.join(", ")}]`;
      }
      const content = (p.content || p.meta_description || "").slice(0, 300);
      return `[${i + 1}] ${p.title || "?"}${meta}\nURL: ${p.url}\n${content}`;
    }).join("\n\n");

    // Get contact config
    const { data: contactConfig } = await supabase
      .from("site_contact_configs")
      .select("enabled, email, phone, chat_url")
      .eq("site_id", site_id)
      .single();

    // Get trending/popular data
    const { data: clickData } = await supabase
      .from("search_clicks")
      .select("page_url, query, click_count")
      .eq("site_id", site_id)
      .order("click_count", { ascending: false })
      .limit(20);

    const popularContext = (clickData || []).slice(0, 10)
      .map(c => `"${c.query}" → ${c.page_url} (${c.click_count} klikkiä)`)
      .join("\n");

    // Build system prompt
    const contactInfo = contactConfig?.enabled
      ? `\nYHTEYSTIEDOT (tarjoa näitä tarvittaessa):\n${contactConfig.phone ? `Puhelin: ${contactConfig.phone}` : ""}${contactConfig.email ? `\nSähköposti: ${contactConfig.email}` : ""}${contactConfig.chat_url ? `\nChat: ${contactConfig.chat_url}` : ""}`
      : "";

    const customPrompt = site.agent_prompt?.trim() || "";
    const aiContext = site.ai_context?.trim() || "";

    const systemPrompt = `Olet ${site.name || site.domain} -sivuston asiakaspalvelija ja hakuassistentti.

ROOLI JA KÄYTTÄYTYMINEN:
- Olet ystävällinen ja asiantunteva asiakaspalvelija
- Vastaat aina yrityksen me-muodossa ("meillä on", "tarjoamme")
- Pidät vastaukset tiiviinä (1-4 lausetta) mutta informatiivisina
- Jos et tiedä vastausta, sano se rehellisesti ja ehdota ottamaan yhteyttä
- Tunnista asiakkaan tarve ja ohjaa oikealle sivulle
- Vastaa samalla kielellä kuin asiakas (suomi/englanti)

TÄRKEÄÄ TULOSTEN ESITTÄMISESSÄ:
- Kun suosittelet sivuja tai tuotteita, käytä AINA markdown-linkkejä: [Sivun otsikko](URL)
- Tuotteiden kohdalla mainitse hinta ja saatavuus jos tiedossa
- Tarjoa 1-3 relevanttia linkkiä, älä listaa kaikkea
- Jos asiakkaan haku on epämääräinen, kysy tarkentava jatkokysymys

JATKOKYSYMYKSET:
- Tarjoa aina lopussa 1-2 jatkokysymysehdotusta asiakkaan tarpeeseen liittyen
- Muotoile ne luonnollisesti: "Haluatko tietää lisää X:stä?" tai "Voinko auttaa myös Y:n kanssa?"

${customPrompt ? `YRITYKSEN OMAT OHJEET:\n${customPrompt}\n` : ""}
${aiContext ? `YRITYSKONTEKSTI:\n${aiContext}\n` : ""}
${contactInfo}

${popularContext ? `SUOSITUIMMAT HAUT:\n${popularContext}\n` : ""}

SIVUSTON SISÄLTÖ (käytä näitä vastaamiseen):
${pagesContext}`;

    // Build messages array
    const chatMessages = messages
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : [{ role: "system", content: systemPrompt }, { role: "user", content: query }];

    // Stream from Lovable AI
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: chatMessages,
        stream: true,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log the chat query
    const userMsg = messages
      ? messages.filter((m: any) => m.role === "user").pop()?.content || ""
      : query;
    
    await supabase.from("search_logs").insert({
      site_id,
      query: String(userMsg).slice(0, 500),
      results_count: 0,
      language: detectLanguage(String(userMsg)),
      response_ms: 0,
    }).catch(() => {});

    return new Response(aiResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("agent-chat error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function detectLanguage(text: string): string {
  const fiChars = /[äöåÄÖÅ]/;
  if (fiChars.test(text)) return "fi";
  const fiWords = ["mitä","mikä","kuinka","miten","missä","milloin","miksi","onko","voiko","haluaisin","tarvitsen"];
  const words = text.toLowerCase().split(/\s+/);
  return words.some(w => fiWords.includes(w)) ? "fi" : "en";
}
