/**
 * FindAI – embeddable search widget
 *
 * Installation:
 *   <script src="https://findai.app/widget.js"
 *           data-site-id="123"
 *           data-api-url="https://api.findai.app"></script>
 *
 * Optional attributes:
 *   data-placeholder-fi  – Finnish placeholder text
 *   data-placeholder-en  – English placeholder text
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
  const configFromWindow = window.__FINDAI_CONFIG || {};
  const SITE_ID = configFromWindow.siteId || (script && script.getAttribute("data-site-id")) || "0";
  const API_URL = (configFromWindow.apiUrl || (script && script.getAttribute("data-api-url")) || "http://localhost:8000").replace(/\/$/, "");
  const THEME = configFromWindow.theme || (script && script.getAttribute("data-theme")) || "light";
  const POSITION = configFromWindow.position || (script && script.getAttribute("data-position")) || "bottom-right";
  const INLINE_TARGET = configFromWindow.inlineTarget || (script && script.getAttribute("data-inline-target")) || null;
  const PH_FI = (script && script.getAttribute("data-placeholder-fi")) || "Hae sivustolta...";
  const PH_EN = (script && script.getAttribute("data-placeholder-en")) || "Search the site...";

  if (!SITE_ID || SITE_ID === "0") {
    console.warn("[FindAI] Missing data-site-id attribute");
    return;
  }

  // Session ID for click tracking
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
  // CSS (injected into Shadow DOM)
  // -------------------------------------------------------------------------
  const CSS = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    .findai-wrapper {
      --bg: #ffffff;
      --bg2: #f8f9fa;
      --border: #e1e4e8;
      --text: #1a1a1a;
      --text-muted: #6b7280;
      --accent: #2563eb;
      --accent-light: #eff6ff;
      --shadow: 0 4px 24px rgba(0,0,0,0.12);
      --radius: 12px;
    }

    .findai-wrapper.dark {
      --bg: #1e1e2e;
      --bg2: #2a2a3e;
      --border: #3f3f5c;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #60a5fa;
      --accent-light: #1e3a5f;
      --shadow: 0 4px 24px rgba(0,0,0,0.5);
    }

    /* --- Trigger button (floating) --- */
    .findai-trigger {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 999px;
      padding: 10px 18px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      box-shadow: var(--shadow);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      white-space: nowrap;
    }
    .findai-trigger:hover { transform: translateY(-1px); box-shadow: 0 6px 28px rgba(0,0,0,0.18); }
    .findai-trigger svg { flex-shrink: 0; }

    .pos-bottom-right { bottom: 24px; right: 24px; }
    .pos-bottom-left  { bottom: 24px; left: 24px; }
    .pos-top-right    { top: 24px; right: 24px; }

    /* --- Modal overlay --- */
    .findai-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      backdrop-filter: blur(2px);
      z-index: 2147483646;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 10vh;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .findai-overlay.open { opacity: 1; pointer-events: all; }

    /* --- Search panel --- */
    .findai-panel {
      width: min(640px, 94vw);
      background: var(--bg);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      transform: translateY(-8px);
      transition: transform 0.2s ease;
    }
    .findai-overlay.open .findai-panel { transform: translateY(0); }

    /* --- Inline mode --- */
    .findai-inline {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    /* --- Search bar --- */
    .findai-bar {
      display: flex;
      align-items: center;
      padding: 14px 18px;
      gap: 12px;
      border-bottom: 1px solid var(--border);
    }
    .findai-bar svg { color: var(--text-muted); flex-shrink: 0; }

    .findai-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-size: 16px;
      color: var(--text);
      caret-color: var(--accent);
    }
    .findai-input::placeholder { color: var(--text-muted); }

    .findai-close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      padding: 4px;
      border-radius: 6px;
      display: flex;
      align-items: center;
    }
    .findai-close:hover { background: var(--bg2); }

    /* --- Suggestions dropdown --- */
    .findai-suggestions {
      border-bottom: 1px solid var(--border);
      padding: 4px 0;
      background: var(--bg);
    }
    .findai-suggestion {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 20px;
      cursor: pointer;
      font-size: 14px;
      color: var(--text);
      transition: background 0.1s;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      font-family: inherit;
    }
    .findai-suggestion:hover, .findai-suggestion.active {
      background: var(--accent-light);
    }
    .findai-suggestion svg { color: var(--text-muted); flex-shrink: 0; }

    /* --- Trending section --- */
    .findai-trending {
      padding: 16px 20px;
    }
    .findai-trending-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 10px;
    }
    .findai-trending-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .findai-trending-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 12px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 999px;
      font-size: 13px;
      color: var(--text);
      cursor: pointer;
      transition: background 0.1s, border-color 0.1s;
      font-family: inherit;
    }
    .findai-trending-item:hover {
      background: var(--accent-light);
      border-color: var(--accent);
      color: var(--accent);
    }

    /* --- Results --- */
    .findai-results {
      max-height: 60vh;
      overflow-y: auto;
      padding: 8px 0;
    }

    .findai-state {
      padding: 32px 20px;
      text-align: center;
      color: var(--text-muted);
      font-size: 14px;
    }

    .findai-spinner {
      display: flex;
      gap: 6px;
      justify-content: center;
      margin: 0 auto 12px;
    }
    .findai-spinner-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--accent);
      animation: findai-pulse 1.2s ease-in-out infinite;
    }
    .findai-spinner-dot:nth-child(2) { animation-delay: 0.15s; }
    .findai-spinner-dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes findai-pulse {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }

    .findai-result {
      display: block;
      padding: 14px 20px;
      text-decoration: none;
      cursor: pointer;
      border-bottom: 1px solid var(--border);
      transition: background 0.1s;
    }
    .findai-result:last-child { border-bottom: none; }
    .findai-result:hover { background: var(--accent-light); }

    .findai-result-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 4px;
    }

    .findai-result-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--accent);
      flex: 1;
    }

    .findai-score {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 999px;
      background: var(--accent-light);
      color: var(--accent);
      white-space: nowrap;
    }

    .findai-snippet {
      font-size: 13px;
      color: var(--text);
      line-height: 1.5;
      margin-bottom: 4px;
    }

    .findai-url {
      font-size: 11px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* --- Schema rich data --- */
    .findai-schema {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .findai-schema-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 1px 6px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    .findai-schema-price {
      font-weight: 600;
      color: var(--text);
    }
    .findai-schema-rating {
      color: #f59e0b;
    }
    .findai-schema-image {
      width: 48px;
      height: 48px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid var(--border);
      float: right;
      margin-left: 10px;
    }

    /* --- Fallback --- */
    .findai-fallback {
      padding: 20px;
      margin: 8px 12px;
      background: var(--bg2);
      border-radius: 8px;
      font-size: 13px;
      color: var(--text-muted);
      text-align: center;
    }

    /* --- Contact CTA --- */
    .findai-contact-cta {
      padding: 16px 20px;
      text-align: center;
    }
    .findai-contact-cta p {
      font-size: 14px;
      font-weight: 500;
      color: var(--text);
      margin-bottom: 12px;
    }
    .findai-contact-buttons {
      display: flex;
      gap: 8px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .findai-contact-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      background: var(--accent);
      color: #fff;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      transition: opacity 0.15s;
      font-family: inherit;
    }
    .findai-contact-btn:hover { opacity: 0.9; }

    /* --- Footer --- */
    .findai-footer {
      padding: 8px 16px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .findai-footer-hint { font-size: 11px; color: var(--text-muted); }
    .findai-brand {
      font-size: 11px;
      color: var(--text-muted);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .findai-brand:hover { color: var(--accent); }

    /* Scrollbar */
    .findai-results::-webkit-scrollbar { width: 6px; }
    .findai-results::-webkit-scrollbar-track { background: transparent; }
    .findai-results::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  `;

  // -------------------------------------------------------------------------
  // SVG icons
  // -------------------------------------------------------------------------
  const ICON_SEARCH = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  const ICON_CLOSE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const ICON_TRENDING = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;

  // -------------------------------------------------------------------------
  // Widget state
  // -------------------------------------------------------------------------
  let currentSearchLogId = null;
  let debounceTimer = null;
  let suggestDebounce = null;
  let lastQuery = "";
  let trendingData = null;
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
    } else {
      trigger = document.createElement("button");
      trigger.className = `findai-trigger pos-${POSITION}`;
      trigger.innerHTML = `${ICON_SEARCH} <span class="findai-trigger-label">Search</span>`;
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

    const searchIcon = document.createElement("span");
    searchIcon.innerHTML = ICON_SEARCH;
    bar.appendChild(searchIcon);

    const input = document.createElement("input");
    input.className = "findai-input";
    input.type = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Search query");
    bar.appendChild(input);

    if (overlay) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "findai-close";
      closeBtn.innerHTML = ICON_CLOSE;
      closeBtn.setAttribute("aria-label", "Close search");
      closeBtn.addEventListener("click", closeSearch);
      bar.appendChild(closeBtn);
    }

    panel.appendChild(bar);

    // Suggestions area (between bar and results)
    const suggestionsEl = document.createElement("div");
    suggestionsEl.className = "findai-suggestions";
    suggestionsEl.style.display = "none";
    suggestionsEl.setAttribute("role", "listbox");
    panel.appendChild(suggestionsEl);

    // Results area
    const resultsEl = document.createElement("div");
    resultsEl.className = "findai-results";
    resultsEl.setAttribute("role", "list");
    panel.appendChild(resultsEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "findai-footer";
    footer.innerHTML = `
      <span class="findai-footer-hint">\u2191\u2193 navigate \u00b7 Enter select \u00b7 Esc close</span>
      <a class="findai-brand" href="https://findai.app" target="_blank" rel="noopener">
        ${ICON_SEARCH} FindAI
      </a>
    `;
    panel.appendChild(footer);

    shadow.appendChild(wrapper);

    // Append to inline target or body
    if (POSITION === "inline" && INLINE_TARGET) {
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
    // Prefetch trending + contact config
    // -----------------------------------------------------------------------
    fetch(`${API_URL}/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site_id: SITE_ID, type: "trending", limit: 6 }) })
      .then(r => r.json())
      .then(data => { trendingData = data.trending || []; })
      .catch(() => {});

    fetch(`${API_URL}/api/sites/${SITE_ID}/contact-config`)
      .then(r => r.json())
      .then(data => { contactConfig = data; })
      .catch(() => {});

    // -----------------------------------------------------------------------
    // Event handlers
    // -----------------------------------------------------------------------

    function updatePlaceholder(text) {
      const lang = detectLang(text);
      input.placeholder = lang === "fi" ? PH_FI : PH_EN;
    }

    function openSearch() {
      if (overlay) {
        overlay.classList.add("open");
        input.focus();
        document.addEventListener("keydown", handleGlobalKey);
      }
      // Show trending when opening with empty input
      if (!input.value.trim()) {
        renderTrending();
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

    if (trigger) {
      trigger.addEventListener("click", openSearch);
    }

    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeSearch();
      });
    }

    // Keyboard shortcut: Cmd/Ctrl+K
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (overlay && overlay.classList.contains("open")) {
          closeSearch();
        } else {
          openSearch();
        }
      }
    });

    // Search input
    input.addEventListener("input", () => {
      const q = input.value.trim();
      updatePlaceholder(q);

      clearTimeout(debounceTimer);
      clearTimeout(suggestDebounce);

      if (!q) {
        hideSuggestions();
        renderTrending();
        lastQuery = "";
        return;
      }

      // Autocomplete suggestions (faster debounce)
      if (q.length >= 2) {
        suggestDebounce = setTimeout(() => fetchSuggestions(q), 150);
      } else {
        hideSuggestions();
      }

      if (q === lastQuery) return;

      debounceTimer = setTimeout(() => {
        lastQuery = q;
        hideSuggestions();
        doSearch(q);
      }, 350);
    });

    // Keyboard navigation
    input.addEventListener("keydown", (e) => {
      // If suggestions visible, navigate suggestions
      if (suggestionsEl.style.display !== "none") {
        const items = Array.from(suggestionsEl.querySelectorAll(".findai-suggestion"));
        if (e.key === "ArrowDown") {
          e.preventDefault();
          activeSuggestionIdx = Math.min(activeSuggestionIdx + 1, items.length - 1);
          updateSuggestionFocus(items);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          activeSuggestionIdx = Math.max(activeSuggestionIdx - 1, -1);
          updateSuggestionFocus(items);
        } else if (e.key === "Enter" && activeSuggestionIdx >= 0 && items[activeSuggestionIdx]) {
          e.preventDefault();
          selectSuggestion(items[activeSuggestionIdx].dataset.query);
          return;
        }
        if (activeSuggestionIdx >= 0) return;
      }

      // Otherwise navigate results
      const items = Array.from(resultsEl.querySelectorAll(".findai-result"));
      const focused = resultsEl.querySelector(".findai-result:focus");
      const idx = items.indexOf(focused);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = items[idx + 1] || items[0];
        next && next.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (idx <= 0) { input.focus(); return; }
        items[idx - 1] && items[idx - 1].focus();
      } else if (e.key === "Enter" && focused) {
        e.preventDefault();
        focused.click();
      }
    });

    // -----------------------------------------------------------------------
    // Suggestions
    // -----------------------------------------------------------------------

    function fetchSuggestions(q) {
      fetch(`${API_URL}/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site_id: SITE_ID, type: "suggestions", query: q, limit: 5 }) })
        .then(r => r.json())
        .then(data => {
          if (input.value.trim() !== q) return; // stale
          renderSuggestions(data.suggestions || []);
        })
        .catch(() => {});
    }

    function renderSuggestions(items) {
      if (!items.length) { hideSuggestions(); return; }
      activeSuggestionIdx = -1;
      suggestionsEl.innerHTML = "";
      items.forEach(s => {
        const btn = document.createElement("button");
        btn.className = "findai-suggestion";
        btn.dataset.query = s.query;
        btn.innerHTML = `${ICON_SEARCH} <span>${escHtml(s.query)}</span>`;
        btn.addEventListener("click", () => selectSuggestion(s.query));
        suggestionsEl.appendChild(btn);
      });
      suggestionsEl.style.display = "block";
    }

    function hideSuggestions() {
      suggestionsEl.style.display = "none";
      suggestionsEl.innerHTML = "";
      activeSuggestionIdx = -1;
    }

    function updateSuggestionFocus(items) {
      items.forEach((el, i) => {
        el.classList.toggle("active", i === activeSuggestionIdx);
      });
    }

    function selectSuggestion(q) {
      input.value = q;
      hideSuggestions();
      lastQuery = q;
      doSearch(q);
    }

    // -----------------------------------------------------------------------
    // Trending
    // -----------------------------------------------------------------------

    function renderTrending() {
      if (!trendingData || trendingData.length === 0) {
        resultsEl.innerHTML = "";
        return;
      }
      const lang = navigator.language.startsWith("fi") ? "fi" : "en";
      const title = lang === "fi" ? "Suositut haut" : "Trending searches";

      resultsEl.innerHTML = `
        <div class="findai-trending">
          <div class="findai-trending-title">${ICON_TRENDING} ${escHtml(title)}</div>
          <div class="findai-trending-list"></div>
        </div>
      `;
      const list = resultsEl.querySelector(".findai-trending-list");
      trendingData.forEach(t => {
        const btn = document.createElement("button");
        btn.className = "findai-trending-item";
        btn.textContent = t.query;
        btn.addEventListener("click", () => {
          input.value = t.query;
          lastQuery = t.query;
          doSearch(t.query);
        });
        list.appendChild(btn);
      });
    }

    // -----------------------------------------------------------------------
    // Rendering helpers
    // -----------------------------------------------------------------------

    function renderLoading(lang) {
      const msg = lang === "fi" ? "Haetaan..." : "Searching...";
      resultsEl.innerHTML = `
        <div class="findai-state">
          <div class="findai-spinner"><div class="findai-spinner-dot"></div><div class="findai-spinner-dot"></div><div class="findai-spinner-dot"></div></div>
          <div>${msg}</div>
        </div>
      `;
    }

    function renderError(lang) {
      const msg = lang === "fi"
        ? "Haku epäonnistui. Yritä uudelleen."
        : "Search failed. Please try again.";
      resultsEl.innerHTML = `<div class="findai-state">${msg}</div>`;
    }

    function renderNoResults(fallback, lang, responseContactConfig) {
      const msg = fallback || (lang === "fi"
        ? "Ei hakutuloksia. Kokeile eri hakusanoja."
        : "No results found. Try different keywords.");
      resultsEl.innerHTML = `<div class="findai-fallback">${msg}</div>`;

      // Add contact CTA
      const cfg = responseContactConfig || contactConfig;
      if (cfg && cfg.enabled) {
        const ctaText = lang === "fi" ? cfg.cta_text_fi : cfg.cta_text_en;
        const ctaEl = document.createElement("div");
        ctaEl.className = "findai-contact-cta";

        let buttonsHtml = "";
        if (cfg.email) {
          const emailLabel = lang === "fi" ? "Sähköposti" : "Email";
          buttonsHtml += `<a href="mailto:${escHtml(cfg.email)}" class="findai-contact-btn">\u2709\uFE0F ${escHtml(emailLabel)}</a>`;
        }
        if (cfg.phone) {
          const phoneLabel = lang === "fi" ? "Soita" : "Call";
          buttonsHtml += `<a href="tel:${escHtml(cfg.phone)}" class="findai-contact-btn">\uD83D\uDCDE ${escHtml(phoneLabel)}</a>`;
        }
        if (cfg.chat_url) {
          buttonsHtml += `<a href="${escHtml(cfg.chat_url)}" target="_blank" rel="noopener" class="findai-contact-btn">\uD83D\uDCAC Chat</a>`;
        }

        if (buttonsHtml) {
          ctaEl.innerHTML = `
            <p>${escHtml(ctaText)}</p>
            <div class="findai-contact-buttons">${buttonsHtml}</div>
          `;
          resultsEl.appendChild(ctaEl);
        }
      }
    }

    function scoreLabel(score) {
      if (score >= 0.8) return "Great match";
      if (score >= 0.6) return "Good match";
      if (score >= 0.4) return "Possible match";
      return "Related";
    }

    function renderResults(data) {
      resultsEl.innerHTML = "";

      if (!data.results || data.results.length === 0) {
        renderNoResults(data.fallback_message, data.language, data.contact_config);
        return;
      }

      currentSearchLogId = data.search_log_id;

      data.results.forEach((r, idx) => {
        const item = document.createElement("a");
        item.className = "findai-result";
        item.href = r.url;
        item.target = "_blank";
        item.rel = "noopener";
        item.setAttribute("role", "listitem");
        item.tabIndex = 0;

        const displayUrl = r.url.replace(/^https?:\/\//, "");
        let schemaHtml = "";

        if (r.schema_data) {
          const s = r.schema_data;
          const parts = [];

          // Type badge
          parts.push(`<span class="findai-schema-badge">${escHtml(s.type)}</span>`);

          // Product: price + rating
          if (s.type === "Product") {
            if (s.price) {
              const currency = s.currency === "EUR" ? "\u20AC" : (s.currency || "");
              parts.push(`<span class="findai-schema-price">${currency}${escHtml(String(s.price))}</span>`);
            }
            if (s.availability) parts.push(`<span>${escHtml(s.availability)}</span>`);
            if (s.rating) parts.push(`<span class="findai-schema-rating">\u2605 ${escHtml(String(s.rating))}</span>`);
            if (s.reviewCount) parts.push(`<span>(${escHtml(String(s.reviewCount))} reviews)</span>`);
          }

          // Article: date + author
          if (s.type === "Article") {
            if (s.datePublished) {
              try { parts.push(`<span>${new Date(s.datePublished).toLocaleDateString()}</span>`); } catch(e) {}
            }
            if (s.author) parts.push(`<span>${escHtml(s.author)}</span>`);
          }

          // Event: date + location
          if (s.type === "Event") {
            if (s.startDate) {
              try { parts.push(`<span>${new Date(s.startDate).toLocaleDateString()}</span>`); } catch(e) {}
            }
            if (s.location) parts.push(`<span>${escHtml(s.location)}</span>`);
          }

          schemaHtml = `<div class="findai-schema">${parts.join("")}</div>`;
        }

        // Product image
        let imageHtml = "";
        if (r.schema_data && r.schema_data.image && (r.schema_data.type === "Product" || r.schema_data.type === "Article")) {
          imageHtml = `<img class="findai-schema-image" src="${escHtml(r.schema_data.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`;
        }

        item.innerHTML = `
          ${imageHtml}
          <div class="findai-result-header">
            <span class="findai-result-title">${escHtml(r.title || displayUrl)}</span>
            <span class="findai-score">${scoreLabel(r.score)}</span>
          </div>
          <div class="findai-snippet">${escHtml(r.snippet)}</div>
          ${schemaHtml}
          <div class="findai-url">${escHtml(displayUrl)}</div>
        `;

        item.addEventListener("click", () => {
          trackClick(r.url, idx);
        });

        resultsEl.appendChild(item);
      });

      if (data.fallback_message) {
        const fb = document.createElement("div");
        fb.className = "findai-fallback";
        fb.textContent = data.fallback_message;
        resultsEl.appendChild(fb);
      }
    }

    // -----------------------------------------------------------------------
    // API calls
    // -----------------------------------------------------------------------

    function doSearch(query) {
      const lang = detectLang(query);
      renderLoading(lang);

      fetch(`${API_URL}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, site_id: SITE_ID, max_results: 5 }),
      })
        .then((r) => {
          if (!r.ok) throw new Error("Search API error");
          return r.json();
        })
        .then(renderResults)
        .catch(() => renderError(lang));
    }

    function trackClick(url, position) {
      if (!currentSearchLogId) return;
      fetch(`${API_URL}/api/search/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search_log_id: currentSearchLogId,
          clicked_url: url,
          click_position: position || 0,
          session_id: SESSION_ID,
        }),
      }).catch(() => {});   // fire-and-forget
    }

    // Set initial placeholder
    input.placeholder = navigator.language.startsWith("fi") ? PH_FI : PH_EN;

    // Update trigger label language
    if (trigger) {
      const label = trigger.querySelector(".findai-trigger-label");
      if (label) {
        label.textContent = navigator.language.startsWith("fi") ? "Hae" : "Search";
      }
    }
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------
  function escHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
