"""
SQLAlchemy models and Pydantic schemas for FindAI.
"""

from datetime import datetime
from typing import Optional
import json

from sqlalchemy import (
    Column, Integer, String, Text, Float, DateTime,
    Boolean, ForeignKey, create_engine
)
from sqlalchemy.orm import relationship, DeclarativeBase, Session
from pydantic import BaseModel, HttpUrl


# ---------------------------------------------------------------------------
# SQLAlchemy ORM
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    pass


class Site(Base):
    __tablename__ = "sites"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    domain = Column(String(255), nullable=False, unique=True)
    sitemap_url = Column(String(512))
    api_key = Column(String(64), unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_crawled_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)

    pages = relationship("Page", back_populates="site", cascade="all, delete-orphan")
    searches = relationship("SearchLog", back_populates="site", cascade="all, delete-orphan")


class Page(Base):
    __tablename__ = "pages"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False)
    url = Column(String(1024), nullable=False)
    title = Column(String(512), default="")
    meta_description = Column(Text, default="")
    headings = Column(Text, default="")   # JSON list
    content = Column(Text, default="")    # chunked / cleaned text
    content_hash = Column(String(64), default="")
    word_count = Column(Integer, default=0)
    indexed_at = Column(DateTime, default=datetime.utcnow)

    site = relationship("Site", back_populates="pages")

    def headings_list(self) -> list[str]:
        try:
            return json.loads(self.headings or "[]")
        except Exception:
            return []

    def searchable_text(self) -> str:
        """Combined text used for TF-IDF vectorisation."""
        parts = [
            self.title or "",
            self.meta_description or "",
            " ".join(self.headings_list()),
            self.content or "",
        ]
        return " ".join(p for p in parts if p)


class SearchLog(Base):
    __tablename__ = "search_logs"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False)
    query = Column(String(1024), nullable=False)
    language = Column(String(10), default="en")
    result_count = Column(Integer, default=0)
    clicked_url = Column(String(1024), nullable=True)
    response_ms = Column(Integer, default=0)   # latency
    had_good_results = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    site = relationship("Site", back_populates="searches")


class CrawlJob(Base):
    __tablename__ = "crawl_jobs"

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False)
    status = Column(String(32), default="pending")  # pending|running|done|failed
    pages_found = Column(Integer, default=0)
    pages_indexed = Column(Integer, default=0)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Pydantic request / response schemas
# ---------------------------------------------------------------------------

class SiteCreate(BaseModel):
    name: str
    domain: str
    sitemap_url: Optional[str] = None


class SiteResponse(BaseModel):
    id: int
    name: str
    domain: str
    sitemap_url: Optional[str]
    api_key: str
    created_at: datetime
    last_crawled_at: Optional[datetime]
    is_active: bool
    page_count: int = 0

    model_config = {"from_attributes": True}


class SearchRequest(BaseModel):
    query: str
    site_id: int
    max_results: int = 5


class SearchResult(BaseModel):
    url: str
    title: str
    snippet: str       # AI-generated relevance explanation
    score: float       # 0-1 confidence
    reasoning: str     # why this page helps


class SearchResponse(BaseModel):
    query: str
    language: str
    results: list[SearchResult]
    fallback_message: Optional[str] = None
    response_ms: int


class ClickTrackRequest(BaseModel):
    search_log_id: int
    clicked_url: str


class CrawlRequest(BaseModel):
    site_id: int
    sitemap_url: Optional[str] = None   # override stored URL


class StatsResponse(BaseModel):
    site_id: int
    total_searches: int
    searches_last_7d: int
    avg_results_per_search: float
    click_through_rate: float
    top_queries: list[dict]
    failed_searches: list[dict]   # queries with no clicks
    pages_indexed: int
