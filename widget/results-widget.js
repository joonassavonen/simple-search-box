/**
 * FindAI – Full-page search results widget
 *
 * Installation:
 *   <div id="findai-results"></div>
 *   <script src="https://findaisearch.lovable.app/results-widget.js"
 *           data-site-id="uuid-here"
 *           data-supabase-url="https://xxx.supabase.co"
 *           data-supabase-key="anon-key"
 *           data-target="#findai-results"></script>
 *
 * Optional attributes:
 *   data-theme       – "light" (default) | "dark"
 *   data-max-results – number of results (default: 30)
 */

(function () {
  "use strict";

  const script = document.currentScript || document.querySelector("script[data-site-id][data-target]");
  const SITE_ID = script.getAttribute("data-site-id") || "";
  const SUPABASE_URL = script.getAttribute("data-supabase-url") || "";
  const SUPABASE_KEY = script.getAttribute("data-supabase-key") || "";
  const TARGET = script.getAttribute("data-target") || "#findai-results";
  const THEME = script.getAttribute("data-theme") || "light";
  const MAX_RESULTS = parseInt(script.getAttribute("data-max-results") || "30", 10);

  if (!SITE_ID) { console.warn("[FindAI Results] Missing data-site-id"); return; }
  if (!SUPABASE_URL || !SUPABASE_KEY) { console.warn("[FindAI Results] Missing Supabase config"); return; }

  const SESSION_ID = sessionStorage.getItem("findai-sid") || (() => {
    const id = crypto.randomUUID();
    sessionStorage.setItem("findai-sid", id);
    return id;
  })();

  // ---------------------------------------------------------------------------
  // Helpers (shared with widget.js)
  // ---------------------------------------------------------------------------
  function decodeHtmlEntities(text) {
    if (!text || !text.includes("&")) return text || "";
    const ta = document.createElement("textarea");
    ta.innerHTML = text;
    return ta.value;
  }

  function getBrandFromUrl(url) {
    try {
      const h = new URL(url).hostname.replace(/^www\./i, "");
      return decodeHtmlEntities(h.split(".")[0] || h).replace(/[-_]+/g, " ").trim();
    } catch { return ""; }
  }

  function normalizeTitleToken(t) {
    return (t || "").toLowerCase().replace(/^www\./, "").replace(/\.(fi|com|net|org|io|co|eu)$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function cleanTitle(title, url) {
    if (!title || title.startsWith("http") || title.includes("://")) {
      try {
        const p = new URL(url).pathname.replace(/\/$/, "");
        const seg = p.split("/").pop() || "";
        const c = seg.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();
        return c || new URL(url).hostname;
      } catch { return url; }
    }
    const decoded = decodeHtmlEntities(title).replace(/\s+/g, " ").trim();
    const brand = getBrandFromUrl(url);
    if (!brand) return decoded;
    const parts = decoded.split(/\s*[|–—]\s*/).map(p => p.trim()).filter(Boolean);
    if (parts.length <= 1) return decoded;
    const nb = normalizeTitleToken(brand);
    const filtered = parts.filter((p, i) => {
      const np = normalizeTitleToken(p);
      if (np !== nb) return true;
      return i !== 0 && i !== parts.length - 1;
    });
    return filtered.length ? filtered.join(" – ") : decoded;
  }

  function cleanSnippet(snippet) {
    if (!snippet) return "";
    return decodeHtmlEntities(snippet)
      .replace(/Siirry sisältöön/gi, "")
      .replace(/Kirjaudu sisään/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 200);
  }

  function formatPrice(price, currency) {
    const num = typeof price === "string" ? parseFloat(price) : price;
    if (isNaN(num)) return String(price);
    const f = num.toFixed(2).replace(".", ",");
    return currency === "EUR" || !currency ? `${f} €` : `${f} ${currency}`;
  }

  function formatAvailability(availability) {
    if (!availability) return null;
    const v = String(availability).split("/").pop() || String(availability);
    const k = v.toLowerCase();
    if (k === "instock" || k === "limitedavailability" || k === "onlineonly") return { label: "Varastossa", cls: "instock" };
    if (k === "outofstock" || k === "soldout" || k === "discontinued") return { label: "Loppu", cls: "outofstock" };
    if (k === "preorder" || k === "presale") return { label: "Ennakkotilaus", cls: "instock" };
    return null;
  }

  function escHtml(s) {
    if (!s) return "";
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function addUtm(url, opts) {
    try {
      const u = new URL(url);
      u.searchParams.set("utm_source", "findai");
      u.searchParams.set("utm_medium", "AI-onsite-search");
      u.searchParams.set("utm_campaign", "site-search");
      if (opts && opts.searchLogId) u.searchParams.set("utm_content", String(opts.searchLogId));
      if (opts && opts.clickId) u.searchParams.set("findai_click_id", String(opts.clickId));
      return u.toString();
    } catch { return url; }
  }

  function starHtml(rating, reviewCount) {
    let s = "";
    for (let i = 0; i < 5; i++) {
      s += i < Math.round(Number(rating))
        ? '<span style="color:#f59e0b">★</span>'
        : '<span style="color:#d1d5db">★</span>';
    }
    if (reviewCount) s += ` <span style="font-size:11px;color:#9ca3af">(${escHtml(String(reviewCount))})</span>`;
    return s;
  }

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

  function hslDarken(hslStr, amount) {
    const p = hslStr.match(/(\d+),\s*(\d+)%,\s*(\d+)%/);
    if (!p) return hslStr;
    return `${p[1]}, ${p[2]}%, ${Math.max(0, parseInt(p[3]) - amount)}%`;
  }

  function hslLighten(hslStr, amount) {
    const p = hslStr.match(/(\d+),\s*(\d+)%,\s*(\d+)%/);
    if (!p) return hslStr;
    return `${p[1]}, ${p[2]}%, ${Math.min(100, parseInt(p[3]) + amount)}%`;
  }

  // ---------------------------------------------------------------------------
  // CSS
  // ---------------------------------------------------------------------------
  const CSS = `
    .findai-rw {
      --green: 145, 50%, 40%;
      --green-light: 145, 40%, 96%;
      --green-border: 145, 40%, 85%;
      --green-dark: 145, 50%, 35%;
      --bg: #ffffff;
      --bg2: #f8f9fa;
      --border: #e5e7eb;
      --border-light: rgba(229,231,235,0.5);
      --text: #1a1a1a;
      --text-muted: #6b7280;
      --radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: var(--text);
    }
    .findai-rw.dark {
      --bg: #1e1e2e;
      --bg2: #2a2a3e;
      --border: #3f3f5c;
      --border-light: rgba(63,63,92,0.5);
      --text: #e2e8f0;
      --text-muted: #94a3b8;
    }
    .findai-rw * { box-sizing: border-box; margin: 0; padding: 0; }

    /* Search bar */
    .findai-rw-bar {
      position: relative; display: flex; align-items: center;
      margin-bottom: 24px;
    }
    .findai-rw-bar-icon {
      position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
      color: rgba(107,114,128,0.4); pointer-events: none; display: flex;
    }
    .findai-rw-input {
      width: 100%; height: 52px;
      border: 2px solid var(--border-light); border-radius: var(--radius);
      background: var(--bg); color: var(--text);
      font-size: 16px; padding: 0 48px 0 48px;
      outline: none; font-family: inherit;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .findai-rw-input:focus {
      border-color: hsl(var(--green));
      box-shadow: 0 4px 12px hsla(var(--green), 0.1);
    }
    .findai-rw-input::placeholder { color: rgba(107,114,128,0.4); }
    .findai-rw-clear {
      position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
      background: none; border: none; cursor: pointer;
      color: rgba(107,114,128,0.5); padding: 4px; border-radius: 50%;
      display: none; font-family: inherit;
    }

    /* Status */
    .findai-rw-status {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 16px; font-size: 14px; color: var(--text-muted);
    }
    .findai-rw-status strong { color: var(--text); font-weight: 600; }

    /* AI Summary */
    .findai-rw-summary {
      padding: 16px; margin-bottom: 20px;
      background: hsl(var(--green-light));
      border: 1px solid hsl(var(--green-border));
      border-radius: var(--radius);
    }
    .findai-rw-summary h3 {
      font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 4px;
    }
    .findai-rw-summary p {
      font-size: 13px; line-height: 1.55; color: var(--text-muted); margin: 0;
    }

    /* Grid */
    .findai-rw-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px;
    }
    @media (max-width: 520px) {
      .findai-rw-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    }

    /* Card */
    .findai-rw-card {
      display: flex; flex-direction: column;
      border: 1px solid var(--border-light);
      border-radius: var(--radius);
      background: var(--bg);
      overflow: hidden;
      text-decoration: none; color: var(--text);
      transition: box-shadow 0.15s, border-color 0.15s;
    }
    .findai-rw-card:hover {
      box-shadow: 0 8px 24px rgba(0,0,0,0.08);
      border-color: hsl(var(--green-border));
    }
    .findai-rw-card-img {
      width: 100%; aspect-ratio: 1; object-fit: contain;
      background: #fff; border-bottom: 1px solid var(--border-light);
    }
    .findai-rw-card-body { padding: 12px; flex: 1; display: flex; flex-direction: column; }
    .findai-rw-card-title {
      font-size: 14px; font-weight: 600; line-height: 1.3;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      margin-bottom: 4px;
    }
    .findai-rw-card:hover .findai-rw-card-title { color: hsl(var(--green-dark)); }
    .findai-rw-card-snippet {
      font-size: 12px; color: var(--text-muted); line-height: 1.45;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      margin-bottom: 6px;
    }
    .findai-rw-card-meta { margin-top: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .findai-rw-card-price { font-size: 15px; font-weight: 700; color: hsl(145, 60%, 35%); }
    .findai-rw-card-rating { font-size: 12px; letter-spacing: -0.5px; }
    .findai-rw-badge {
      display: inline-flex; font-size: 10px; font-weight: 600;
      padding: 3px 7px; border-radius: 999px; white-space: nowrap;
    }
    .findai-rw-badge-instock { background: #f3f4f6; color: #4b5563; border: 1px solid #d1d5db; }
    .findai-rw-badge-outofstock { background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; }

    /* List view card (for non-product results) */
    .findai-rw-list-item {
      display: flex; gap: 12px; align-items: flex-start;
      padding: 14px 0;
      border-bottom: 1px solid var(--border-light);
      text-decoration: none; color: var(--text);
    }
    .findai-rw-list-item:last-child { border-bottom: none; }
    .findai-rw-list-item:hover .findai-rw-list-title { color: hsl(var(--green-dark)); }
    .findai-rw-list-title { font-size: 15px; font-weight: 600; line-height: 1.3; }
    .findai-rw-list-snippet { font-size: 13px; color: var(--text-muted); margin-top: 4px; line-height: 1.5; }
    .findai-rw-list-url { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

    /* Loading */
    .findai-rw-loading {
      display: flex; align-items: center; justify-content: center;
      gap: 6px; padding: 48px 16px;
    }
    .findai-rw-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: rgba(107,114,128,0.4);
      animation: findai-rw-pulse 1.2s ease-in-out infinite;
    }
    .findai-rw-dot:nth-child(2) { animation-delay: 0.15s; }
    .findai-rw-dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes findai-rw-pulse {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    /* No results */
    .findai-rw-empty {
      text-align: center; padding: 48px 16px;
      color: var(--text-muted); font-size: 15px;
    }
  `;

  // ---------------------------------------------------------------------------
  // Icons
  // ---------------------------------------------------------------------------
  const ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const ICON_CLOSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const ICON_SPARKLES = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------
  let currentSearchLogId = null;
  let lastQuery = "";
  let debounceTimer = null;

  function build() {
    const container = document.querySelector(TARGET);
    if (!container) { console.warn("[FindAI Results] Target not found:", TARGET); return; }

    // Inject styles
    const styleEl = document.createElement("style");
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    // Fetch brand and apply
    fetch(`${SUPABASE_URL}/rest/v1/sites?select=brand_color,brand_font,brand_bg_color&id=eq.${SITE_ID}&limit=1`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
    }).then(r => r.json()).then(data => {
      if (!data || !data[0]) return;
      const s = data[0];
      let css = "";
      if (s.brand_color) {
        const hsl = hexToHsl(s.brand_color);
        css += `.findai-rw {
          --green: ${hsl}; --green-light: ${hslLighten(hsl, 52)};
          --green-border: ${hslLighten(hsl, 40)}; --green-dark: ${hslDarken(hsl, 5)};
        }
        .findai-rw-input:focus { border-color: hsl(${hsl}); box-shadow: 0 4px 12px hsla(${hsl}, 0.1); }
        .findai-rw-card-price { color: hsl(${hslDarken(hsl, 5)}); }`;
      }
      if (s.brand_font) css += `.findai-rw { font-family: '${s.brand_font}', -apple-system, BlinkMacSystemFont, sans-serif; }`;
      if (css) { const el = document.createElement("style"); el.textContent = css; document.head.appendChild(el); }
    }).catch(() => {});

    // Wrapper
    const wrapper = document.createElement("div");
    wrapper.className = `findai-rw${THEME === "dark" ? " dark" : ""}`;

    // Search bar
    const bar = document.createElement("div");
    bar.className = "findai-rw-bar";
    bar.innerHTML = `
      <span class="findai-rw-bar-icon">${ICON_SEARCH}</span>
      <input class="findai-rw-input" type="search" autocomplete="off" spellcheck="false" placeholder="Hae tuotteita, palveluita...">
      <button class="findai-rw-clear">${ICON_CLOSE}</button>
    `;
    wrapper.appendChild(bar);

    // Results area
    const resultsArea = document.createElement("div");
    resultsArea.className = "findai-rw-results";
    wrapper.appendChild(resultsArea);

    container.appendChild(wrapper);

    const input = bar.querySelector(".findai-rw-input");
    const clearBtn = bar.querySelector(".findai-rw-clear");

    function updateClear() { clearBtn.style.display = input.value ? "block" : "none"; }

    clearBtn.addEventListener("click", () => {
      input.value = "";
      updateClear();
      resultsArea.innerHTML = "";
      input.focus();
      // Update URL
      const url = new URL(window.location);
      url.searchParams.delete("findai_q");
      window.history.replaceState(null, "", url.toString());
    });

    input.addEventListener("input", () => {
      updateClear();
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      if (!q) { resultsArea.innerHTML = ""; return; }
      debounceTimer = setTimeout(() => doSearch(q, resultsArea), 400);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const q = input.value.trim();
        if (q) {
          clearTimeout(debounceTimer);
          doSearch(q, resultsArea);
          // Update URL param
          const url = new URL(window.location);
          url.searchParams.set("findai_q", q);
          window.history.replaceState(null, "", url.toString());
        }
      }
    });

    // Read initial query from URL
    const params = new URLSearchParams(window.location.search);
    const initialQ = params.get("findai_q");
    if (initialQ) {
      input.value = initialQ;
      updateClear();
      doSearch(initialQ, resultsArea);
    }
  }

  function doSearch(query, resultsArea) {
    lastQuery = query;
    resultsArea.innerHTML = `<div class="findai-rw-loading"><div class="findai-rw-dot"></div><div class="findai-rw-dot"></div><div class="findai-rw-dot"></div></div>`;

    fetch(`${SUPABASE_URL}/functions/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "apikey": SUPABASE_KEY,
      },
      body: JSON.stringify({ query, site_id: SITE_ID, max_results: MAX_RESULTS }),
    })
      .then(r => { if (!r.ok) throw new Error("Search error"); return r.json(); })
      .then(data => renderResults(data, resultsArea))
      .catch(() => {
        resultsArea.innerHTML = '<div class="findai-rw-empty">Haku epäonnistui. Yritä uudelleen.</div>';
      });
  }

  function renderResults(data, resultsArea) {
    if (!data.results || data.results.length === 0) {
      let html = `<div class="findai-rw-empty">Ei hakutuloksia haulle "${escHtml(lastQuery)}"`;
      if (data.ai_summary) {
        html += `<div class="findai-rw-summary" style="text-align:left;margin-top:20px"><p>${escHtml(data.ai_summary)}</p></div>`;
      }
      html += "</div>";
      resultsArea.innerHTML = html;
      return;
    }

    currentSearchLogId = data.search_log_id;
    const hasProducts = data.results.some(r => r.schema_data && r.schema_data.type === "Product");
    let html = "";

    // Status
    html += `<div class="findai-rw-status">${ICON_SPARKLES} <span><strong>${data.results.length}</strong> osumaa haulle "${escHtml(lastQuery)}"</span></div>`;

    // AI Summary
    if (data.ai_summary) {
      html += `<div class="findai-rw-summary"><p>${escHtml(data.ai_summary)}</p></div>`;
    }

    if (hasProducts) {
      // Grid view for products
      html += '<div class="findai-rw-grid">';
      data.results.forEach((r, idx) => {
        const clickId = `findai-${SESSION_ID}-${idx}-${Date.now()}`;
        const title = cleanTitle(r.title, r.url);
        const s = r.schema_data;
        const isProduct = s && s.type === "Product";
        const urlUtm = addUtm(r.url, { searchLogId: currentSearchLogId, clickId });
        const avail = isProduct ? formatAvailability(s.availability) : null;

        html += `<a href="${escHtml(urlUtm)}" target="_self" class="findai-rw-card" data-url="${escHtml(r.url)}" data-click-id="${escHtml(clickId)}" data-idx="${idx}">`;
        if (isProduct && s.image) {
          html += `<img class="findai-rw-card-img" src="${escHtml(s.image)}" alt="${escHtml(title)}" loading="lazy" onerror="this.style.display='none'">`;
        }
        html += '<div class="findai-rw-card-body">';
        html += `<div class="findai-rw-card-title">${escHtml(title)}</div>`;
        if (!isProduct && r.snippet) {
          html += `<div class="findai-rw-card-snippet">${escHtml(cleanSnippet(r.snippet))}</div>`;
        }
        html += '<div class="findai-rw-card-meta">';
        if (isProduct && s.price) html += `<div class="findai-rw-card-price">${formatPrice(s.price, s.currency)}</div>`;
        if (isProduct && s.rating) html += `<div class="findai-rw-card-rating">${starHtml(s.rating, s.reviewCount)}</div>`;
        if (avail) html += `<div class="findai-rw-badge findai-rw-badge-${avail.cls}">${escHtml(avail.label)}</div>`;
        html += '</div></div></a>';
      });
      html += '</div>';
    } else {
      // List view for non-product pages
      data.results.forEach((r, idx) => {
        const clickId = `findai-${SESSION_ID}-${idx}-${Date.now()}`;
        const title = cleanTitle(r.title, r.url);
        const snippet = cleanSnippet(r.snippet);
        const urlUtm = addUtm(r.url, { searchLogId: currentSearchLogId, clickId });
        let urlDisplay = "";
        try { urlDisplay = new URL(r.url).pathname; } catch {}

        html += `<a href="${escHtml(urlUtm)}" target="_self" class="findai-rw-list-item" data-url="${escHtml(r.url)}" data-click-id="${escHtml(clickId)}" data-idx="${idx}">`;
        html += '<div>';
        html += `<div class="findai-rw-list-title">${escHtml(title)}</div>`;
        if (snippet) html += `<div class="findai-rw-list-snippet">${escHtml(snippet)}</div>`;
        if (urlDisplay) html += `<div class="findai-rw-list-url">${escHtml(urlDisplay)}</div>`;
        html += '</div></a>';
      });
    }

    resultsArea.innerHTML = html;

    // Click tracking
    resultsArea.querySelectorAll(".findai-rw-card, .findai-rw-list-item").forEach(el => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        trackClick(el.dataset.url, parseInt(el.dataset.idx || "0", 10), el.dataset.clickId || "", el.getAttribute("href"));
      });
    });
  }

  function trackClick(url, position, clickId, navigateHref) {
    const finishNavigation = () => { if (navigateHref) window.location.href = navigateHref; };
    if (!currentSearchLogId) { finishNavigation(); return; }

    let completed = false;
    const settle = () => { if (completed) return; completed = true; finishNavigation(); };

    fetch(`${SUPABASE_URL}/functions/v1/search`, {
      method: "POST",
      keepalive: true,
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
        search_log_id: currentSearchLogId,
        click_id: clickId || null,
        session_id: SESSION_ID,
        click_position: position || 0,
      }),
    }).then(settle).catch(settle);

    if (navigateHref) setTimeout(settle, 160);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
