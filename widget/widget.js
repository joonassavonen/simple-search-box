/**
 * FindAI – embeddable search widget (green theme)
 *
 * Installation (external sites):
 *   <script src="https://findai.app/widget.js"
 *           data-site-id="123"
 *           data-api-url="https://api.findai.app"></script>
 *
 * Installation (Supabase edge functions):
 *   <script src="/widget.js"
 *           data-site-id="uuid-here"
 *           data-supabase-url="https://xxx.supabase.co"
 *           data-supabase-key="anon-key"></script>
 *
 * Optional attributes:
 *   data-placeholder     – Placeholder text (default: "Kysy meiltä mitä vain...")
 *   data-theme           – "light" (default) | "dark"
 *   data-position        – "bottom-right" (default) | "top-center" | "inline"
 *   data-inline-target   – CSS selector for inline mode target element
 */

(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------
  const script = document.currentScript || document.querySelector("script[data-site-id]");
  const SITE_ID = script.getAttribute("data-site-id") || "0";
  const API_URL = (script.getAttribute("data-api-url") || "").replace(/\/$/, "");
  const SUPABASE_URL = script.getAttribute("data-supabase-url") || "";
  const SUPABASE_KEY = script.getAttribute("data-supabase-key") || "";
  const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);
  const THEME = script.getAttribute("data-theme") || "light";
  const POSITION = script.getAttribute("data-position") || "bottom-right";
  const INLINE_TARGET = script.getAttribute("data-inline-target") || null;
  const PLACEHOLDER = script.getAttribute("data-placeholder") || "Kysy meiltä mitä vain...";

  if (!SITE_ID || SITE_ID === "0") {
    console.warn("[FindAI] Missing data-site-id attribute");
    return;
  }

  const SESSION_ID = sessionStorage.getItem("findai-sid") || (() => {
    const id = crypto.randomUUID();
    sessionStorage.setItem("findai-sid", id);
    return id;
  })();

  // -------------------------------------------------------------------------
  // Language detection
  // -------------------------------------------------------------------------
  const FI_CHARS = /[äöåÄÖÅ]/;
  const FI_WORDS = new Set([
    "mitä","mikä","kuinka","miten","missä","milloin","miksi","kuka",
    "onko","voiko","pitää","täytyy","pitäisi","kannattaa",
    "halusin","haluaisin","tarvitsen","tarvitsee","olen","olet",
    "hän","he","me","te","jos","kun","koska","että","mutta","tai","ja","ei","en","emme",
    "sähkökatko","lasku","sopimus","asiakas","palvelu","tuote",
    "toimitus","tilaus","hinta","maksu","tuki","ohje",
    "televisio","puhelin","tietokone","kannettava","tabletti",
    "takuu","palautus","reklamaatio","viallinen","rikki","hajosi",
    "ostaa","ostaminen","tilata","maksaa","palauttaa",
    "halpa","edullinen","kallis","paras","uusi",
    "opiskelijalle","kotiin","nopea","ilmainen","saatavilla",
    "yhteystiedot","asiakaspalvelu","kauppa","verkkokauppa","valikoima",
  ]);

  function detectLang(text) {
    if (FI_CHARS.test(text)) return "fi";
    const words = text.toLowerCase().split(/\s+/);
    const fiCount = words.filter(w => FI_WORDS.has(w)).length;
    return fiCount >= 1 ? "fi" : "en";
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function cleanTitle(title, url) {
    if (!title || title.startsWith("http") || title.includes("://")) {
      try {
        const path = new URL(url).pathname.replace(/\/$/, "");
        const segment = path.split("/").pop() || "";
        const cleaned = segment.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();
        return cleaned || new URL(url).hostname;
      } catch { return url; }
    }
    return title;
  }

  function cleanSnippet(snippet) {
    if (!snippet) return "";
    return snippet
      .replace(/Siirry sisältöön/gi, "")
      .replace(/Kirjaudu sisään/gi, "")
      .replace(/Luo tili/gi, "")
      .replace(/Unohditko salasanasi\??/gi, "")
      .replace(/Palauta salasana/gi, "")
      .replace(/Sähköposti\s+Salasana/gi, "")
      .replace(/Ota yhteyttä\s+Varaa huolto/gi, "")
      .replace(/Google\s*★+\s*-?\s*/g, "")
      .replace(/\|\s*\+?\d+\s*arvostelua/g, "")
      .replace(/\d{2,3}\s+\d{4}\s+\d{4}/g, "")
      .replace(/Uusi asiakas\?/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function formatPrice(price, currency) {
    const num = typeof price === "string" ? parseFloat(price) : price;
    if (isNaN(num)) return String(price);
    const formatted = num.toFixed(2).replace(".", ",");
    return currency === "EUR" || !currency ? `alk. ${formatted} €` : `alk. ${formatted} ${currency}`;
  }

  function escHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function addUtm(url) {
    try {
      const u = new URL(url);
      u.searchParams.set("utm_source", "findai");
      u.searchParams.set("utm_medium", "AI-onsite-search");
      u.searchParams.set("utm_campaign", "site-search");
      return u.toString();
    } catch { return url; }
  }

  function starHtml(rating, reviewCount) {
    let stars = "";
    for (let i = 0; i < 5; i++) {
      if (i < Math.round(Number(rating))) {
        stars += '<span style="color:#f59e0b">★</span>';
      } else {
        stars += '<span style="color:#d1d5db">★</span>';
      }
    }
    if (reviewCount) stars += ` <span style="font-size:10px;color:#9ca3af">(${escHtml(String(reviewCount))})</span>`;
    return stars;
  }

  // Hex to HSL helper (returns "H, S%, L%" string for CSS vars)
  function hexToHsl(hex) {
    hex = hex.replace(/^#/, "");
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const r = parseInt(hex.substring(0,2),16)/255;
    const g = parseInt(hex.substring(2,4),16)/255;
    const b = parseInt(hex.substring(4,6),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h=0, s=0, l=(max+min)/2;
    if (max !== min) {
      const d = max-min;
      s = l > 0.5 ? d/(2-max-min) : d/(max+min);
      switch(max) {
        case r: h = ((g-b)/d + (g<b?6:0))/6; break;
        case g: h = ((b-r)/d + 2)/6; break;
        case b: h = ((r-g)/d + 4)/6; break;
      }
    }
    return `${Math.round(h*360)}, ${Math.round(s*100)}%, ${Math.round(l*100)}%`;
  }

  function hslLighten(hslStr, amount) {
    const parts = hslStr.match(/(\d+),\s*(\d+)%,\s*(\d+)%/);
    if (!parts) return hslStr;
    const newL = Math.min(100, parseInt(parts[3]) + amount);
    return `${parts[1]}, ${parts[2]}%, ${newL}%`;
  }

  function hslDarken(hslStr, amount) {
    const parts = hslStr.match(/(\d+),\s*(\d+)%,\s*(\d+)%/);
    if (!parts) return hslStr;
    const newL = Math.max(0, parseInt(parts[3]) - amount);
    return `${parts[1]}, ${parts[2]}%, ${newL}%`;
  }

  // Supabase PostgREST helper
  function supabaseRest(table, params) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    return fetch(url.toString(), {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
    }).then(r => r.json());
  }

  // -------------------------------------------------------------------------
  // CSS — green theme matching SearchPreview
  // -------------------------------------------------------------------------
  const CSS = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .findai-wrapper {
      --green: 145, 50%, 40%;
      --green-light: 145, 40%, 96%;
      --green-border: 145, 40%, 85%;
      --green-dark: 145, 50%, 35%;
      --green-cta: 145, 45%, 35%;
      --amber: #f59e0b;
      --bg: #ffffff;
      --bg2: #f8f9fa;
      --border: #e5e7eb;
      --border-light: rgba(229,231,235,0.5);
      --text: #1a1a1a;
      --text-muted: #6b7280;
      --shadow: 0 4px 24px rgba(0,0,0,0.08);
      --radius: 16px;
    }
    .findai-wrapper.dark {
      --bg: #1e1e2e;
      --bg2: #2a2a3e;
      --border: #3f3f5c;
      --border-light: rgba(63,63,92,0.5);
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --shadow: 0 4px 24px rgba(0,0,0,0.4);
    }

    /* Trigger button */
    .findai-trigger {
      position: fixed; z-index: 2147483647;
      display: flex; align-items: center; gap: 8px;
      background: hsl(var(--green));
      color: #fff; border: none; border-radius: 999px;
      padding: 10px 18px; cursor: pointer;
      font-size: 14px; font-weight: 500;
      box-shadow: var(--shadow);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      white-space: nowrap; font-family: inherit;
    }
    .findai-trigger:hover { transform: translateY(-1px); box-shadow: 0 6px 28px rgba(0,0,0,0.15); }
    .findai-trigger svg { flex-shrink: 0; }
    .pos-bottom-right { bottom: 24px; right: 24px; }
    .pos-bottom-left { bottom: 24px; left: 24px; }
    .pos-top-right { top: 24px; right: 24px; }

    /* Header icon trigger (for header-icon mode) */
    .findai-header-icon {
      display: inline-flex; align-items: center; justify-content: center;
      background: none; border: none; cursor: pointer;
      color: var(--text); padding: 8px; border-radius: 8px;
      transition: background 0.15s, color 0.15s;
      font-family: inherit;
    }
    .findai-header-icon:hover { background: rgba(0,0,0,0.06); color: hsl(var(--green)); }
    .findai-header-icon svg { width: 20px; height: 20px; }

    /* Modal overlay */
    .findai-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.4); backdrop-filter: blur(2px);
      z-index: 2147483646;
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 10vh;
      opacity: 0; pointer-events: none; transition: opacity 0.2s ease;
    }
    .findai-overlay.open { opacity: 1; pointer-events: all; }

    /* Panel */
    .findai-panel {
      width: min(640px, 94vw);
      background: var(--bg); border-radius: var(--radius);
      box-shadow: var(--shadow); overflow: visible;
      transform: translateY(-8px); transition: transform 0.2s ease;
    }
    .findai-overlay.open .findai-panel { transform: translateY(0); }

    /* Inline mode */
    .findai-inline {
      width: 100%; background: transparent; overflow: visible;
    }

    /* Search bar */
    .findai-bar {
      display: flex; align-items: center; gap: 8px;
      position: relative;
    }
    .findai-bar-inner {
      flex: 1; position: relative; display: flex; align-items: center;
    }
    .findai-bar-icon {
      position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
      color: rgba(107,114,128,0.4); pointer-events: none; display: flex;
    }
    .findai-input {
      width: 100%; height: 52px;
      border: 2px solid var(--border-light); border-radius: var(--radius);
      background: var(--bg); color: var(--text);
      font-size: 15px; padding: 0 40px 0 44px;
      outline: none; font-family: inherit;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .findai-input::placeholder { color: rgba(107,114,128,0.4); }
    .findai-input::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }
    .findai-input:focus {
      border-color: hsl(145, 50%, 45%);
      box-shadow: 0 4px 12px hsla(145, 50%, 45%, 0.1);
    }
    .findai-clear {
      position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
      background: none; border: none; cursor: pointer;
      color: rgba(107,114,128,0.5); padding: 4px; border-radius: 50%;
      display: none; font-family: inherit;
    }
    .findai-clear:hover { color: var(--text-muted); }
    .findai-search-btn { display: none !important; }

    /* Dropdown */
    .findai-dropdown {
      position: absolute; left: 0; right: 0; top: calc(100% + 8px);
      z-index: 50; max-height: 70vh; overflow-y: auto;
      overscroll-behavior: contain;
      border-radius: var(--radius); border: 1px solid var(--border-light);
      background: var(--bg); box-shadow: 0 12px 40px rgba(0,0,0,0.12);
      display: none;
      animation: findai-slideIn 0.15s ease;
    }
    @keyframes findai-slideIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Suggestions */
    .findai-suggestion {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px; cursor: pointer; width: 100%;
      border: none; background: none; text-align: left;
      font-size: 14px; color: var(--text);
      transition: background 0.1s; font-family: inherit;
    }
    .findai-suggestion:hover, .findai-suggestion.active { background: rgba(0,0,0,0.03); }
    .findai-suggestion svg { color: rgba(107,114,128,0.4); flex-shrink: 0; }
    .findai-suggestion img {
      width: 36px; height: 36px; border-radius: 8px;
      object-fit: contain; border: 1px solid var(--border-light);
      background: #fff; flex-shrink: 0;
    }

    /* Loading dots */
    .findai-loading {
      display: flex; align-items: center; justify-content: center;
      gap: 6px; padding: 24px 16px;
    }
    .findai-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: rgba(107,114,128,0.4);
      animation: findai-pulse 1.2s ease-in-out infinite;
    }
    .findai-dot:nth-child(2) { animation-delay: 0.15s; }
    .findai-dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes findai-pulse {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    /* Results header */
    .findai-results-header {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 16px 4px; font-size: 13px;
      font-weight: 600; color: hsl(var(--green-dark));
    }
    .findai-results-header svg { width: 14px; height: 14px; }

    /* AI summary card */
    .findai-ai-summary {
      display: flex; align-items: center; gap: 12px;
      margin: 4px 8px 4px; padding: 12px;
      border: 1px solid hsl(var(--green-border));
      background: hsl(var(--green-light));
      border-radius: 8px; cursor: pointer;
      transition: box-shadow 0.15s; text-decoration: none;
    }
    .findai-ai-summary:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
    .findai-ai-summary-text { flex: 1; min-width: 0; }
    .findai-ai-summary h3 { font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 2px; }
    .findai-ai-summary p {
      font-size: 12px; color: var(--text-muted);
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }

    /* Result item */
    .findai-result {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 10px 16px; cursor: pointer; width: 100%;
      border: none; background: none; text-align: left;
      text-decoration: none;
      transition: background 0.1s; font-family: inherit;
    }
    .findai-result:hover { background: rgba(0,0,0,0.02); }
    .findai-result-img {
      width: 48px; height: 48px; border-radius: 8px;
      object-fit: contain; border: 1px solid var(--border-light);
      background: #fff; flex-shrink: 0; margin-top: 2px;
    }
    .findai-result-body { flex: 1; min-width: 0; }
    .findai-result-title {
      font-size: 14px; font-weight: 600; color: var(--text);
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      line-height: 1.3;
    }
    .findai-result:hover .findai-result-title { color: hsl(var(--green-dark)); }
    .findai-result-price {
      font-size: 13px; font-weight: 700;
      color: hsl(145, 60%, 35%); margin-top: 2px;
    }
    .findai-result-rating { margin-top: 2px; font-size: 11px; letter-spacing: -1px; }
    .findai-result-badge {
      display: inline-block; margin-top: 4px;
      font-size: 10px; font-weight: 500;
      padding: 1px 6px; border-radius: 4px;
    }
    .findai-badge-instock { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
    .findai-badge-outofstock { background: #fff7ed; color: #ea580c; border: 1px solid #fed7aa; }
    .findai-result-snippet {
      font-size: 12px; color: var(--text-muted); margin-top: 2px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      line-height: 1.5;
    }
    .findai-result-meta {
      font-size: 10px; color: var(--text-muted); margin-top: 2px;
      display: flex; align-items: center; gap: 8px;
    }
    .findai-result-arrow {
      flex-shrink: 0; margin-top: 4px;
      color: transparent; transition: color 0.15s;
    }
    .findai-result:hover .findai-result-arrow { color: rgba(107,114,128,0.4); }

    /* No results */
    .findai-no-results {
      padding: 24px 16px; text-align: center;
    }
    .findai-no-results svg { margin: 0 auto 8px; color: rgba(107,114,128,0.3); }
    .findai-no-results-title { font-size: 13px; font-weight: 500; color: var(--text); }
    .findai-no-results-hint { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
    .findai-suggestions-wrap {
      margin-top: 12px;
    }
    .findai-suggestions-label { font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
    .findai-suggestion-pill {
      display: inline-block; margin: 3px;
      padding: 4px 10px; border-radius: 999px;
      background: hsl(var(--green-light));
      color: hsl(145, 50%, 30%);
      font-size: 11px; font-weight: 500;
      cursor: pointer; border: none; font-family: inherit;
      transition: background 0.15s;
    }
    .findai-suggestion-pill:hover { background: hsl(145, 40%, 88%); }

    /* Trending */
    .findai-trending { padding: 12px; }
    .findai-trending-title {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 8px;
    }
    .findai-trending-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .findai-trending-item {
      display: inline-flex; align-items: center;
      padding: 6px 12px; border-radius: 999px;
      background: var(--bg2); border: 1px solid var(--border);
      font-size: 13px; color: var(--text); cursor: pointer;
      transition: background 0.1s, border-color 0.1s; font-family: inherit;
    }
    .findai-trending-item:hover {
      background: hsl(var(--green-light));
      border-color: hsl(var(--green));
      color: hsl(var(--green-dark));
    }
    .findai-trending-product {
      display: flex; align-items: center; gap: 12px; width: 100%;
      padding: 8px 12px; border-radius: 12px; cursor: pointer;
      border: none; background: none; text-align: left; font-family: inherit;
      transition: background 0.1s;
    }
    .findai-trending-product:hover { background: rgba(0,0,0,0.03); }
    .findai-trending-product img {
      width: 36px; height: 36px; border-radius: 8px;
      object-fit: contain; border: 1px solid var(--border-light);
      background: #fff; flex-shrink: 0;
    }
    .findai-trending-product-placeholder {
      width: 36px; height: 36px; border-radius: 8px;
      background: var(--bg2); flex-shrink: 0;
    }
    .findai-trending-product span { font-size: 13px; font-weight: 500; color: var(--text); }
    .findai-trending-growth {
      font-size: 10px; font-weight: 600; color: hsl(145, 60%, 40%);
      background: hsl(145, 50%, 94%); padding: 1px 5px; border-radius: 6px;
      margin-left: 4px; white-space: nowrap;
    }

    /* Contact CTA */
    .findai-contact { padding: 12px; border-top: 1px solid var(--border-light); }
    .findai-contact-btn {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      width: 100%; padding: 12px; margin-bottom: 8px;
      border: none; border-radius: 12px;
      font-size: 14px; font-weight: 600;
      cursor: pointer; text-decoration: none; font-family: inherit;
      transition: opacity 0.15s;
    }
    .findai-contact-btn:last-child { margin-bottom: 0; }
    .findai-contact-btn:hover { opacity: 0.9; }
    .findai-contact-phone { background: hsl(var(--green-cta)); color: #fff; }
    .findai-contact-chat { background: hsl(145, 55%, 50%); color: #fff; }
    .findai-contact-email { background: var(--bg); color: var(--text); border: 1px solid var(--border-light); }

    /* Footer */
    .findai-footer {
      padding: 8px 16px; border-top: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .findai-footer-hint { font-size: 11px; color: var(--text-muted); }
    .findai-brand {
      font-size: 11px; color: var(--text-muted);
      text-decoration: none; display: flex; align-items: center; gap: 4px;
    }
    .findai-brand:hover { color: hsl(var(--green)); }

    /* Scrollbar */
    .findai-dropdown::-webkit-scrollbar { width: 6px; }
    .findai-dropdown::-webkit-scrollbar-track { background: transparent; }
    .findai-dropdown::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  `;

  // -------------------------------------------------------------------------
  // SVG icons
  // -------------------------------------------------------------------------
  const ICON_SEARCH = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  const ICON_CLOSE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const ICON_EXTERNAL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  const ICON_SPARKLES = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`;
  const ICON_TRENDING = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;

  // -------------------------------------------------------------------------
  // Apply brand styles from site settings
  // -------------------------------------------------------------------------
  function applyBrandStyles(wrapper, styleEl, brandColor, brandFont, brandBgColor) {
    let overrideCSS = "";
    if (brandColor) {
      const hsl = hexToHsl(brandColor);
      overrideCSS += `
        .findai-wrapper {
          --green: ${hsl};
          --green-light: ${hslLighten(hsl, 52)};
          --green-border: ${hslLighten(hsl, 40)};
          --green-dark: ${hslDarken(hsl, 5)};
          --green-cta: ${hslDarken(hsl, 5)};
        }
        .findai-input:focus {
          border-color: hsl(${hsl});
          box-shadow: 0 4px 12px hsla(${hsl}, 0.1);
        }
        .findai-result-price { color: hsl(${hslDarken(hsl, 5)}); }
      `;
    }
    if (brandFont) {
      overrideCSS += `
        :host { font-family: '${brandFont}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      `;
    }
    if (brandBgColor) {
      overrideCSS += `
        .findai-wrapper { --bg: ${brandBgColor}; }
      `;
    }
    if (overrideCSS) {
      const brandStyle = document.createElement("style");
      brandStyle.textContent = overrideCSS;
      styleEl.parentNode.appendChild(brandStyle);
    }
  }

  // -------------------------------------------------------------------------
  // Widget state
  // -------------------------------------------------------------------------
  let currentSearchLogId = null;
  let debounceTimer = null;
  let suggestDebounce = null;
  let lastQuery = "";
  let trendingData = null;
  let popularProducts = null;
  let contactConfig = null;
  let activeSuggestionIdx = -1;

  // -------------------------------------------------------------------------
  // Build DOM
  // -------------------------------------------------------------------------
  function buildWidget() {
    const host = document.createElement("div");
    host.id = "findai-host";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.className = `findai-wrapper${THEME === "dark" ? " dark" : ""}`;

    let panel, overlay, trigger;

    if (POSITION === "inline" && INLINE_TARGET) {
      panel = document.createElement("div");
      panel.className = "findai-inline";
      wrapper.appendChild(panel);
    } else if (POSITION === "header-icon") {
      // Inline icon button — place inside data-inline-target or body
      trigger = document.createElement("button");
      trigger.className = "findai-header-icon";
      trigger.innerHTML = ICON_SEARCH;
      trigger.setAttribute("aria-label", "Open search");
      wrapper.appendChild(trigger);

      overlay = document.createElement("div");
      overlay.className = "findai-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Site search");

      panel = document.createElement("div");
      panel.className = "findai-panel";
      overlay.appendChild(panel);
      wrapper.appendChild(overlay);
    } else {
      trigger = document.createElement("button");
      trigger.className = `findai-trigger pos-${POSITION}`;
      trigger.innerHTML = `${ICON_SEARCH} <span class="findai-trigger-label">Hae</span>`;
      trigger.setAttribute("aria-label", "Open search");
      wrapper.appendChild(trigger);

      overlay = document.createElement("div");
      overlay.className = "findai-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Site search");

      panel = document.createElement("div");
      panel.className = "findai-panel";
      overlay.appendChild(panel);
      wrapper.appendChild(overlay);
    }

    // Search bar
    const bar = document.createElement("div");
    bar.className = "findai-bar";

    const barInner = document.createElement("div");
    barInner.className = "findai-bar-inner";

    const searchIconEl = document.createElement("span");
    searchIconEl.className = "findai-bar-icon";
    searchIconEl.innerHTML = ICON_SEARCH;
    barInner.appendChild(searchIconEl);

    const input = document.createElement("input");
    input.className = "findai-input";
    input.type = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = PLACEHOLDER;
    input.setAttribute("aria-label", "Search query");
    barInner.appendChild(input);

    const clearBtn = document.createElement("button");
    clearBtn.className = "findai-clear";
    clearBtn.innerHTML = ICON_CLOSE;
    clearBtn.setAttribute("aria-label", "Clear");
    barInner.appendChild(clearBtn);

    bar.appendChild(barInner);

    const searchBtn = document.createElement("button");
    searchBtn.className = "findai-search-btn";
    searchBtn.innerHTML = ICON_SEARCH;
    searchBtn.setAttribute("aria-label", "Search");
    bar.appendChild(searchBtn);

    panel.appendChild(bar);

    // Dropdown (unified: suggestions + results + trending)
    const dropdown = document.createElement("div");
    dropdown.className = "findai-dropdown";
    barInner.appendChild(dropdown);

    // No footer

    shadow.appendChild(wrapper);

    if ((POSITION === "inline" || POSITION === "header-icon") && INLINE_TARGET) {
      const target = document.querySelector(INLINE_TARGET);
      if (target) {
        target.appendChild(host);
      } else {
        document.body.appendChild(host);
      }
    } else {
      document.body.appendChild(host);
    }

    // -----------------------------------------------------------------------
    // Prefetch trending, popular products & contact config
    // -----------------------------------------------------------------------
    if (USE_SUPABASE) {
      // Trending via GA4 growth data: compare current vs previous 30-day period
      (async () => {
        try {
          const allAnalytics = await supabaseRest("page_analytics", {
            "select": "page_path,pageviews,period_start,period_end",
            "site_id": `eq.${SITE_ID}`,
            "limit": "2000",
          });
          if (!allAnalytics || !Array.isArray(allAnalytics) || allAnalytics.length === 0) throw "no data";

          // Split into current and previous period by period_start
          const periods = [...new Set(allAnalytics.map(r => r.period_start))].sort();
          if (periods.length < 2) throw "need two periods";

          const prevPeriod = periods[0];
          const currPeriod = periods[periods.length - 1];

          const prevMap = {};
          const currMap = {};
          for (const r of allAnalytics) {
            if (r.page_path === "/" || r.page_path === "") continue;
            if (r.period_start === prevPeriod) prevMap[r.page_path] = (prevMap[r.page_path] || 0) + r.pageviews;
            else if (r.period_start === currPeriod) currMap[r.page_path] = (currMap[r.page_path] || 0) + r.pageviews;
          }

          // Calculate growth score: growth_pct * log(current_views + 1) for volume weighting
          const growth = [];
          for (const [path, curr] of Object.entries(currMap)) {
            const prev = prevMap[path] || 0;
            if (curr < 3) continue; // minimum traffic threshold
            const growthPct = prev > 0 ? (curr - prev) / prev : (curr > 5 ? 1 : 0);
            if (growthPct <= 0) continue;
            const score = growthPct * Math.log(curr + 1);
            growth.push({ page_path: path, score, curr, growthPct: Math.round(growthPct * 100) });
          }

          growth.sort((a, b) => b.score - a.score);
          const topItems = growth.slice(0, 6);

          if (topItems.length === 0) throw "no growth pages";

          // Fetch page titles for the trending paths
          const pages = await supabaseRest("pages", {
            "select": "title,url",
            "site_id": `eq.${SITE_ID}`,
            "limit": "1000",
          });
          const pathToPage = {};
          if (pages && Array.isArray(pages)) {
            for (const p of pages) {
              try { const u = new URL(p.url); pathToPage[u.pathname] = p; } catch {}
            }
          }

          trendingData = topItems
            .map(g => {
              const page = pathToPage[g.page_path] || pathToPage[g.page_path.replace(/\/$/, "")] || pathToPage[g.page_path + "/"];
              return page ? { query: page.title, url: page.url, growth: g.growthPct, source: "ga" } : null;
            })
            .filter(Boolean);
        } catch {
          // Fallback to search-log based trending
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          supabaseRest("search_logs", {
            "select": "query",
            "site_id": `eq.${SITE_ID}`,
            "created_at": `gte.${sevenDaysAgo}`,
            "results_count": "gt.0",
          }).then(data => {
            if (!data || !Array.isArray(data)) return;
            const counts = {};
            for (const row of data) {
              const q = (row.query || "").trim().toLowerCase();
              if (q.length >= 2) counts[q] = (counts[q] || 0) + 1;
            }
            trendingData = Object.entries(counts)
              .filter(([, c]) => c >= 2)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([query, count]) => ({ query, count, source: "search_logs" }));
          }).catch(() => {});
        }
      })();

      // Popular products via PostgREST
      supabaseRest("pages", {
        "select": "title,url,schema_data",
        "site_id": `eq.${SITE_ID}`,
        "schema_data": "not.is.null",
        "limit": "50",
      }).then(data => {
        if (!data || !Array.isArray(data)) return;
        const products = [];
        for (const p of data) {
          try {
            const schema = typeof p.schema_data === "string" ? JSON.parse(p.schema_data) : p.schema_data;
            if (schema?.type === "Product" && p.title) {
              products.push({ title: p.title, url: p.url, image: schema.image || undefined });
            }
          } catch {}
        }
        popularProducts = products.slice(0, 5);
      }).catch(() => {});

      // Contact config from DB via Supabase REST
      supabaseRest("site_contact_configs", {
        "select": "enabled,email,phone,chat_url,cta_text_fi,cta_text_en",
        "site_id": `eq.${SITE_ID}`,
        "limit": "1",
      }).then(data => {
        if (data && Array.isArray(data) && data.length > 0) {
          contactConfig = data[0];
        }
      }).catch(() => {});

      // Fetch brand styles and apply to widget
      supabaseRest("sites", {
        "select": "brand_color,brand_font,brand_bg_color",
        "id": `eq.${SITE_ID}`,
        "limit": "1",
      }).then(data => {
        if (!data || !Array.isArray(data) || !data[0]) return;
        const site = data[0];
        applyBrandStyles(wrapper, style, site.brand_color, site.brand_font, site.brand_bg_color);
      }).catch(() => {});
    } else {
      fetch(`${API_URL}/api/sites/${SITE_ID}/trending?limit=6`)
        .then(r => r.json())
        .then(data => { trendingData = data.trending || []; })
        .catch(() => {});

      fetch(`${API_URL}/api/sites/${SITE_ID}/contact-config`)
        .then(r => r.json())
        .then(data => { contactConfig = data; })
        .catch(() => {});
    }

    // -----------------------------------------------------------------------
    // Event handlers
    // -----------------------------------------------------------------------
    let inputFocused = false;

    function showDropdown() { dropdown.style.display = "block"; }
    function hideDropdown() { dropdown.style.display = "none"; }

    function updateClearBtn() {
      clearBtn.style.display = input.value ? "block" : "none";
      searchBtn.style.display = input.value.trim() ? "flex" : "none";
    }

    function openSearch() {
      if (overlay) {
        overlay.classList.add("open");
        input.focus();
        document.addEventListener("keydown", handleGlobalKey);
      }
    }

    function closeSearch() {
      if (overlay) {
        overlay.classList.remove("open");
        document.removeEventListener("keydown", handleGlobalKey);
      }
    }

    function handleGlobalKey(e) {
      if (e.key === "Escape") closeSearch();
    }

    if (trigger) trigger.addEventListener("click", openSearch);

    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeSearch();
      });
    }

    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (overlay && overlay.classList.contains("open")) closeSearch();
        else openSearch();
      }
    });

    clearBtn.addEventListener("click", () => {
      input.value = "";
      lastQuery = "";
      updateClearBtn();
      hideDropdown();
      input.focus();
    });

    searchBtn.addEventListener("click", () => {
      const q = input.value.trim();
      if (q) { lastQuery = q; doSearch(q); }
    });

    input.addEventListener("focus", () => {
      inputFocused = true;
      if (!input.value.trim()) renderTrending();
    });

    input.addEventListener("blur", () => {
      setTimeout(() => { inputFocused = false; }, 200);
    });

    input.addEventListener("input", () => {
      const q = input.value.trim();
      updateClearBtn();
      clearTimeout(debounceTimer);
      clearTimeout(suggestDebounce);

      if (!q) {
        renderTrending();
        lastQuery = "";
        return;
      }

      if (q.length >= 2) {
        suggestDebounce = setTimeout(() => fetchSuggestions(q), 150);
      }

      if (q === lastQuery) return;
      debounceTimer = setTimeout(() => {
        lastQuery = q;
        doSearch(q);
      }, 400);
    });

    // Keyboard navigation
    input.addEventListener("keydown", (e) => {
      const suggestionBtns = Array.from(dropdown.querySelectorAll(".findai-suggestion"));
      if (suggestionBtns.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        if (e.key === "ArrowDown") activeSuggestionIdx = Math.min(activeSuggestionIdx + 1, suggestionBtns.length - 1);
        else activeSuggestionIdx = Math.max(activeSuggestionIdx - 1, -1);
        suggestionBtns.forEach((el, i) => el.classList.toggle("active", i === activeSuggestionIdx));
        return;
      }
      if (e.key === "Enter" && activeSuggestionIdx >= 0 && suggestionBtns[activeSuggestionIdx]) {
        e.preventDefault();
        selectSuggestion(suggestionBtns[activeSuggestionIdx].dataset.query);
        return;
      }
      if (e.key === "Escape") {
        hideDropdown();
        if (overlay) closeSearch();
      }
    });

    // -----------------------------------------------------------------------
    // Suggestions
    // -----------------------------------------------------------------------
    function fetchSuggestions(q) {
      if (USE_SUPABASE) {
        const prefix = q.trim().toLowerCase();
        supabaseRest("search_logs", {
          "select": "query",
          "site_id": `eq.${SITE_ID}`,
          "results_count": "gt.0",
          "query": `ilike.${prefix}%`,
          "limit": "200",
        }).then(data => {
          if (input.value.trim() !== q) return;
          if (!data || !Array.isArray(data)) return;
          const counts = {};
          for (const row of data) {
            const rq = (row.query || "").trim().toLowerCase();
            if (rq !== prefix && rq.length >= 2) counts[rq] = (counts[rq] || 0) + 1;
          }
          const suggestions = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([q]) => q);
          renderSuggestions(suggestions);
        }).catch(() => {});
      } else {
        fetch(`${API_URL}/api/sites/${SITE_ID}/suggestions?q=${encodeURIComponent(q)}&limit=5`)
          .then(r => r.json())
          .then(data => {
            if (input.value.trim() !== q) return;
            renderSuggestions(data.suggestions || []);
          })
          .catch(() => {});
      }
    }

    function renderSuggestions(items) {
      if (!items.length) return;
      activeSuggestionIdx = -1;

      // Find matching product images for suggestions
      let html = "";
      items.forEach(s => {
        const q = typeof s === "string" ? s : s.query;
        let imgHtml = ICON_SEARCH;
        if (popularProducts) {
          const match = popularProducts.find(p => p.title && p.title.toLowerCase().includes(q.toLowerCase()));
          if (match && match.image) {
            imgHtml = `<img src="${escHtml(match.image)}" alt="" onerror="this.style.display='none'">`;
          }
        }
        html += `<button class="findai-suggestion" data-query="${escHtml(q)}">${imgHtml} <span>${escHtml(q)}</span></button>`;
      });
      dropdown.innerHTML = html;
      showDropdown();

      dropdown.querySelectorAll(".findai-suggestion").forEach(btn => {
        btn.addEventListener("click", () => selectSuggestion(btn.dataset.query));
      });
    }

    function selectSuggestion(q) {
      input.value = q;
      updateClearBtn();
      lastQuery = q;
      doSearch(q);
    }

    // -----------------------------------------------------------------------
    // Trending
    // -----------------------------------------------------------------------
    function renderTrending() {
      const hasProducts = popularProducts && popularProducts.length > 0;
      const hasTrending = trendingData && trendingData.length > 0;
      const isGaTrending = hasTrending && trendingData[0]?.source === "ga";

      if (!hasProducts && !hasTrending) {
        hideDropdown();
        return;
      }

      let html = '<div class="findai-trending"><div class="findai-trending-title">Suosittua juuri nyt</div>';

      if (hasProducts) {
        html += '<div style="display:flex;flex-direction:column;gap:2px">';
        popularProducts.forEach(p => {
          const imgHtml = p.image
            ? `<img src="${escHtml(p.image)}" alt="" onerror="this.style.display='none'">`
            : `<div class="findai-trending-product-placeholder"></div>`;
          html += `<button class="findai-trending-product" data-query="${escHtml(p.title)}">${imgHtml}<span>${escHtml(p.title)}</span></button>`;
        });
        html += '</div>';
      } else if (hasTrending) {
        html += '<div class="findai-trending-list">';
        trendingData.forEach(t => {
          const growthBadge = (t.growth && t.growth > 0)
            ? `<span class="findai-trending-growth">↑${t.growth}%</span>`
            : "";
          const label = escHtml(t.query.length > 40 ? t.query.slice(0, 38) + "…" : t.query);
          html += `<button class="findai-trending-item" data-query="${escHtml(t.query)}">${label}${growthBadge}</button>`;
        });
        html += '</div>';
      }

      html += '</div>';
      dropdown.innerHTML = html;
      showDropdown();

      dropdown.querySelectorAll(".findai-trending-item, .findai-trending-product").forEach(btn => {
        btn.addEventListener("click", () => {
          input.value = btn.dataset.query;
          updateClearBtn();
          lastQuery = btn.dataset.query;
          doSearch(btn.dataset.query);
        });
      });
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    function renderLoading() {
      dropdown.innerHTML = `
        <div class="findai-loading">
          <div class="findai-dot"></div>
          <div class="findai-dot"></div>
          <div class="findai-dot"></div>
        </div>
      `;
      showDropdown();
    }

    function renderError() {
      dropdown.innerHTML = `<div class="findai-no-results"><div class="findai-no-results-title">Haku epäonnistui. Yritä uudelleen.</div></div>`;
      showDropdown();
    }

    function renderNoResults(data) {
      const lang = data.language || "fi";
      const q = input.value.trim();
      let html = `
        <div class="findai-no-results">
          ${ICON_SEARCH}
          <div class="findai-no-results-title">Ei tuloksia haulle "${escHtml(q)}"</div>
          <div class="findai-no-results-hint">Kokeile eri hakusanoja</div>
      `;

      if (data.suggestions && data.suggestions.length > 0) {
        html += '<div class="findai-suggestions-wrap"><div class="findai-suggestions-label">Tarkoititko:</div>';
        data.suggestions.forEach(s => {
          html += `<button class="findai-suggestion-pill" data-query="${escHtml(s)}">${escHtml(s)}</button>`;
        });
        html += "</div>";
      }
      html += "</div>";

      const cfg = data.contact_config || contactConfig;
      if (cfg && cfg.enabled) {
        html += renderContactHtml(cfg, lang);
      }

      dropdown.innerHTML = html;
      showDropdown();

      dropdown.querySelectorAll(".findai-suggestion-pill").forEach(btn => {
        btn.addEventListener("click", () => selectSuggestion(btn.dataset.query));
      });
    }

    function renderContactHtml(cfg, lang) {
      const phoneIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
      const chatIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
      const mailIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>';
      let html = '<div class="findai-contact">';
      if (cfg.phone) {
        html += `<a href="tel:${escHtml(cfg.phone)}" class="findai-contact-btn findai-contact-phone">${phoneIcon} Soita ${escHtml(cfg.phone)}</a>`;
      }
      if (cfg.chat_url) {
        html += `<a href="${escHtml(addUtm(cfg.chat_url))}" target="_blank" rel="noopener" class="findai-contact-btn findai-contact-chat">${chatIcon} Lähetä WhatsApp-viesti</a>`;
      }
      if (cfg.email) {
        html += `<a href="mailto:${escHtml(cfg.email)}" class="findai-contact-btn findai-contact-email">${mailIcon} ${escHtml(cfg.email)}</a>`;
      }
      html += "</div>";
      return html;
    }

    function renderResults(data) {
      if (!data.results || data.results.length === 0) {
        renderNoResults(data);
        return;
      }

      currentSearchLogId = data.search_log_id;
      let html = "";

      html += `<div class="findai-results-header">${ICON_SPARKLES} ${data.results.length} osuma${data.results.length !== 1 ? "a" : ""}</div>`;

      if (data.ai_summary) {
        const firstUrl = data.results[0]?.url || "#";
        const firstUrlUtm = addUtm(firstUrl);
        html += `
          <a href="${escHtml(firstUrlUtm)}" target="_self" class="findai-ai-summary" data-url="${escHtml(firstUrl)}" data-idx="0">
            <div class="findai-ai-summary-text">
              <h3>${escHtml(data.ai_summary.split(".")[0])}</h3>
              <p>${escHtml(data.ai_summary)}</p>
            </div>
            ${ICON_EXTERNAL}
          </a>
        `;
      }

      data.results.forEach((r, idx) => {
        const title = cleanTitle(r.title, r.url);
        const snippet = cleanSnippet(r.snippet);
        const s = r.schema_data;
        const isProduct = s && s.type === "Product";
        const urlUtm = addUtm(r.url);

        html += `<a href="${escHtml(urlUtm)}" target="_self" class="findai-result" data-url="${escHtml(r.url)}" data-idx="${idx}">`;

        if (isProduct && s.image) {
          html += `<img class="findai-result-img" src="${escHtml(s.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`;
        }

        html += '<div class="findai-result-body">';
        html += `<div class="findai-result-title">${escHtml(title)}</div>`;

        if (isProduct && s.price) {
          html += `<div class="findai-result-price">${formatPrice(s.price, s.currency)}</div>`;
        }

        if (isProduct && s.rating) {
          html += `<div class="findai-result-rating">${starHtml(s.rating, s.reviewCount)}</div>`;
        }


        if (snippet) {
          html += `<div class="findai-result-snippet">${escHtml(snippet)}</div>`;
        }

        if (s && s.type === "Article" && s.datePublished) {
          try {
            html += `<div class="findai-result-meta"><span>${new Date(s.datePublished).toLocaleDateString("fi-FI")}</span></div>`;
          } catch {}
        }

        if (s && s.type === "Event") {
          let meta = "";
          if (s.startDate) { try { meta += `<span>📅 ${new Date(s.startDate).toLocaleDateString("fi-FI")}</span>`; } catch {} }
          if (s.location) meta += `<span>📍 ${escHtml(s.location)}</span>`;
          if (meta) html += `<div class="findai-result-meta">${meta}</div>`;
        }

        html += "</div>";
        html += `<span class="findai-result-arrow">${ICON_EXTERNAL}</span>`;
        html += "</a>";
      });

      const cfg = data.contact_config || contactConfig;
      if (cfg && cfg.enabled) {
        html += renderContactHtml(cfg, data.language || "fi");
      }

      dropdown.innerHTML = html;
      showDropdown();

      dropdown.querySelectorAll(".findai-result, .findai-ai-summary").forEach(el => {
        el.addEventListener("click", (e) => {
          trackClick(el.dataset.url, parseInt(el.dataset.idx || "0", 10));
        });
      });
    }

    // -----------------------------------------------------------------------
    // API calls
    // -----------------------------------------------------------------------
    function doSearch(query) {
      renderLoading();

      const url = USE_SUPABASE
        ? `${SUPABASE_URL}/functions/v1/search`
        : `${API_URL}/api/search`;
      const headers = { "Content-Type": "application/json" };
      if (USE_SUPABASE) {
        headers["Authorization"] = `Bearer ${SUPABASE_KEY}`;
        headers["apikey"] = SUPABASE_KEY;
      }

      fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, site_id: SITE_ID, max_results: 5 }),
      })
        .then(r => { if (!r.ok) throw new Error("Search API error"); return r.json(); })
        .then(renderResults)
        .catch(() => renderError());
    }

    function trackClick(url, position) {
      if (!currentSearchLogId) return;

      if (USE_SUPABASE) {
        fetch(`${SUPABASE_URL}/functions/v1/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "apikey": SUPABASE_KEY,
          },
          body: JSON.stringify({
            action: "click",
            site_id: SITE_ID,
            query: lastQuery,
            url,
          }),
        }).catch(() => {});
      } else {
        fetch(`${API_URL}/api/search/click`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            search_log_id: currentSearchLogId,
            clicked_url: url,
            click_position: position || 0,
            session_id: SESSION_ID,
          }),
        }).catch(() => {});
      }
    }

    updateClearBtn();
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildWidget);
  } else {
    buildWidget();
  }
})();
