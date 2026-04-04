"""
Sitemap-based web crawler and content indexer.

Strategy:
  1. Fetch sitemap.xml (handles sitemap index files recursively)
  2. For each URL: fetch HTML, extract title / meta / headings / body text
  3. Chunk large pages so context fits Claude's window
  4. Store or update Page records in the database
"""

import asyncio
import hashlib
import json
import logging
import re
import time
from datetime import datetime
from typing import Generator
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree as ET

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from app.models import CrawlJob, Page, Site

logger = logging.getLogger(__name__)

# Content we don't want to index
SKIP_EXTENSIONS = {
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
    ".mp4", ".mp3", ".zip", ".tar", ".gz", ".exe", ".dmg",
    ".css", ".js", ".ico", ".woff", ".woff2", ".ttf",
}

MAX_CONTENT_CHARS = 8_000   # per page chunk stored in DB
MAX_PAGES_DEFAULT = 500
REQUEST_TIMEOUT = 15
DELAY_BETWEEN_REQUESTS = 1.0


# ---------------------------------------------------------------------------
# Sitemap parsing
# ---------------------------------------------------------------------------

def _fetch_xml(client: httpx.Client, url: str) -> ET.Element | None:
    try:
        r = client.get(url, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        return ET.fromstring(r.content)
    except Exception as exc:
        logger.warning("Failed to fetch XML from %s: %s", url, exc)
        return None


def _strip_ns(tag: str) -> str:
    """Remove XML namespace prefix from tag name."""
    return tag.split("}")[-1] if "}" in tag else tag


def extract_urls_from_sitemap(client: httpx.Client, sitemap_url: str, max_pages: int) -> list[str]:
    """
    Recursively parse sitemap / sitemap index and return a flat list of page URLs.
    Handles both <sitemapindex> and <urlset> formats.
    """
    urls: list[str] = []
    to_visit = [sitemap_url]
    visited_sitemaps: set[str] = set()

    while to_visit and len(urls) < max_pages:
        url = to_visit.pop(0)
        if url in visited_sitemaps:
            continue
        visited_sitemaps.add(url)

        root = _fetch_xml(client, url)
        if root is None:
            continue

        tag = _strip_ns(root.tag)

        if tag == "sitemapindex":
            for sitemap_el in root:
                loc_el = next(
                    (c for c in sitemap_el if _strip_ns(c.tag) == "loc"), None
                )
                if loc_el is not None and loc_el.text:
                    to_visit.append(loc_el.text.strip())

        elif tag == "urlset":
            for url_el in root:
                loc_el = next(
                    (c for c in url_el if _strip_ns(c.tag) == "loc"), None
                )
                if loc_el is not None and loc_el.text:
                    page_url = loc_el.text.strip()
                    ext = "." + page_url.split(".")[-1].lower() if "." in page_url.split("/")[-1] else ""
                    if ext not in SKIP_EXTENSIONS:
                        urls.append(page_url)
                        if len(urls) >= max_pages:
                            break

    return urls[:max_pages]


# ---------------------------------------------------------------------------
# HTML content extraction
# ---------------------------------------------------------------------------

def _clean_text(text: str) -> str:
    """Collapse whitespace and remove junk characters."""
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_page_content(html: str, url: str) -> dict:
    """
    Parse HTML and return structured content dict.
    Returns: {title, meta_description, headings, content, word_count}
    """
    soup = BeautifulSoup(html, "lxml")

    # Remove script / style / nav / footer noise
    for tag in soup(["script", "style", "nav", "footer", "header",
                     "aside", "noscript", "iframe", "form"]):
        tag.decompose()

    # Title
    title = ""
    if soup.title and soup.title.string:
        title = _clean_text(soup.title.string)

    # Meta description
    meta_desc = ""
    for meta in soup.find_all("meta"):
        if meta.get("name", "").lower() == "description":
            meta_desc = _clean_text(meta.get("content", ""))
            break
        if meta.get("property", "").lower() == "og:description":
            meta_desc = _clean_text(meta.get("content", ""))

    # Headings (h1-h3)
    headings = []
    for h in soup.find_all(["h1", "h2", "h3"]):
        text = _clean_text(h.get_text())
        if text:
            headings.append(text)

    # Main body text — prefer <main> or <article>, else body
    main_el = soup.find("main") or soup.find("article") or soup.body
    body_text = _clean_text(main_el.get_text(separator=" ")) if main_el else ""

    # Truncate to keep things manageable
    content = body_text[:MAX_CONTENT_CHARS]
    word_count = len(body_text.split())

    # Schema.org JSON-LD extraction
    schema_data = None
    for script_tag in soup.find_all("script", type="application/ld+json"):
        try:
            ld_json = json.loads(script_tag.string or "")
            # Handle both single objects and arrays
            items = ld_json if isinstance(ld_json, list) else [ld_json]
            for item in items:
                schema_type = item.get("@type", "")
                if schema_type in ("Product", "Article", "FAQPage", "Event",
                                    "LocalBusiness", "Organization", "Recipe",
                                    "HowTo", "Service", "SoftwareApplication",
                                    "Course", "JobPosting", "Review"):
                    schema_data = {
                        "type": schema_type,
                        "name": item.get("name", ""),
                        "description": item.get("description", ""),
                    }
                    # Product-specific fields
                    if schema_type == "Product":
                        offers = item.get("offers", {})
                        if isinstance(offers, list):
                            offers = offers[0] if offers else {}
                        schema_data["price"] = offers.get("price")
                        schema_data["currency"] = offers.get("priceCurrency")
                        schema_data["availability"] = offers.get("availability", "").split("/")[-1]
                        schema_data["image"] = item.get("image", [""])[0] if isinstance(item.get("image"), list) else item.get("image", "")
                        rating = item.get("aggregateRating", {})
                        if rating:
                            schema_data["rating"] = rating.get("ratingValue")
                            schema_data["reviewCount"] = rating.get("reviewCount")
                    # Article-specific
                    elif schema_type == "Article":
                        schema_data["datePublished"] = item.get("datePublished")
                        schema_data["author"] = item.get("author", {}).get("name") if isinstance(item.get("author"), dict) else item.get("author")
                        schema_data["image"] = item.get("image", [""])[0] if isinstance(item.get("image"), list) else item.get("image", "")
                    # FAQ-specific
                    elif schema_type == "FAQPage":
                        faq_items = item.get("mainEntity", [])[:5]
                        schema_data["questions"] = [
                            {"q": q.get("name", ""), "a": q.get("acceptedAnswer", {}).get("text", "")[:200]}
                            for q in faq_items
                        ]
                    # Event-specific
                    elif schema_type == "Event":
                        schema_data["startDate"] = item.get("startDate")
                        schema_data["location"] = item.get("location", {}).get("name") if isinstance(item.get("location"), dict) else item.get("location")
                    break
        except (json.JSONDecodeError, TypeError, AttributeError):
            continue

    return {
        "title": title,
        "meta_description": meta_desc,
        "headings": headings,
        "content": content,
        "word_count": word_count,
        "schema_data": schema_data,
    }


def _content_hash(data: dict) -> str:
    blob = json.dumps(data, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Main crawl function
# ---------------------------------------------------------------------------

def crawl_site(
    db: Session,
    site: Site,
    sitemap_url: str | None = None,
    max_pages: int = MAX_PAGES_DEFAULT,
    job_id: int | None = None,
) -> dict:
    """
    Crawl a site and upsert Page records.
    Returns summary dict: {pages_found, pages_indexed, errors}.
    """
    sitemap = sitemap_url or site.sitemap_url
    if not sitemap:
        # Try the conventional location
        sitemap = urljoin(f"https://{site.domain}", "/sitemap.xml")

    headers = {
        "User-Agent": "FindAI-Crawler/1.0 (+https://findai.app/bot)",
        "Accept-Language": "fi,en;q=0.9",
    }

    def _update_job(**kwargs):
        if job_id:
            job = db.get(CrawlJob, job_id)
            if job:
                for k, v in kwargs.items():
                    setattr(job, k, v)
                db.commit()

    _update_job(status="running", started_at=datetime.utcnow())

    pages_found = 0
    pages_indexed = 0
    errors = []

    with httpx.Client(headers=headers, follow_redirects=True, timeout=REQUEST_TIMEOUT) as client:
        logger.info("Fetching sitemap: %s", sitemap)
        urls = extract_urls_from_sitemap(client, sitemap, max_pages)
        pages_found = len(urls)
        logger.info("Found %d URLs to crawl", pages_found)

        _update_job(pages_found=pages_found)

        for i, url in enumerate(urls):
            try:
                time.sleep(DELAY_BETWEEN_REQUESTS)
                response = client.get(url, timeout=REQUEST_TIMEOUT)
                if response.status_code != 200:
                    continue

                content_type = response.headers.get("content-type", "")
                if "text/html" not in content_type:
                    continue

                data = extract_page_content(response.text, url)
                chash = _content_hash(data)

                # Upsert
                page = db.query(Page).filter_by(site_id=site.id, url=url).first()
                schema_json = json.dumps(data["schema_data"], ensure_ascii=False) if data.get("schema_data") else None

                if page:
                    if page.content_hash == chash:
                        continue   # unchanged
                    page.title = data["title"]
                    page.meta_description = data["meta_description"]
                    page.headings = json.dumps(data["headings"], ensure_ascii=False)
                    page.content = data["content"]
                    page.content_hash = chash
                    page.word_count = data["word_count"]
                    page.schema_data = schema_json
                    page.indexed_at = datetime.utcnow()
                else:
                    page = Page(
                        site_id=site.id,
                        url=url,
                        title=data["title"],
                        meta_description=data["meta_description"],
                        headings=json.dumps(data["headings"], ensure_ascii=False),
                        content=data["content"],
                        content_hash=chash,
                        word_count=data["word_count"],
                        schema_data=schema_json,
                    )
                    db.add(page)

                db.commit()
                pages_indexed += 1

                if i % 10 == 0:
                    _update_job(pages_indexed=pages_indexed)
                    logger.info("Progress: %d/%d indexed", pages_indexed, pages_found)

            except Exception as exc:
                logger.warning("Error crawling %s: %s", url, exc)
                errors.append(str(exc))

    site.last_crawled_at = datetime.utcnow()
    db.commit()

    _update_job(
        status="done" if not errors else "done_with_errors",
        pages_indexed=pages_indexed,
        finished_at=datetime.utcnow(),
    )

    return {
        "pages_found": pages_found,
        "pages_indexed": pages_indexed,
        "errors": errors[:10],   # keep first 10 errors
    }
