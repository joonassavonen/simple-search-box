import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import "./Page.css";

export default function AddSite() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", domain: "", sitemap_url: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const [crawlStarted, setCrawlStarted] = useState(false);

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));

    // Auto-fill sitemap if domain is entered
    if (field === "domain" && value && !form.sitemap_url) {
      const domain = value.replace(/^https?:\/\//, "").replace(/\/$/, "");
      setForm((f) => ({
        ...f,
        domain,
        sitemap_url: `https://${domain}/sitemap.xml`,
        name: f.name || domain,
      }));
    }
  }

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const site = await api.createSite({
        name: form.name,
        domain: form.domain.replace(/^https?:\/\//, "").replace(/\/$/, ""),
        sitemap_url: form.sitemap_url || undefined,
      });
      setCreated(site);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function startCrawl() {
    if (!created) return;
    setCrawlStarted(true);
    await api.triggerCrawl(created.id);
    navigate("/");
  }

  if (created) {
    return (
      <div>
        <div className="page-header">
          <h1>Site Created</h1>
        </div>
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="success-icon">✅</div>
          <h3 style={{ marginBottom: 12 }}>{created.name} is registered!</h3>

          <div className="info-row">
            <span>Site ID</span>
            <code>{created.id}</code>
          </div>
          <div className="info-row">
            <span>API Key</span>
            <code style={{ wordBreak: "break-all" }}>{created.api_key}</code>
          </div>
          <div className="info-row">
            <span>Domain</span>
            <span>{created.domain}</span>
          </div>

          <div className="callout">
            <strong>Save your API key</strong> — it won't be shown again.
          </div>

          <h4 style={{ margin: "20px 0 8px" }}>Widget snippet</h4>
          <pre className="code-block">{`<script
  src="http://localhost:8000/widget.js"
  data-site-id="${created.id}"
  data-api-url="http://localhost:8000">
</script>`}</pre>

          <div className="card-actions" style={{ marginTop: 20 }}>
            <button className="btn btn-secondary" onClick={() => navigate("/")}>
              Skip crawl for now
            </button>
            <button
              className="btn btn-primary"
              onClick={startCrawl}
              disabled={crawlStarted}
            >
              {crawlStarted ? "Crawl started..." : "Start Crawl Now"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Add Site</h1>
          <p className="page-subtitle">Register a new website for AI-powered search</p>
        </div>
      </div>

      <form onSubmit={submit} className="card form-card" style={{ maxWidth: 560 }}>
        <div className="form-group">
          <label>Domain *</label>
          <input
            type="text"
            placeholder="helen.fi"
            value={form.domain}
            onChange={(e) => set("domain", e.target.value)}
            required
          />
          <span className="form-hint">Just the domain, e.g. helen.fi or example.com</span>
        </div>

        <div className="form-group">
          <label>Site Name *</label>
          <input
            type="text"
            placeholder="Helen"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Sitemap URL</label>
          <input
            type="url"
            placeholder="https://helen.fi/sitemap.xml"
            value={form.sitemap_url}
            onChange={(e) => set("sitemap_url", e.target.value)}
          />
          <span className="form-hint">Leave blank to auto-discover at /sitemap.xml</span>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="card-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate("/")}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Registering..." : "Register Site"}
          </button>
        </div>
      </form>
    </div>
  );
}
