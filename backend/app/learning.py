"""
Learning module for FindAI.

Handles: trending queries, autocomplete suggestions, CTR boost computation,
synonym discovery, and contact config retrieval.
"""

import math
import time
import json
from datetime import datetime, timedelta

from sqlalchemy import func, desc, and_
from sqlalchemy.orm import Session

from app.models import (
    SearchLog, SearchClick, QueryUrlBoost, LearnedSynonym,
    SiteContactConfig,
)


# ---------------------------------------------------------------------------
# In-memory caches
# ---------------------------------------------------------------------------

_trending_cache: dict[int, tuple[float, list]] = {}  # site_id -> (timestamp, data)
_suggestions_cache: dict[int, tuple[float, list]] = {}  # site_id -> (timestamp, data)
TRENDING_TTL = 600   # 10 minutes
SUGGESTIONS_TTL = 300  # 5 minutes


# ---------------------------------------------------------------------------
# Trending queries
# ---------------------------------------------------------------------------

def get_trending(db: Session, site_id: int, limit: int = 5) -> list[dict]:
    """Return popular queries from the last 7 days that had good results."""
    now = time.time()
    if site_id in _trending_cache:
        ts, data = _trending_cache[site_id]
        if now - ts < TRENDING_TTL:
            return data[:limit]

    since = datetime.utcnow() - timedelta(days=7)
    rows = (
        db.query(SearchLog.query, func.count(SearchLog.id).label("cnt"))
        .filter(
            SearchLog.site_id == site_id,
            SearchLog.created_at >= since,
            SearchLog.had_good_results == True,
        )
        .group_by(func.lower(SearchLog.query))
        .order_by(desc("cnt"))
        .limit(20)
        .all()
    )
    data = [{"query": r[0], "count": r[1]} for r in rows]
    _trending_cache[site_id] = (now, data)
    return data[:limit]


# ---------------------------------------------------------------------------
# Autocomplete suggestions
# ---------------------------------------------------------------------------

def get_suggestions(db: Session, site_id: int, prefix: str, limit: int = 5) -> list[dict]:
    """Return query suggestions matching prefix (only successful searches)."""
    now = time.time()

    # Refresh the full list cache if stale
    if site_id not in _suggestions_cache or now - _suggestions_cache[site_id][0] >= SUGGESTIONS_TTL:
        rows = (
            db.query(
                func.lower(SearchLog.query).label("q"),
                func.count(SearchLog.id).label("cnt"),
            )
            .filter(
                SearchLog.site_id == site_id,
                SearchLog.had_good_results == True,
                SearchLog.clicked_url != None,
            )
            .group_by(func.lower(SearchLog.query))
            .order_by(desc("cnt"))
            .limit(500)
            .all()
        )
        data = [{"query": r[0], "count": r[1]} for r in rows]
        _suggestions_cache[site_id] = (now, data)

    _, all_suggestions = _suggestions_cache[site_id]
    prefix_lower = prefix.lower().strip()
    if not prefix_lower:
        return []

    matches = [s for s in all_suggestions if s["query"].startswith(prefix_lower)]
    return matches[:limit]


# ---------------------------------------------------------------------------
# Wilson score lower bound (for CTR confidence)
# ---------------------------------------------------------------------------

def wilson_lower(clicks: int, impressions: int, z: float = 1.96) -> float:
    """Wilson score interval lower bound for 95% confidence."""
    if impressions == 0:
        return 0.0
    p = clicks / impressions
    denom = 1 + z**2 / impressions
    centre = p + z**2 / (2 * impressions)
    spread = z * math.sqrt((p * (1 - p) + z**2 / (4 * impressions)) / impressions)
    return (centre - spread) / denom


# ---------------------------------------------------------------------------
# CTR boost computation
# ---------------------------------------------------------------------------

def normalize_query(q: str) -> str:
    """Normalize query for CTR grouping."""
    return q.lower().strip()


def update_boosts(db: Session, site_id: int) -> int:
    """
    Recompute QueryUrlBoost for a site using SearchLog + SearchClick data.
    Returns the number of boost pairs updated.
    """
    since = datetime.utcnow() - timedelta(days=90)

    # Gather impression data from shown_urls
    logs = (
        db.query(SearchLog)
        .filter(
            SearchLog.site_id == site_id,
            SearchLog.created_at >= since,
            SearchLog.shown_urls != None,
        )
        .all()
    )

    # Count impressions per (query_normalized, url)
    impressions: dict[tuple[str, str], int] = {}
    for log in logs:
        q_norm = normalize_query(log.query)
        try:
            urls = json.loads(log.shown_urls)
        except (json.JSONDecodeError, TypeError):
            continue
        for url in urls:
            key = (q_norm, url)
            impressions[key] = impressions.get(key, 0) + 1

    # Count clicks per (query_normalized, url)
    click_rows = (
        db.query(
            func.lower(SearchLog.query).label("q"),
            SearchClick.clicked_url,
            func.count(SearchClick.id).label("cnt"),
        )
        .join(SearchLog, SearchClick.search_log_id == SearchLog.id)
        .filter(
            SearchClick.site_id == site_id,
            SearchLog.created_at >= since,
        )
        .group_by(func.lower(SearchLog.query), SearchClick.clicked_url)
        .all()
    )

    click_counts: dict[tuple[str, str], int] = {}
    for row in click_rows:
        key = (row[0], row[1])
        click_counts[key] = row[2]

    # Also count clicks from SearchLog.clicked_url for backward compat
    legacy_clicks = (
        db.query(
            func.lower(SearchLog.query).label("q"),
            SearchLog.clicked_url,
            func.count(SearchLog.id).label("cnt"),
        )
        .filter(
            SearchLog.site_id == site_id,
            SearchLog.created_at >= since,
            SearchLog.clicked_url != None,
        )
        .group_by(func.lower(SearchLog.query), SearchLog.clicked_url)
        .all()
    )
    for row in legacy_clicks:
        key = (row[0], row[1])
        click_counts[key] = max(click_counts.get(key, 0), row[2])

    # Upsert QueryUrlBoost
    all_keys = set(impressions.keys()) | set(click_counts.keys())
    updated = 0
    for q_norm, url in all_keys:
        imp = impressions.get((q_norm, url), 0)
        clk = click_counts.get((q_norm, url), 0)
        if imp == 0 and clk == 0:
            continue

        # If we have clicks but no impression data, estimate impressions
        if imp == 0 and clk > 0:
            imp = clk  # at minimum, each click was an impression

        ctr = clk / imp if imp > 0 else 0.0
        boost = wilson_lower(clk, imp)

        existing = (
            db.query(QueryUrlBoost)
            .filter(
                QueryUrlBoost.site_id == site_id,
                QueryUrlBoost.query_normalized == q_norm,
                QueryUrlBoost.url == url,
            )
            .first()
        )
        if existing:
            existing.impressions = imp
            existing.clicks = clk
            existing.ctr = ctr
            existing.boost_score = boost
            existing.updated_at = datetime.utcnow()
        else:
            db.add(QueryUrlBoost(
                site_id=site_id,
                query_normalized=q_norm,
                url=url,
                impressions=imp,
                clicks=clk,
                ctr=ctr,
                boost_score=boost,
            ))
        updated += 1

    db.commit()
    return updated


def get_boosts_for_query(db: Session, site_id: int, query: str) -> dict[str, float]:
    """Return {url: boost_score} for a normalized query."""
    q_norm = normalize_query(query)
    rows = (
        db.query(QueryUrlBoost.url, QueryUrlBoost.boost_score, QueryUrlBoost.clicks, QueryUrlBoost.ctr)
        .filter(
            QueryUrlBoost.site_id == site_id,
            QueryUrlBoost.query_normalized == q_norm,
            QueryUrlBoost.boost_score > 0,
        )
        .all()
    )
    return {r[0]: {"boost": r[1], "clicks": r[2], "ctr": r[3]} for r in rows}


# ---------------------------------------------------------------------------
# Synonym discovery
# ---------------------------------------------------------------------------

def discover_synonyms(db: Session, site_id: int, min_impressions: int = 5, min_ctr: float = 0.3) -> int:
    """
    Discover synonyms from click patterns.
    Two queries are synonyms if they both lead to clicks on the same URL
    with sufficient confidence.
    Returns the number of new synonym pairs created.
    """
    # Get all query-url pairs with enough data
    boosts = (
        db.query(QueryUrlBoost)
        .filter(
            QueryUrlBoost.site_id == site_id,
            QueryUrlBoost.impressions >= min_impressions,
            QueryUrlBoost.ctr >= min_ctr,
        )
        .all()
    )

    # Group by URL: which queries lead to clicks on this URL?
    url_queries: dict[str, list[str]] = {}
    for b in boosts:
        url_queries.setdefault(b.url, []).append(b.query_normalized)

    created = 0
    for url, queries in url_queries.items():
        if len(queries) < 2:
            continue
        # Create synonym pairs for all combinations
        for i, q1 in enumerate(queries):
            for q2 in queries[i + 1:]:
                if q1 == q2:
                    continue
                # Check if synonym already exists
                existing = (
                    db.query(LearnedSynonym)
                    .filter(
                        LearnedSynonym.site_id == site_id,
                        ((LearnedSynonym.query_term == q1) & (LearnedSynonym.synonym_term == q2))
                        | ((LearnedSynonym.query_term == q2) & (LearnedSynonym.synonym_term == q1)),
                    )
                    .first()
                )
                if not existing:
                    db.add(LearnedSynonym(
                        site_id=site_id,
                        query_term=q1,
                        synonym_term=q2,
                        confidence=0.5,
                        source="click_pattern",
                    ))
                    created += 1

    db.commit()
    return created


def get_synonyms(db: Session, site_id: int, query: str) -> list[str]:
    """Return synonym terms for a query."""
    q_norm = normalize_query(query)
    rows = (
        db.query(LearnedSynonym)
        .filter(
            LearnedSynonym.site_id == site_id,
            (LearnedSynonym.query_term == q_norm) | (LearnedSynonym.synonym_term == q_norm),
        )
        .all()
    )
    synonyms = []
    for r in rows:
        if r.query_term == q_norm:
            synonyms.append(r.synonym_term)
        else:
            synonyms.append(r.query_term)
    return synonyms


# ---------------------------------------------------------------------------
# Contact config
# ---------------------------------------------------------------------------

def get_contact_config(db: Session, site_id: int) -> dict | None:
    """Return contact CTA config for a site, or None if not configured."""
    config = (
        db.query(SiteContactConfig)
        .filter(SiteContactConfig.site_id == site_id)
        .first()
    )
    if not config:
        return None
    return {
        "site_id": config.site_id,
        "enabled": config.enabled,
        "email": config.email,
        "phone": config.phone,
        "chat_url": config.chat_url,
        "cta_text_fi": config.cta_text_fi,
        "cta_text_en": config.cta_text_en,
    }


def upsert_contact_config(db: Session, site_id: int, data: dict) -> dict:
    """Create or update contact CTA config."""
    config = (
        db.query(SiteContactConfig)
        .filter(SiteContactConfig.site_id == site_id)
        .first()
    )
    if not config:
        config = SiteContactConfig(site_id=site_id)
        db.add(config)

    for key in ("enabled", "email", "phone", "chat_url", "cta_text_fi", "cta_text_en"):
        if key in data:
            setattr(config, key, data[key])

    db.commit()
    db.refresh(config)
    return get_contact_config(db, site_id)


# ---------------------------------------------------------------------------
# Learning stats (for dashboard)
# ---------------------------------------------------------------------------

def get_learning_stats(db: Session, site_id: int) -> dict:
    """Return learning system statistics."""
    boost_count = (
        db.query(func.count(QueryUrlBoost.id))
        .filter(QueryUrlBoost.site_id == site_id)
        .scalar() or 0
    )
    synonym_count = (
        db.query(func.count(LearnedSynonym.id))
        .filter(LearnedSynonym.site_id == site_id)
        .scalar() or 0
    )

    top_boosted = (
        db.query(QueryUrlBoost.url, QueryUrlBoost.query_normalized,
                 QueryUrlBoost.clicks, QueryUrlBoost.ctr, QueryUrlBoost.boost_score)
        .filter(QueryUrlBoost.site_id == site_id)
        .order_by(desc(QueryUrlBoost.boost_score))
        .limit(10)
        .all()
    )

    # Click position distribution
    position_clicks = (
        db.query(SearchClick.click_position, func.count(SearchClick.id).label("cnt"))
        .filter(SearchClick.site_id == site_id)
        .group_by(SearchClick.click_position)
        .order_by(SearchClick.click_position)
        .all()
    )

    return {
        "site_id": site_id,
        "boost_pairs": boost_count,
        "synonym_count": synonym_count,
        "top_boosted": [
            {"url": r[0], "query": r[1], "clicks": r[2], "ctr": round(r[3], 3), "boost": round(r[4], 3)}
            for r in top_boosted
        ],
        "position_clicks": [
            {"position": r[0], "clicks": r[1]}
            for r in position_clicks
        ],
    }
