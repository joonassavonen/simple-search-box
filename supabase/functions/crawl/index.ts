import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.49.1/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { job_id, site_id } = await req.json();
    if (!job_id || !site_id) {
      return new Response(JSON.stringify({ error: "job_id and site_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Update job to running
    await supabase.from("crawl_jobs").update({ status: "running" }).eq("id", job_id);

    // Get site info
    const { data: site, error: siteErr } = await supabase
      .from("sites")
      .select("*")
      .eq("id", site_id)
      .single();

    if (siteErr || !site) {
      await supabase.from("crawl_jobs").update({ status: "failed", error: "Site not found" }).eq("id", job_id);
      return new Response(JSON.stringify({ error: "Site not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const domain = site.domain.replace(/\/$/, "");
    const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;

    // Discover URLs from sitemap or fallback to homepage
    let urls: string[] = [];

    const sitemapUrl = site.sitemap_url || `${baseUrl}/sitemap.xml`;
    try {
      const sitemapRes = await fetch(sitemapUrl, {
        headers: { "User-Agent": "FindAI-Crawler/1.0" },
      });
      if (sitemapRes.ok) {
        const xml = await sitemapRes.text();
        // Parse <loc> tags from sitemap XML
        const locMatches = xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi);
        for (const m of locMatches) {
          urls.push(m[1]);
        }
      }
    } catch (e) {
      console.log("Sitemap fetch failed, falling back to homepage:", e);
    }

    // Fallback: just crawl homepage
    if (urls.length === 0) {
      urls = [baseUrl];
    }

    // Cap at 50 pages for MVP
    urls = urls.slice(0, 50);

    await supabase.from("crawl_jobs").update({ pages_found: urls.length }).eq("id", job_id);

    let indexed = 0;
    const errors: string[] = [];

    for (const url of urls) {
      try {
        const pageRes = await fetch(url, {
          headers: { "User-Agent": "FindAI-Crawler/1.0" },
          redirect: "follow",
        });

        if (!pageRes.ok) {
          errors.push(`${url}: HTTP ${pageRes.status}`);
          continue;
        }

        const html = await pageRes.text();
        const title = extractTitle(html);
        const content = extractTextContent(html);

        if (!content || content.length < 10) {
          errors.push(`${url}: no content`);
          continue;
        }

        // Upsert page
        const { error: upsertErr } = await supabase
          .from("pages")
          .upsert(
            {
              site_id,
              url,
              title: title || url,
              content: content.slice(0, 50000), // cap content size
              last_indexed_at: new Date().toISOString(),
            },
            { onConflict: "site_id,url" }
          );

        if (upsertErr) {
          errors.push(`${url}: DB error - ${upsertErr.message}`);
          continue;
        }

        indexed++;
        // Update progress every 5 pages
        if (indexed % 5 === 0) {
          await supabase
            .from("crawl_jobs")
            .update({ pages_indexed: indexed })
            .eq("id", job_id);
        }
      } catch (e) {
        errors.push(`${url}: ${(e as Error).message}`);
      }
    }

    // Final update
    const finalStatus = errors.length > 0 && indexed > 0
      ? "done_with_errors"
      : errors.length > 0
      ? "failed"
      : "done";

    await supabase.from("crawl_jobs").update({
      status: finalStatus,
      pages_indexed: indexed,
      pages_found: urls.length,
      error: errors.length > 0 ? errors.slice(0, 10).join("; ") : null,
    }).eq("id", job_id);

    // Update site stats
    await supabase.from("sites").update({
      page_count: indexed,
      last_crawled_at: new Date().toISOString(),
    }).eq("id", site_id);

    return new Response(JSON.stringify({
      status: finalStatus,
      pages_found: urls.length,
      pages_indexed: indexed,
      errors: errors.slice(0, 10),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Crawl error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return match ? decodeEntities(match[1].trim()) : null;
}

function extractTextContent(html: string): string {
  // Remove script, style, nav, header, footer tags and their content
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return decodeEntities(text);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
