# FindAI — AI-Powered Site Search

A drop-in site search widget that understands user **problems** (not just keywords) and recommends the highest-converting pages. Designed for Finnish and English markets.

## How it works

```
Customer adds <script> tag → User types query → TF-IDF retrieves candidates
→ Claude understands intent & re-ranks → Widget shows results with AI snippets
→ Every click/miss is logged → Admin sees content gaps in dashboard
```

## Quick start

### 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp ../.env.example .env
# Add your ANTHROPIC_API_KEY to .env

uvicorn app.main:app --reload
# API: http://localhost:8000
# Docs: http://localhost:8000/docs
```

### 2. Admin dashboard

```bash
npm install
npm run dev
# Dashboard: http://localhost:8080
```

### 3. Demo site (no real crawl needed)

```bash
cd backend
python crawl.py demo          # seeds a Finnish sample site
python crawl.py search --site-id 1 --query "sähkökatko mitä teen"
python crawl.py search --site-id 1 --query "how do I pay my bill"
```

### 4. Crawl a real site

```bash
# Via CLI
python crawl.py crawl --sitemap https://helen.fi/sitemap.xml --max-pages 100

# Via API
curl -X POST http://localhost:8000/api/sites \
  -H "Content-Type: application/json" \
  -d '{"name":"Helen","domain":"helen.fi","sitemap_url":"https://helen.fi/sitemap.xml"}'

curl -X POST http://localhost:8000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"site_id": 1}'
```

### 5. Embed the widget

```html
<!-- Add to any page on the indexed site -->
<script
  src="http://localhost:8000/widget.js"
  data-site-id="1"
  data-api-url="http://localhost:8000">
</script>
```

**Widget options:**

| Attribute | Default | Description |
|---|---|---|
| `data-site-id` | — | Required. Your site ID |
| `data-api-url` | `http://localhost:8000` | Backend URL |
| `data-theme` | `light` | `light` or `dark` |
| `data-position` | `bottom-right` | `bottom-right`, `bottom-left`, `top-right`, or `inline` |
| `data-inline-target` | — | CSS selector for inline mode |
| `data-placeholder-fi` | `Hae sivustolta...` | Finnish placeholder |
| `data-placeholder-en` | `Search the site...` | English placeholder |

Keyboard shortcut: **Cmd/Ctrl+K** opens the search dialog.

## API reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/sites` | POST | Register a new site |
| `/api/sites` | GET | List all sites |
| `/api/sites/{id}` | GET | Get site details |
| `/api/sites/{id}/stats` | GET | Search analytics |
| `/api/crawl` | POST | Trigger a crawl |
| `/api/crawl/{job_id}` | GET | Poll crawl status |
| `/api/search` | POST | Run a search |
| `/api/search/click` | POST | Track a result click |
| `/api/demo/setup` | GET | Create demo site |
| `/widget.js` | GET | Serve the embeddable widget |

## Architecture

```
/backend
  /app
    main.py        — FastAPI routes, startup
    models.py      — SQLAlchemy ORM + Pydantic schemas
    database.py    — DB engine & session
    crawler.py     — Sitemap crawler & HTML extractor
    search.py      — TF-IDF retrieval + Claude re-ranking
    analytics.py   — Stats aggregation
  crawl.py         — CLI tool (rich terminal UI)
  requirements.txt

/widget
  widget.js        — Embeddable widget (shadow DOM, zero deps)

/src
  App.tsx          — Routes + layout
  lib/api.ts       — Typed API client
  pages/
    Sites.tsx          — Site list + crawl trigger
    AddSite.tsx        — Register a new site
    Analytics.tsx      — Search stats + content gaps
    SearchPreview.tsx  — Live search testing
  components/
    DashboardLayout.tsx — Sidebar navigation
```

## Environment variables

See `.env.example` for all options.

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `SECRET_KEY` | No | For future auth (not used in MVP) |
| `DATABASE_URL` | No | Defaults to `sqlite:///./findai.db` |
| `RATE_LIMIT_PER_MINUTE` | No | Searches per site per minute (default: 30) |
| `CRAWLER_MAX_PAGES` | No | Max pages per crawl (default: 500) |

## The search prompt — secret sauce

The Claude prompt in `backend/app/search.py` is designed to:

1. **Understand the underlying problem**, not just match keywords
2. **Detect language** (Finnish / English) automatically
3. **Explain why** each result helps the user
4. **Rank by intent match**, not keyword density
5. **Report failures honestly** so content gaps can be identified

This means a query like *"sähkökatko mitä teen"* (power outage what do I do) correctly surfaces the power outage guide even if the exact words don't appear verbatim on the page — Claude understands the intent.

## Content gap analytics

The "Failed Searches" view in the dashboard shows queries where:
- AI found no confident matches (`has_good_results: false`)
- Users didn't click any result

This is actionable signal for content teams: these are topics your users care about but your site doesn't cover well.

## Upgrading embeddings

The MVP uses TF-IDF for candidate retrieval (fast, no extra API costs). To upgrade:

1. Replace `retrieve_candidates()` in `search.py` with calls to `anthropic.embeddings` or OpenAI embeddings
2. Store vectors in a `pgvector` column or a dedicated vector DB (Qdrant, Chroma)
3. TF-IDF → vector similarity for retrieval; Claude still does re-ranking

## Production checklist

- [ ] Replace SQLite with PostgreSQL
- [ ] Add real authentication (JWT) to admin dashboard
- [ ] Move `ANTHROPIC_API_KEY` to a secrets manager
- [ ] Set `ALLOWED_ORIGINS` to actual domains
- [ ] Add proper logging / observability
- [ ] CDN-serve `widget.js` with a versioned URL
- [ ] Add webhook for crawl-complete notifications
