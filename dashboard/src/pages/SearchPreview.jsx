import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import "./Page.css";

export default function SearchPreview() {
  const { siteId } = useParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [site, setSite] = useState(null);
  const [debounce, setDebounce] = useState(null);

  useEffect(() => {
    api.getSite(siteId).then(setSite).catch(() => {});
  }, [siteId]);

  function handleQuery(q) {
    setQuery(q);
    clearTimeout(debounce);
    if (!q.trim()) { setResults(null); return; }
    const t = setTimeout(() => doSearch(q), 400);
    setDebounce(t);
  }

  async function doSearch(q) {
    setLoading(true);
    try {
      const data = await api.search(siteId, q);
      setResults(data);
    } catch (e) {
      setResults({ error: e.message });
    } finally {
      setLoading(false);
    }
  }

  function scoreColor(score) {
    if (score >= 0.8) return "#16a34a";
    if (score >= 0.6) return "#d97706";
    return "#6b7280";
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Test Search</h1>
          <p className="page-subtitle">{site?.name} ({site?.domain})</p>
        </div>
        <Link to="/" className="btn btn-ghost">← Back</Link>
      </div>

      <div className="card search-preview-card">
        <div className="search-bar-preview">
          <span className="search-icon">🔍</span>
          <input
            className="search-input-preview"
            placeholder={site?.domain?.includes("helen") || query.match(/[äöå]/i)
              ? "Hae sivustolta, esim. 'sähkökatko mitä teen'..."
              : "Search the site, e.g. 'how do I pay my bill'..."}
            value={query}
            onChange={(e) => handleQuery(e.target.value)}
            autoFocus
          />
          {loading && <span className="search-spinner">⟳</span>}
        </div>

        {!query && (
          <div className="search-hints">
            <p className="text-muted" style={{ marginBottom: 12 }}>Try example queries:</p>
            <div className="hint-pills">
              {[
                "sähkökatko mitä teen",
                "how do I cancel my contract",
                "lasku virheellinen",
                "renewable energy options",
              ].map((h) => (
                <button key={h} className="hint-pill" onClick={() => handleQuery(h)}>
                  {h}
                </button>
              ))}
            </div>
          </div>
        )}

        {results && !results.error && (
          <div className="search-results-preview">
            <div className="results-meta">
              <span>{results.results?.length || 0} results</span>
              <span className="lang-badge">{results.language === "fi" ? "🇫🇮 Finnish" : "🇬🇧 English"}</span>
              <span>{results.response_ms}ms</span>
            </div>

            {results.results?.map((r, i) => (
              <div key={i} className="result-preview-item">
                <div className="result-preview-header">
                  <a href={r.url} target="_blank" rel="noopener" className="result-preview-title">
                    {r.title || r.url}
                  </a>
                  <span
                    className="result-preview-score"
                    style={{ color: scoreColor(r.score) }}
                  >
                    {(r.score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="result-preview-snippet">{r.snippet}</div>
                <div className="result-preview-reasoning">
                  <strong>Why:</strong> {r.reasoning}
                </div>
                <div className="result-preview-url">{r.url.replace(/^https?:\/\//, "")}</div>
              </div>
            ))}

            {results.fallback_message && (
              <div className="fallback-msg">{results.fallback_message}</div>
            )}
          </div>
        )}

        {results?.error && (
          <div className="form-error" style={{ marginTop: 16 }}>
            Search error: {results.error}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h4 style={{ marginBottom: 8 }}>Widget snippet for {site?.name}</h4>
        <pre className="code-block">{`<script
  src="http://localhost:8000/widget.js"
  data-site-id="${siteId}"
  data-api-url="http://localhost:8000">
</script>`}</pre>
      </div>
    </div>
  );
}
