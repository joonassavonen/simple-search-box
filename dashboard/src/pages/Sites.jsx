import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import "./Page.css";

export default function Sites() {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [crawling, setCrawling] = useState({});
  const [jobStatus, setJobStatus] = useState({});

  const loadSites = useCallback(async () => {
    try {
      const data = await api.listSites();
      setSites(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  async function setupDemo() {
    try {
      await api.setupDemo();
      await loadSites();
    } catch (e) {
      alert("Demo setup failed: " + e.message);
    }
  }

  async function triggerCrawl(site) {
    setCrawling((prev) => ({ ...prev, [site.id]: true }));
    try {
      const job = await api.triggerCrawl(site.id);
      pollJob(site.id, job.job_id);
    } catch (e) {
      alert("Crawl failed: " + e.message);
      setCrawling((prev) => ({ ...prev, [site.id]: false }));
    }
  }

  function pollJob(siteId, jobId) {
    const interval = setInterval(async () => {
      try {
        const status = await api.getCrawlJob(jobId);
        setJobStatus((prev) => ({ ...prev, [siteId]: status }));

        if (["done", "done_with_errors", "failed"].includes(status.status)) {
          clearInterval(interval);
          setCrawling((prev) => ({ ...prev, [siteId]: false }));
          await loadSites();
        }
      } catch {
        clearInterval(interval);
        setCrawling((prev) => ({ ...prev, [siteId]: false }));
      }
    }, 2000);
  }

  if (loading) return <div className="page-loading">Loading sites...</div>;
  if (error) return <div className="page-error">Error: {error}</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Sites</h1>
          <p className="page-subtitle">Manage indexed websites</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={setupDemo}>
            Load Demo Site
          </button>
          <Link to="/add-site" className="btn btn-primary">
            + Add Site
          </Link>
        </div>
      </div>

      {sites.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🌐</div>
          <h3>No sites yet</h3>
          <p>Add a site to start indexing, or load the demo to explore FindAI.</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={setupDemo}>
              Load Demo Site
            </button>
            <Link to="/add-site" className="btn btn-primary">
              Add Your Site
            </Link>
          </div>
        </div>
      ) : (
        <div className="card-grid">
          {sites.map((site) => {
            const job = jobStatus[site.id];
            const isCrawling = crawling[site.id];
            return (
              <div key={site.id} className="card site-card">
                <div className="site-card-header">
                  <div>
                    <h3 className="site-name">{site.name}</h3>
                    <div className="site-domain">{site.domain}</div>
                  </div>
                  <span className={`badge ${site.is_active ? "badge-success" : "badge-muted"}`}>
                    {site.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                <div className="site-stats">
                  <div className="stat">
                    <div className="stat-value">{site.page_count}</div>
                    <div className="stat-label">Pages</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value">{site.id}</div>
                    <div className="stat-label">Site ID</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value">
                      {site.last_crawled_at
                        ? new Date(site.last_crawled_at).toLocaleDateString()
                        : "Never"}
                    </div>
                    <div className="stat-label">Last crawl</div>
                  </div>
                </div>

                {isCrawling && job && (
                  <div className="crawl-progress">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{
                          width: job.pages_found
                            ? `${Math.round((job.pages_indexed / job.pages_found) * 100)}%`
                            : "10%",
                        }}
                      />
                    </div>
                    <div className="progress-text">
                      {job.pages_indexed}/{job.pages_found || "?"} pages indexed
                    </div>
                  </div>
                )}
                {isCrawling && !job && (
                  <div className="crawl-progress">
                    <div className="progress-bar">
                      <div className="progress-fill indeterminate" />
                    </div>
                    <div className="progress-text">Starting crawl...</div>
                  </div>
                )}

                <div className="site-card-footer">
                  <div className="api-key-row">
                    <span className="api-key-label">API Key:</span>
                    <code className="api-key-value">{site.api_key.slice(0, 12)}…</code>
                  </div>

                  <div className="card-actions">
                    <Link to={`/analytics/${site.id}`} className="btn btn-ghost">
                      Analytics
                    </Link>
                    <Link to={`/search/${site.id}`} className="btn btn-ghost">
                      Test Search
                    </Link>
                    <button
                      className="btn btn-primary"
                      onClick={() => triggerCrawl(site)}
                      disabled={isCrawling}
                    >
                      {isCrawling ? "Crawling…" : "Re-crawl"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
