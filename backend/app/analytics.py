"""
Analytics aggregation for the admin dashboard.
"""

from datetime import datetime, timedelta
from collections import Counter

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models import SearchLog, Page, StatsResponse


def get_site_stats(db: Session, site_id: int) -> StatsResponse:
    """Aggregate search stats for a site."""
    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)

    total_searches = (
        db.query(func.count(SearchLog.id))
        .filter(SearchLog.site_id == site_id)
        .scalar() or 0
    )

    searches_last_7d = (
        db.query(func.count(SearchLog.id))
        .filter(SearchLog.site_id == site_id, SearchLog.created_at >= week_ago)
        .scalar() or 0
    )

    avg_results = (
        db.query(func.avg(SearchLog.result_count))
        .filter(SearchLog.site_id == site_id)
        .scalar() or 0.0
    )

    # CTR: fraction of searches where the user clicked something
    searches_with_click = (
        db.query(func.count(SearchLog.id))
        .filter(
            SearchLog.site_id == site_id,
            SearchLog.clicked_url.isnot(None),
        )
        .scalar() or 0
    )

    ctr = (searches_with_click / total_searches) if total_searches > 0 else 0.0

    # Top queries (last 30 days)
    thirty_ago = now - timedelta(days=30)
    recent_logs = (
        db.query(SearchLog.query)
        .filter(SearchLog.site_id == site_id, SearchLog.created_at >= thirty_ago)
        .all()
    )
    query_counts = Counter(r.query for r in recent_logs)
    top_queries = [
        {"query": q, "count": c}
        for q, c in query_counts.most_common(20)
    ]

    # Failed searches: had_good_results=False or no click, last 30 days
    failed_logs = (
        db.query(SearchLog.query, func.count(SearchLog.id).label("count"))
        .filter(
            SearchLog.site_id == site_id,
            SearchLog.created_at >= thirty_ago,
            SearchLog.had_good_results == False,  # noqa: E712
        )
        .group_by(SearchLog.query)
        .order_by(func.count(SearchLog.id).desc())
        .limit(20)
        .all()
    )
    failed_searches = [{"query": r.query, "count": r.count} for r in failed_logs]

    pages_indexed = (
        db.query(func.count(Page.id))
        .filter(Page.site_id == site_id)
        .scalar() or 0
    )

    return StatsResponse(
        site_id=site_id,
        total_searches=total_searches,
        searches_last_7d=searches_last_7d,
        avg_results_per_search=round(float(avg_results), 2),
        click_through_rate=round(ctr, 4),
        top_queries=top_queries,
        failed_searches=failed_searches,
        pages_indexed=pages_indexed,
    )
