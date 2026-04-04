import React from "react";
import { Link, useLocation } from "react-router-dom";
import "./Layout.css";

const NAV = [
  { path: "/", label: "Sites", icon: "🌐" },
  { path: "/analytics", label: "Analytics", icon: "📊" },
  { path: "/add-site", label: "Add Site", icon: "+" },
];

export default function Layout({ children }) {
  const loc = useLocation();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">🔍</span>
          <span className="logo-text">FindAI</span>
          <span className="logo-badge">Admin</span>
        </div>

        <nav className="sidebar-nav">
          {NAV.map((n) => (
            <Link
              key={n.path}
              to={n.path}
              className={`nav-item${loc.pathname === n.path ? " active" : ""}`}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <a
            href="http://localhost:8000/docs"
            target="_blank"
            rel="noopener"
            className="nav-item"
          >
            <span className="nav-icon">📚</span>
            API Docs
          </a>
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
