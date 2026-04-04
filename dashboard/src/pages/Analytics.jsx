import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import "./Page.css";

function StatCard({ label, value, sub }) {
  return (
    <div className="card stat-card">
      <div className="stat-big-value">{value}</div>
      <div className="stat-big-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function QueryTable({ title, rows, emptyMsg, badge }) {
  return (
    <div className="card">
      <h3 style={{ marginBottom: 16 }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted">{emptyMsg}</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Query</th>
              <th style={{ width: 80, textAlign: "right" }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  {badge && <span className={`badge ${badge}`} style={{ marginRight: 8, fontSize: 10 }}>!</span>}
                  {r.query}
                </td>
                <td style={{ textAlign: "right" }}>
                  <span className="count-pill">{r.count}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Analytics() {
  const { siteId } = useParams();
  const [stats, setStats] = useState(null);
  const [site, setSite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [s, st] = await Promise.all([
          api.getSite(siteId),
          api.getStats(siteId),
        ]);
        setSite(s);
        setStats(st);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [siteId]);

  if (loading) return <div className="page-loading">Loading analytics...</div>;
  if (error) return <div className="page-error">Error: {error}</div>;

  const ctrPct = (stats.click_through_rate * 100).toFixed(1);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{site?.name} — Analytics</h1>
          <p className="page-subtitle">{site?.domain}</p>
        </div>
        <div className="header-actions">
          <Link to="/" className="btn btn-ghost">← All Sites</Link>
          <Link to={`/search/${siteId}`} className="btn btn-secondary">
            Test Search
          </Link>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          label="Total Searches"
          value={stats.total_searches.toLocaleString()}
          sub="All time"
        />
        <StatCard
          label="Searches (7 days)"
          value={stats.searches_last_7d.toLocaleString()}
          sub="Last 7 days"
        />
        <StatCard
          label="Click-through Rate"
          value={`${ctrPct}%`}
          sub="Searches with a click"
        />
        <StatCard
          label="Avg Results"
          value={stats.avg_results_per_search.toFixed(1)}
          sub="Per search"
        />
        <StatCard
          label="Pages Indexed"
          value={stats.pages_indexed.toLocaleString()}
          sub="In search index"
        />
      </div>

      <div className="two-col" style={{ marginTop: 24 }}>
        <QueryTable
          title="Top Queries (30 days)"
          rows={stats.top_queries}
          emptyMsg="No searches yet."
        />
        <QueryTable
          title="Failed Searches — Content Gaps"
          rows={stats.failed_searches}
          emptyMsg="No failed searches. Great!"
          badge="badge-danger"
        />
      </div>

      {stats.failed_searches.length > 0 && (
        <div className="card callout-card" style={{ marginTop: 24 }}>
          <strong>💡 Content Gap Insight</strong>
          <p style={{ marginTop: 8 }}>
            Users searched for the queries above but didn't click any results.
            Consider creating new content or improving existing pages to cover these topics.
          </p>
        </div>
      )}
    </div>
  );
}
