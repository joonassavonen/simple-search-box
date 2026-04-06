import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GA_SERVICE_ACCOUNT_JSON = Deno.env.get("GA_SERVICE_ACCOUNT_JSON");

// Create JWT for Google service account auth
async function createGoogleJWT(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = new TextEncoder();
  const b64url = (data: Uint8Array) =>
    btoa(String.fromCharCode(...data))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const headerB64 = b64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import the private key
  const pemContents = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    enc.encode(signingInput)
  );

  const signatureB64 = b64url(new Uint8Array(signature));
  return `${signingInput}.${signatureB64}`;
}

// Exchange JWT for access token
async function getAccessToken(serviceAccount: any): Promise<string> {
  const jwt = await createGoogleJWT(serviceAccount);
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Google OAuth failed: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  return data.access_token;
}

// Fetch GA4 report data
async function fetchGA4Report(
  accessToken: string,
  propertyId: string,
  startDate: string,
  endDate: string
) {
  // Normalize property ID — accept both "123456" and "properties/123456"
  const propId = propertyId.replace(/^properties\//, "");

  const resp = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "sessions" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" },
          { name: "keyEvents" },
        ],
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`GA4 API error: ${resp.status} ${errText}`);
  }

  return await resp.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!GA_SERVICE_ACCOUNT_JSON) {
      return new Response(
        JSON.stringify({ error: "GA_SERVICE_ACCOUNT_JSON secret not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let bodyJson: any = {};
    try { bodyJson = await req.json(); } catch { /* empty body from cron is ok */ }
    const { site_id, sync_all } = bodyJson;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // If sync_all or no site_id, sync all sites with GA property IDs
    if (sync_all || !site_id) {
      const { data: sites } = await supabase
        .from("sites")
        .select("id, ga_property_id, domain")
        .not("ga_property_id", "is", null);

      if (!sites || sites.length === 0) {
        return new Response(
          JSON.stringify({ message: "No sites with GA Property ID configured", synced: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const serviceAccount = JSON.parse(GA_SERVICE_ACCOUNT_JSON);
      const accessToken = await getAccessToken(serviceAccount);
      const results: any[] = [];

      for (const s of sites) {
        try {
          const r = await syncSiteGA(supabase, accessToken, s.id, s.ga_property_id!);
          results.push({ site_id: s.id, domain: s.domain, ...r });
        } catch (e) {
          results.push({ site_id: s.id, domain: s.domain, error: (e as Error).message });
        }
      }

      console.log(`Cron GA sync: ${results.length} sites processed`);
      return new Response(
        JSON.stringify({ success: true, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Single site sync
    const { data: site, error: siteErr } = await supabase
      .from("sites")
      .select("ga_property_id, domain")
      .eq("id", site_id)
      .single();

    if (siteErr || !site) {
      return new Response(
        JSON.stringify({ error: "Site not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gaPropertyId = (site as any).ga_property_id;
    if (!gaPropertyId) {
      return new Response(
        JSON.stringify({ error: "No GA Property ID configured for this site" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse service account JSON
    const serviceAccount = JSON.parse(GA_SERVICE_ACCOUNT_JSON);

    // Get access token
    console.log("Getting Google access token...");
    const accessToken = await getAccessToken(serviceAccount);

    // Fetch last 30 days
    const endDate = "today";
    const startDate = "30daysAgo";

    console.log(`Fetching GA4 data for property ${gaPropertyId}...`);
    const report = await fetchGA4Report(accessToken, gaPropertyId, startDate, endDate);

    if (!report.rows || report.rows.length === 0) {
      return new Response(
        JSON.stringify({ message: "No data found in GA4 for this period", synced: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate period dates
    const now = new Date();
    const periodEnd = now.toISOString().split("T")[0];
    const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // Delete old analytics for this site/period
    await supabase
      .from("page_analytics")
      .delete()
      .eq("site_id", site_id)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd);

    // Parse and upsert rows
    const rows = report.rows.map((row: any) => {
      const pagePath = row.dimensionValues[0].value;
      const pageviews = parseInt(row.metricValues[0].value) || 0;
      const sessions = parseInt(row.metricValues[1].value) || 0;
      const bounceRate = parseFloat(row.metricValues[2].value) || 0;
      const avgTime = parseFloat(row.metricValues[3].value) || 0;
      const conversions = parseInt(row.metricValues[4].value) || 0;
      const conversionRate = sessions > 0 ? conversions / sessions : 0;

      return {
        site_id,
        page_path: pagePath,
        pageviews,
        sessions,
        bounce_rate: Math.round(bounceRate * 100) / 100,
        avg_time_on_page: Math.round(avgTime * 100) / 100,
        conversions,
        conversion_rate: Math.round(conversionRate * 10000) / 10000,
        period_start: periodStart,
        period_end: periodEnd,
        fetched_at: new Date().toISOString(),
      };
    });

    // Insert in batches of 50
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const { error: insertErr } = await supabase.from("page_analytics").insert(batch);
      if (insertErr) {
        console.error("Insert error batch", i, insertErr.message);
      } else {
        inserted += batch.length;
      }
    }

    console.log(`Synced ${inserted}/${rows.length} pages from GA4`);

    return new Response(
      JSON.stringify({
        success: true,
        synced: inserted,
        total_rows: rows.length,
        period: { start: periodStart, end: periodEnd },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("GA sync error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
