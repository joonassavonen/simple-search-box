import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function doCrawl(jobId: string, siteId: string) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const startedAt = Date.now();
  const SOFT_TIME_LIMIT_MS = 75_000;
  const PROGRESS_UPDATE_INTERVAL = 5;

  let indexed = 0;
  let pagesFound = 0;
  const errors: string[] = [];
  let timedOut = false;

  const updateJob = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from("crawl_jobs").update(patch).eq("id", jobId);
    if (error) {
      console.error("Failed to update crawl job:", error);
    }
  };

  try {
    await updateJob({
      status: "running",
      error: null,
      pages_found: 0,
      pages_indexed: 0,
    });

    const { data: site, error: siteErr } = await supabase
      .from("sites")
      .select("*")
      .eq("id", siteId)
      .single();

    if (siteErr || !site) {
      await updateJob({ status: "error", error: "Site not found" });
      return;
    }

    const domain = site.domain.replace(/\/$/, "");
    const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;

    let urls: string[] = [];
    const sitemapUrl = site.sitemap_url || `${baseUrl}/sitemap.xml`;

    try {
      console.log(`Fetching sitemap: ${sitemapUrl}`);
      const sitemapRes = await fetch(sitemapUrl, {
        headers: { "User-Agent": "FindAI-Crawler/1.0" },
      });

      if (sitemapRes.ok) {
        const xml = await sitemapRes.text();
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

    urls = [...new Set(urls)].filter((u) => {
      try {
        const parsed = new URL(u);
        const path = parsed.pathname.toLowerCase();
        if (path.includes("sitemap") || path.endsWith(".xml")) return false;
        const skipExts = [".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".css", ".js", ".webp", ".ico", ".woff", ".woff2", ".ttf"];
        if (skipExts.some((ext) => path.endsWith(ext))) return false;
        return true;
      } catch {
        return false;
      }
    });

    pagesFound = urls.length;
    console.log(`Sitemap discovery complete: ${pagesFound} URLs found, crawling ${pagesFound}`);

    await updateJob({
      status: "running",
      pages_found: pagesFound,
    });

    try {
      console.log(`Extracting brand styles from ${baseUrl}`);
      const homeRes = await fetch(baseUrl, {
        headers: { "User-Agent": "FindAI-Crawler/1.0" },
        redirect: "follow",
      });
      if (homeRes.ok) {
        const homeHtml = await homeRes.text();
        const brand = extractBrandStyles(homeHtml);
        if (brand.color || brand.font || brand.bgColor) {
          await supabase.from("sites").update({
            brand_color: brand.color || null,
            brand_font: brand.font || null,
            brand_bg_color: brand.bgColor || null,
          }).eq("id", siteId);
          console.log("Brand styles extracted:", brand);
        }
      } else {
        await homeRes.text();
      }
    } catch (e) {
      console.log("Brand extraction failed (non-fatal):", e);
    }

    for (const url of urls) {
      if (Date.now() - startedAt > SOFT_TIME_LIMIT_MS) {
        timedOut = true;
        errors.push(`Crawl stopped early to avoid runtime timeout after ${indexed}/${pagesFound} pages`);
        break;
      }

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
        let schemaData = extractJsonLd(html);
        
        // If no schema or no price, try Shopify JSON endpoint for product pages
        if ((!schemaData || (schemaData?.type === "Product" && !schemaData?.price)) && url.includes("/products/")) {
          try {
            const jsonUrl = url.replace(/\?.*$/, "") + ".json";
            const jsonRes = await fetch(jsonUrl, { headers: { "User-Agent": "FindAI-Crawler/1.0" } });
            if (jsonRes.ok) {
              const jsonData = await jsonRes.json();
              const prod = jsonData.product;
              if (prod) {
                const variant = prod.variants?.[0];
                schemaData = {
                  type: "Product",
                  name: prod.title,
                  description: (prod.body_html || "").replace(/<[^>]*>/g, "").slice(0, 300),
                  price: variant?.price || null,
                  currency: "EUR",
                  image: prod.image?.src || prod.images?.[0]?.src || null,
                };
              }
            } else {
              await jsonRes.text(); // consume body
            }
          } catch { /* non-fatal */ }
        }
        
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
              schema_data: schemaData || null,
              last_indexed_at: new Date().toISOString(),
            },
            { onConflict: "site_id,url" },
          );

        if (upsertErr) {
          errors.push(`${url}: DB error - ${upsertErr.message}`);
          continue;
        }

        indexed += 1;
        if (indexed % PROGRESS_UPDATE_INTERVAL === 0) {
          await updateJob({
            status: "running",
            pages_found: pagesFound,
            pages_indexed: indexed,
          });
        }
      } catch (e) {
        errors.push(`${url}: ${(e as Error).message}`);
      }
    }

    const finalStatus = timedOut || (indexed === 0 && errors.length > 0) ? "error" : "done";

    await updateJob({
      status: finalStatus,
      pages_indexed: indexed,
      pages_found: pagesFound,
      error: errors.length > 0 ? errors.slice(0, 10).join("; ") : null,
    });

    if (indexed > 0) {
      await supabase.from("sites").update({
        page_count: indexed,
        last_crawled_at: new Date().toISOString(),
      }).eq("id", siteId);
    }

    console.log(`Crawl complete: ${indexed}/${pagesFound} pages indexed, ${errors.length} errors`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown crawl error";
    console.error("Crawl error:", e);
    await updateJob({
      status: "error",
      pages_indexed: indexed,
      pages_found: pagesFound,
      error: message,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const jobId = typeof payload?.job_id === "string" ? payload.job_id : null;
    const siteId = typeof payload?.site_id === "string" ? payload.site_id : null;

    if (!jobId || !siteId) {
      return new Response(JSON.stringify({ error: "job_id and site_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // @ts-ignore: EdgeRuntime is available in Supabase Edge Functions
    EdgeRuntime.waitUntil(doCrawl(jobId, siteId));

    return new Response(JSON.stringify({ status: "started", job_id: jobId }), {
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

function extractMetaDescription(html: string): string | null {
  const match = html.match(/<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["'](.*?)["'][^>]*>/i)
    || html.match(/<meta\s+[^>]*content\s*=\s*["'](.*?)["'][^>]*name\s*=\s*["']description["'][^>]*>/i);
  if (match) {
    const desc = decodeEntities(match[1].trim());
    if (desc.length > 10) return desc;
  }
  return null;
}

function extractJsonLd(html: string): Record<string, any> | null {
  const scripts = [...html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (scripts.length === 0) return null;

  for (const match of scripts) {
    try {
      const data = JSON.parse(match[1].trim());
      const items = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];

      for (const item of items) {
        const type = item["@type"];
        if (!type) continue;

        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
          const offers = item.offers;
          const offer = Array.isArray(offers) ? offers[0] : offers?.["@type"] === "AggregateOffer" ? offers : offers;
          return {
            type: "Product",
            name: item.name,
            description: item.description?.slice(0, 300),
            price: offer?.price || offer?.lowPrice,
            currency: offer?.priceCurrency,
            availability: offer?.availability,
            image: typeof item.image === "string" ? item.image : item.image?.[0] || item.image?.url,
            rating: item.aggregateRating?.ratingValue,
            reviewCount: item.aggregateRating?.reviewCount,
          };
        }

        if (type === "Article" || type === "NewsArticle" || type === "BlogPosting") {
          return {
            type: "Article",
            name: item.headline || item.name,
            description: item.description?.slice(0, 300),
            datePublished: item.datePublished,
            author: typeof item.author === "string" ? item.author : item.author?.name,
            image: typeof item.image === "string" ? item.image : item.image?.[0] || item.image?.url,
          };
        }

        if (type === "Event") {
          return {
            type: "Event",
            name: item.name,
            description: item.description?.slice(0, 300),
            startDate: item.startDate,
            location: typeof item.location === "string" ? item.location : item.location?.name || item.location?.address?.addressLocality,
            image: typeof item.image === "string" ? item.image : item.image?.[0],
          };
        }

        if (type === "FAQPage") {
          const questions = (item.mainEntity || []).slice(0, 5).map((q: any) => ({
            q: q.name,
            a: q.acceptedAnswer?.text?.slice(0, 200),
          }));
          return { type: "FAQPage", questions };
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

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

// --- Brand style extraction from HTML/CSS ---

function extractBrandStyles(html: string): { color: string | null; font: string | null; bgColor: string | null } {
  let color: string | null = null;
  let font: string | null = null;
  let bgColor: string | null = null;

  // Collect all inline <style> blocks
  const styleBlocks: string[] = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    styleBlocks.push(m[1]);
  }
  const allCss = styleBlocks.join("\n");

  // Also check for CSS custom properties in :root
  const rootMatch = allCss.match(/:root\s*\{([^}]+)\}/i);
  const rootVars = rootMatch ? rootMatch[1] : "";

  // 1. Extract primary color
  // Try CSS custom properties first (--primary, --brand-color, --color-primary, etc.)
  const colorVarPatterns = [
    /--(?:primary|brand-color|color-primary|main-color|accent)\s*:\s*([^;]+)/i,
    /--(?:primary-color|brand|theme-color)\s*:\s*([^;]+)/i,
  ];
  for (const pat of colorVarPatterns) {
    const match = rootVars.match(pat) || allCss.match(pat);
    if (match) {
      const val = match[1].trim();
      if (isColorValue(val)) {
        color = normalizeColor(val);
        break;
      }
    }
  }

  // Fallback: check <meta name="theme-color">
  if (!color) {
    const themeColorMatch = html.match(/<meta\s+[^>]*name\s*=\s*["']theme-color["'][^>]*content\s*=\s*["']([^"']+)["']/i)
      || html.match(/<meta\s+[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']theme-color["']/i);
    if (themeColorMatch) {
      color = normalizeColor(themeColorMatch[1].trim());
    }
  }

  // Fallback: most common non-trivial color in link/button styles
  if (!color) {
    const btnLinkColors: Record<string, number> = {};
    const btnPatterns = [
      /(?:\.btn|\.button|a|\.cta|\.nav)[^{]*\{[^}]*(?:background-color|background)\s*:\s*([^;}\s]+)/gi,
      /(?:\.btn|\.button|\.cta)[^{]*\{[^}]*color\s*:\s*([^;}\s]+)/gi,
    ];
    for (const pat of btnPatterns) {
      for (const m of allCss.matchAll(pat)) {
        const c = normalizeColor(m[1].trim());
        if (c && !isTrivialColor(c)) {
          btnLinkColors[c] = (btnLinkColors[c] || 0) + 1;
        }
      }
    }
    const sorted = Object.entries(btnLinkColors).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      color = sorted[0][0];
    }
  }

  // 2. Extract font family
  // Try CSS variables first
  const fontVarPatterns = [
    /--(?:font-family|font-primary|body-font|font-sans|font-base)\s*:\s*([^;]+)/i,
  ];
  for (const pat of fontVarPatterns) {
    const match = rootVars.match(pat) || allCss.match(pat);
    if (match) {
      font = cleanFontName(match[1].trim());
      break;
    }
  }

  // Fallback: font-family on body or html
  if (!font) {
    const bodyFontMatch = allCss.match(/(?:body|html)\s*(?:,\s*[\w.*#[\]]+\s*)*\{[^}]*font-family\s*:\s*([^;]+)/i);
    if (bodyFontMatch) {
      font = cleanFontName(bodyFontMatch[1].trim());
    }
  }

  // Fallback: check Google Fonts link
  if (!font) {
    const gfMatch = html.match(/fonts\.googleapis\.com\/css2?\?family=([^&"']+)/i);
    if (gfMatch) {
      font = decodeURIComponent(gfMatch[1]).split(":")[0].replace(/\+/g, " ");
    }
  }

  // 3. Extract background color
  const bgVarPatterns = [
    /--(?:background|bg-color|bg|background-color)\s*:\s*([^;]+)/i,
  ];
  for (const pat of bgVarPatterns) {
    const match = rootVars.match(pat) || allCss.match(pat);
    if (match) {
      const val = match[1].trim();
      if (isColorValue(val)) {
        bgColor = normalizeColor(val);
        break;
      }
    }
  }

  if (!bgColor) {
    const bodyBgMatch = allCss.match(/(?:body|html)\s*(?:,\s*[\w.*#[\]]+\s*)*\{[^}]*background(?:-color)?\s*:\s*([^;}\s]+)/i);
    if (bodyBgMatch) {
      const val = normalizeColor(bodyBgMatch[1].trim());
      if (val) bgColor = val;
    }
  }

  return { color, font, bgColor };
}

function isColorValue(val: string): boolean {
  if (val.startsWith("#")) return true;
  if (val.startsWith("rgb")) return true;
  if (val.startsWith("hsl")) return true;
  const namedColors = ["white", "black", "red", "blue", "green", "gray", "grey", "transparent", "inherit", "initial", "unset"];
  if (namedColors.includes(val.toLowerCase())) return true;
  return false;
}

function normalizeColor(val: string): string | null {
  if (!val) return null;
  // Remove !important and trim
  val = val.replace(/!important/gi, "").trim();
  if (val.startsWith("#") || val.startsWith("rgb") || val.startsWith("hsl")) return val;
  if (/^[a-z]+$/i.test(val) && isColorValue(val)) return val;
  return null;
}

function isTrivialColor(c: string): boolean {
  const trivial = ["#fff", "#ffffff", "#000", "#000000", "white", "black", "transparent", "inherit", "initial", "#333", "#333333", "#666", "#666666", "#999", "#ccc", "#eee", "#f5f5f5", "#fafafa"];
  return trivial.includes(c.toLowerCase());
}

function cleanFontName(val: string): string {
  // Take the first font in the stack, remove quotes
  const first = val.split(",")[0].trim().replace(/["']/g, "");
  // Skip generic families
  const generics = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "-apple-system", "BlinkMacSystemFont"];
  if (generics.includes(first.toLowerCase())) {
    // Try second font
    const parts = val.split(",");
    if (parts.length > 1) {
      const second = parts[1].trim().replace(/["']/g, "");
      if (!generics.includes(second.toLowerCase())) return second;
    }
    return first;
  }
  return first;
}
