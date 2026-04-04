import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function doCrawl(jobId: string, siteId: string) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // Update job to discovering
    await supabase.from("crawl_jobs").update({ status: "discovering" }).eq("id", jobId);

    // Get site info
    const { data: site, error: siteErr } = await supabase
      .from("sites")
      .select("*")
      .eq("id", siteId)
      .single();

    if (siteErr || !site) {
      await supabase.from("crawl_jobs").update({ status: "failed", error: "Site not found" }).eq("id", jobId);
      return;
    }

    const domain = site.domain.replace(/\/$/, "");
    const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;

    // --- Phase 1: Discover URLs from sitemap ---
    let urls: string[] = [];
    const sitemapUrl = site.sitemap_url || `${baseUrl}/sitemap.xml`;

    try {
      console.log(`Fetching sitemap: ${sitemapUrl}`);
      const sitemapRes = await fetch(sitemapUrl, {
        headers: { "User-Agent": "FindAI-Crawler/1.0" },
      });
      if (sitemapRes.ok) {
        const xml = await sitemapRes.text();

        // Check if this is a sitemap index
        const sitemapIndexMatches = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*(.*?)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)];
        if (sitemapIndexMatches.length > 0) {
          console.log(`Found sitemap index with ${sitemapIndexMatches.length} child sitemaps`);
          for (const sm of sitemapIndexMatches.slice(0, 5)) {
            try {
              const childRes = await fetch(sm[1], {
                headers: { "User-Agent": "FindAI-Crawler/1.0" },
              });
              if (childRes.ok) {
                const childXml = await childRes.text();
                for (const m of childXml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)) {
                  urls.push(m[1]);
                }
              } else {
                await childRes.text();
              }
            } catch (e) {
              console.log(`Child sitemap ${sm[1]} failed:`, e);
            }
          }
        } else {
          for (const m of xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)) {
            urls.push(m[1]);
          }
        }
      } else {
        await sitemapRes.text();
      }
    } catch (e) {
      console.log("Sitemap fetch failed, falling back to homepage:", e);
    }

    if (urls.length === 0) {
      urls = [baseUrl];
    }

    // Filter out non-HTML URLs (sitemaps, images, PDFs, etc.)
    urls = urls.filter((u) => {
      const lower = u.toLowerCase();
      return !lower.includes("sitemap") &&
        !lower.endsWith(".xml") &&
        !lower.endsWith(".pdf") &&
        !lower.endsWith(".jpg") &&
        !lower.endsWith(".png") &&
        !lower.endsWith(".gif") &&
        !lower.endsWith(".svg") &&
        !lower.endsWith(".css") &&
        !lower.endsWith(".js");
    });

    // Cap at 50 pages for MVP
    const totalFound = urls.length;
    urls = urls.slice(0, 50);

    console.log(`Sitemap discovery complete: ${totalFound} URLs found, crawling ${urls.length}`);

    // Update pages_found immediately
    await supabase.from("crawl_jobs").update({
      pages_found: urls.length,
      status: "crawling",
    }).eq("id", jobId);

    // --- Phase 2: Crawl each page ---
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

        const { error: upsertErr } = await supabase
          .from("pages")
          .upsert(
            {
              site_id: siteId,
              url,
              title: title || url,
              content: content.slice(0, 50000),
              last_indexed_at: new Date().toISOString(),
            },
            { onConflict: "site_id,url" }
          );

        if (upsertErr) {
          errors.push(`${url}: DB error - ${upsertErr.message}`);
          continue;
        }

        indexed++;
        if (indexed % 5 === 0) {
          await supabase
            .from("crawl_jobs")
            .update({ pages_indexed: indexed })
            .eq("id", jobId);
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
    }).eq("id", jobId);

    await supabase.from("sites").update({
      page_count: indexed,
      last_crawled_at: new Date().toISOString(),
    }).eq("id", siteId);

    console.log(`Crawl complete: ${indexed}/${urls.length} pages indexed, ${errors.length} errors`);
  } catch (e) {
    console.error("Crawl error:", e);
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await supabase.from("crawl_jobs").update({
      status: "failed",
      error: (e as Error).message,
    }).eq("id", jobId);
  }
}

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

    // Run crawl in background using EdgeRuntime.waitUntil
    // This returns immediately so the client doesn't time out
    EdgeRuntime.waitUntil(doCrawl(job_id, site_id));

    return new Response(JSON.stringify({ status: "started", job_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Crawl invocation error:", e);
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
