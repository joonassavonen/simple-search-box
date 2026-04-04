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
      try {
        const parsed = new URL(u);
        const path = parsed.pathname.toLowerCase();
        // Skip sitemap XML files
        if (path.includes("sitemap") || path.endsWith(".xml")) return false;
        // Skip non-HTML resources
        const skipExts = [".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".css", ".js", ".webp", ".ico", ".woff", ".woff2", ".ttf"];
        if (skipExts.some(ext => path.endsWith(ext))) return false;
        return true;
      } catch {
        return false;
      }
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
        const title = extractTitle(html) || titleFromUrl(url);
        const metaDesc = extractMetaDescription(html);
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
              meta_description: metaDesc || null,
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
  // Try <title> first
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch) {
    const title = decodeEntities(titleMatch[1].trim());
    // Clean up common suffixes like "| Site Name" or "- Site Name"
    const cleaned = title.split(/\s*[|–—]\s*/)[0].trim();
    if (cleaned.length > 2) return cleaned;
  }
  // Fallback to <h1>
  const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
  if (h1Match) {
    const h1 = decodeEntities(h1Match[1].replace(/<[^>]+>/g, "").trim());
    if (h1.length > 2) return h1;
  }
  return null;
}

function titleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    const lastSegment = path.split("/").pop() || "";
    return lastSegment
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || url;
  } catch {
    return url;
  }
}

function extractTextContent(html: string): string {
  // Try to find main content area first
  let mainContent = html;
  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i) ||
    html.match(/<article[\s\S]*?<\/article>/i) ||
    html.match(/<div[^>]*(?:content|main|body)[^>]*>[\s\S]*?<\/div>/i);
  if (mainMatch) {
    mainContent = mainMatch[0];
  }

  let text = mainContent
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
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
