

# Analytics Page v2 — Comprehensive Redesign Plan

## Summary
Restructure the Analytics page into a tabbed layout with three sections: **Search Performance**, **Learning** (synonyms + boosts), and **Integrations** (GA + future). This consolidates the current separate Integrations page into Analytics and adds a full Learning dashboard with boost/click data.

## Architecture

```text
Analytics Page (Tabs)
├── Search Performance (current content, unchanged)
│   ├── KPI cards
│   ├── Line chart with metric selector
│   └── 3-column tables (top searches, no results, no clicks)
├── Learning
│   ├── KPI row: synonym count, boost pairs, total clicks learned
│   ├── Synonyms table (from/to/confidence/uses) + run learning button
│   ├── Boosts table (query → URL, click count, boost score)
│   └── Click position distribution (bar chart)
└── Integrations
    ├── Google Analytics card (moved from Integrations page)
    └── Shopify / WooCommerce placeholders
```

## Technical Details

### 1. Tabbed layout using existing `Tabs` component
- Three tabs: "Hakuanalyysi", "Oppiminen", "Integraatiot"
- All data loads on mount; tabs switch instantly (no re-fetch)

### 2. Learning tab — new content
- Call `api.getLearningStats(siteId)` which already fetches `search_clicks` and `search_synonyms`
- Display synonyms table (already exists, moved here)
- New: **Boosts table** showing top query→URL pairs ranked by click_count with boost score
- New: **KPI cards** for synonym count, boost pairs, total learned clicks
- Keep the "Käynnistä oppiminen" button here
- Optional: small bar chart for click position distribution using Recharts `BarChart`

### 3. Integrations tab — merge from Integrations page
- Move the full GA config card from `src/pages/Integrations.tsx` into this tab
- Keep Shopify/WooCommerce placeholders
- Update sidebar nav: remove separate Integrations link or redirect to `analytics#integrations`

### 4. Route cleanup
- Keep `/sites/:siteId/integrations` route but redirect to analytics page (or remove)
- Update `DashboardLayout.tsx` sidebar links

### Files to modify
- **`src/pages/Analytics.tsx`** — major rewrite: add Tabs, Learning section, embed Integrations content
- **`src/lib/api.ts`** — minor: ensure `getLearningStats` returns all needed data
- **`src/App.tsx`** — remove or redirect Integrations route
- **`src/components/DashboardLayout.tsx`** — update nav links
- **`src/pages/Integrations.tsx`** — can be deleted or turned into redirect

