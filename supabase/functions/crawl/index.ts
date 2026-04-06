import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FETCH_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(`Timed out after ${timeoutMs}ms`), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function cleanupStaleJobs(supabase: any, siteId: string, currentJobId: string) {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("crawl_jobs")
    .update({
      status: "partial",
      error: "Crawl interrupted before completion. You can resume from this job.",
    })
    .eq("site_id", siteId)
    .neq("id", currentJobId)
    .in("status", ["running", "discovering", "crawling"])
    .lt("updated_at", staleBefore)
    .gt("pages_found", 0);

  if (error) {
    console.error("Failed to clean up stale crawl jobs:", error);
  }
}

async function doCrawl(jobId: string, siteId: string, resumeFromJob?: string) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const startedAt = Date.now();
  const SOFT_TIME_LIMIT_MS = 75_000;
  const PROGRESS_UPDATE_INTERVAL = 5;

  let indexed = 0;
  let pagesFound = 0;
  const errors: string[] = [];
  let timedOut = false;
  let interruptedStatus: "paused" | "cancelled" | null = null;

  // If resuming, get already-indexed URLs to skip
  let alreadyIndexedUrls = new Set<string>();
  if (resumeFromJob) {
    const { data: existingPages } = await supabase
      .from("pages")
      .select("url")
      .eq("site_id", siteId);
    if (existingPages) {
      alreadyIndexedUrls = new Set(existingPages.map((p: any) => p.url));
      console.log(`Resuming crawl: ${alreadyIndexedUrls.size} pages already indexed, skipping them`);
    }
  }

  const updateJob = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from("crawl_jobs").update(patch).eq("id", jobId);
    if (error) {
      console.error("Failed to update crawl job:", error);
    }
  };

  const readJobStatus = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .from("crawl_jobs")
      .select("status")
      .eq("id", jobId)
      .single();
    if (error) {
      console.error("Failed to read crawl job status:", error);
      return null;
    }
    return data?.status || null;
  };

  try {
    await cleanupStaleJobs(supabase, siteId, jobId);

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
      const sitemapRes = await fetchWithTimeout(sitemapUrl, {
        headers: { "User-Agent": "FindAI-Crawler/1.0" },
      });

      if (sitemapRes.ok) {
        const xml = await sitemapRes.text();
        const sitemapIndexMatches = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*(.*?)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)];

        if (sitemapIndexMatches.length > 0) {
          console.log(`Found sitemap index with ${sitemapIndexMatches.length} child sitemaps`);
          for (const sm of sitemapIndexMatches.slice(0, 5)) {
            try {
              const childRes = await fetchWithTimeout(sm[1], {
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

    // If resuming, filter out already-indexed URLs
    if (resumeFromJob && alreadyIndexedUrls.size > 0) {
      const beforeCount = urls.length;
      urls = urls.filter(u => !alreadyIndexedUrls.has(u));
      indexed = alreadyIndexedUrls.size; // count already-indexed pages
      console.log(`Resume: skipped ${beforeCount - urls.length} already-indexed URLs, ${urls.length} remaining`);
    }

    pagesFound = urls.length + (resumeFromJob ? alreadyIndexedUrls.size : 0);
    console.log(`Sitemap discovery complete: ${pagesFound} total URLs, ${urls.length} to crawl`);

    await updateJob({
      status: "running",
      pages_found: pagesFound,
      pages_indexed: indexed,
    });

    try {
      console.log(`Extracting brand styles from ${baseUrl}`);
      const homeRes = await fetchWithTimeout(baseUrl, {
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

      const currentStatus = await readJobStatus();
      if (currentStatus === "paused" || currentStatus === "cancelled") {
        interruptedStatus = currentStatus;
        break;
      }

      await updateJob({
        status: "running",
        pages_found: pagesFound,
        pages_indexed: indexed,
      });

      try {
        const pageRes = await fetchWithTimeout(url, {
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
            const jsonRes = await fetchWithTimeout(jsonUrl, { headers: { "User-Agent": "FindAI-Crawler/1.0" } });
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
          const currentStatus = await readJobStatus();
          if (currentStatus === "paused" || currentStatus === "cancelled") {
            interruptedStatus = currentStatus;
            break;
          }

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

    const finalStatus =
      interruptedStatus
        ? interruptedStatus
        : timedOut
          ? "partial"
          : (indexed === 0 && errors.length > 0)
            ? "error"
            : "done";

    await updateJob({
      status: finalStatus,
      pages_indexed: indexed,
      pages_found: pagesFound,
      error: interruptedStatus === "paused"
        ? "Crawl paused by user."
        : interruptedStatus === "cancelled"
          ? "Crawl stopped by user."
          : errors.length > 0
            ? errors.slice(0, 10).join("; ")
            : null,
    });

    if (indexed > 0 && finalStatus === "done") {
      await supabase.from("sites").update({
        page_count: indexed,
        last_crawled_at: new Date().toISOString(),
      }).eq("id", siteId);

      // Generate AI context document for the site
      try {
        await generateAiContext(supabase, siteId);
      } catch (ctxErr) {
        console.error("AI context generation failed (non-fatal):", ctxErr);
      }
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

async function generateAiContext(supabase: any, siteId: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return;

  // Fetch all pages for the site
  const { data: pages } = await supabase
    .from("pages")
    .select("url, title, content, meta_description")
    .eq("site_id", siteId)
    .not("title", "is", null)
    .limit(60);

  if (!pages || pages.length === 0) return;

  const { data: site } = await supabase
    .from("sites")
    .select("name, domain")
    .eq("id", siteId)
    .single();

  // Build page summaries for AI
  const pageSummaries = pages
    .map((p: any) => `• ${p.title} (${p.url})\n  ${(p.content || p.meta_description || "").slice(0, 300)}`)
    .join("\n\n");

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
          content: `Luo sivustosta tiivis kontekstidokumentti hakuassistenttia varten. Dokumentin tulee sisältää:

1. **Yrityksen yleiskuvaus**: Mikä yritys on, mitä se tekee
2. **Palvelut**: Lista kaikista palveluista (asennus, huolto, myynti jne.)
3. **Palvelualueet**: Missä yritys toimii (kaupungit, alueet, maakunnat). Jos mainitaan esim. "Uusimaa", listaa myös mitä kaupunkeja se kattaa.
4. **Tuotteet/tuotemerkit**: Päätuotemerkit ja -kategoriat
5. **Yhteystiedot**: Puhelin, sähköposti, osoite jos löytyy
6. **Erityispiirteet**: Kampanjat, sertifikaatit, takuut, erityispalvelut

Kirjoita selkeästi ja tiiviisti. Tämä dokumentti syötetään AI-hakuassistentille jotta se voi vastata asiakkaille tarkasti.`,
        },
        {
          role: "user",
          content: `Sivusto: ${site?.name || "?"} (${site?.domain || "?"})\n\nSivut:\n${pageSummaries}`,
        },
      ],
    }),
  });

  if (!aiRes.ok) {
    console.error("AI context generation error:", aiRes.status);
    return;
  }

  const aiData = await aiRes.json();
  const context = aiData.choices?.[0]?.message?.content || "";

  if (context.length > 50) {
    await supabase
      .from("sites")
      .update({ ai_context: context })
      .eq("id", siteId);
    console.log(`AI context generated: ${context.length} chars`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const action = payload?.action;
    const siteId = typeof payload?.site_id === "string" ? payload.site_id : null;
    const jobId = typeof payload?.job_id === "string" ? payload.job_id : null;
    const resumeFromJob = typeof payload?.resume_from_job === "string" ? payload.resume_from_job : undefined;

    // Allow triggering AI context generation independently
    if (action === "generate_context" && siteId) {
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      await generateAiContext(supabase, siteId);
      const { data: updated } = await supabase.from("sites").select("ai_context").eq("id", siteId).single();
      return new Response(JSON.stringify({ status: "ok", context_length: updated?.ai_context?.length || 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((action === "pause" || action === "cancel") && siteId) {
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const status = action === "pause" ? "paused" : "cancelled";
      const errorText = action === "pause" ? "Crawl paused by user." : "Crawl stopped by user.";
      const { error } = await supabase
        .from("crawl_jobs")
        .update({ status, error: errorText })
        .eq("site_id", siteId)
        .in("status", ["pending", "running", "discovering", "crawling"]);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ status, job_id: jobId || null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!jobId || !siteId) {
      return new Response(JSON.stringify({ error: "job_id and site_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // @ts-ignore: EdgeRuntime is available in Supabase Edge Functions
    EdgeRuntime.waitUntil(doCrawl(jobId, siteId, resumeFromJob));

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

        if (hasSchemaType(type, "Product")) {
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

        if (hasSchemaType(type, "Article") || hasSchemaType(type, "NewsArticle") || hasSchemaType(type, "BlogPosting")) {
          return {
            type: "Article",
            name: item.headline || item.name,
            description: item.description?.slice(0, 300),
            datePublished: item.datePublished,
            author: typeof item.author === "string" ? item.author : item.author?.name,
            image: typeof item.image === "string" ? item.image : item.image?.[0] || item.image?.url,
          };
        }

        if (hasSchemaType(type, "Event")) {
          return {
            type: "Event",
            name: item.name,
            description: item.description?.slice(0, 300),
            startDate: item.startDate,
            location: typeof item.location === "string" ? item.location : item.location?.name || item.location?.address?.addressLocality,
            image: typeof item.image === "string" ? item.image : item.image?.[0],
          };
        }

        if (hasSchemaType(type, "FAQPage")) {
          const questions = (item.mainEntity || []).slice(0, 5).map((q: any) => ({
            q: q.name,
            a: q.acceptedAnswer?.text?.slice(0, 200),
          }));
          return { type: "FAQPage", questions };
        }

        if (hasSchemaType(type, "LocalBusiness")) {
          return {
            type: "LocalBusiness",
            name: item.name,
            description: item.description?.slice(0, 300),
            image: firstImage(item.image),
            telephone: item.telephone,
            email: item.email,
            address: formatAddress(item.address),
            addressLocality: item.address?.addressLocality,
            serviceArea: formatServiceArea(item.areaServed || item.serviceArea),
            openingHours: item.openingHours || item.openingHoursSpecification || null,
            priceRange: item.priceRange,
          };
        }

        if (hasSchemaType(type, "Organization")) {
          return {
            type: "Organization",
            name: item.name,
            description: item.description?.slice(0, 300),
            image: firstImage(item.logo || item.image),
            telephone: item.telephone,
            email: item.email,
            address: formatAddress(item.address),
            sameAs: Array.isArray(item.sameAs) ? item.sameAs.slice(0, 10) : undefined,
          };
        }

        if (hasSchemaType(type, "BreadcrumbList")) {
          const breadcrumbs = (item.itemListElement || [])
            .map((entry: any) => ({
              name: entry.name || entry.item?.name,
              url: typeof entry.item === "string" ? entry.item : entry.item?.["@id"] || entry.item?.url,
              position: entry.position,
            }))
            .filter((entry: any) => entry.name);

          if (breadcrumbs.length > 0) {
            return {
              type: "BreadcrumbList",
              breadcrumbs: breadcrumbs.slice(0, 10),
            };
          }
        }

        if (hasSchemaType(type, "Recipe")) {
          return {
            type: "Recipe",
            name: item.name,
            description: item.description?.slice(0, 300),
            image: firstImage(item.image),
            recipeCuisine: item.recipeCuisine,
            recipeCategory: item.recipeCategory,
            prepTime: item.prepTime,
            cookTime: item.cookTime,
            totalTime: item.totalTime,
            recipeYield: item.recipeYield,
            rating: item.aggregateRating?.ratingValue,
            reviewCount: item.aggregateRating?.reviewCount,
          };
        }

        if (hasSchemaType(type, "Movie")) {
          return {
            type: "Movie",
            name: item.name,
            description: item.description?.slice(0, 300),
            image: firstImage(item.image),
            datePublished: item.datePublished,
            duration: item.duration,
            rating: item.aggregateRating?.ratingValue,
            reviewCount: item.aggregateRating?.reviewCount,
            actors: normalizePeople(item.actor),
            directors: normalizePeople(item.director),
          };
        }

        if (hasSchemaType(type, "JobPosting")) {
          return {
            type: "JobPosting",
            name: item.title || item.name,
            description: item.description?.replace(/<[^>]*>/g, " ").slice(0, 300),
            datePublished: item.datePosted,
            employmentType: item.employmentType,
            hiringOrganization: item.hiringOrganization?.name,
            jobLocation: item.jobLocation?.address?.addressLocality || formatAddress(item.jobLocation?.address),
            validThrough: item.validThrough,
          };
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function hasSchemaType(type: string | string[], expected: string): boolean {
  return Array.isArray(type) ? type.includes(expected) : type === expected;
}

function firstImage(image: any): string | undefined {
  if (!image) return undefined;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    for (const entry of image) {
      const resolved = firstImage(entry);
      if (resolved) return resolved;
    }
    return undefined;
  }
  return image.url || image["@id"] || undefined;
}

function formatAddress(address: any): string | undefined {
  if (!address) return undefined;
  if (typeof address === "string") return address;
  const parts = [
    address.streetAddress,
    address.postalCode,
    address.addressLocality,
    address.addressRegion,
    address.addressCountry,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function formatServiceArea(area: any): string[] | undefined {
  if (!area) return undefined;
  const entries = Array.isArray(area) ? area : [area];
  const normalized = entries.map((entry) => {
    if (typeof entry === "string") return entry;
    return entry.name || entry.addressLocality || entry.addressRegion || entry.addressCountry || undefined;
  }).filter(Boolean);
  return normalized.length > 0 ? normalized.slice(0, 20) : undefined;
}

function normalizePeople(value: any): string[] | undefined {
  if (!value) return undefined;
  const entries = Array.isArray(value) ? value : [value];
  const normalized = entries.map((entry) => {
    if (typeof entry === "string") return entry;
    return entry?.name;
  }).filter(Boolean);
  return normalized.length > 0 ? normalized.slice(0, 10) : undefined;
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
