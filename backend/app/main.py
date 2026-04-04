"""
FindAI - FastAPI backend
"""

import logging
import os
import secrets
import threading
from datetime import datetime

import anthropic
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.analytics import get_site_stats
from app.crawler import crawl_site
from app.database import get_db, init_db
from app.models import (
    ClickTrackRequest,
    ContactConfigRequest,
    CrawlJob,
    CrawlRequest,
    Page,
    SearchClick,
    SearchLog,
    SearchRequest,
    Site,
    SiteCreate,
    SiteResponse,
    StatsResponse,
)
from app.search import run_search
from app.learning import (
    get_trending,
    get_suggestions,
    get_contact_config,
    upsert_contact_config,
    get_learning_stats,
    update_boosts,
    discover_synonyms,
    get_boosts_for_query,
    get_synonyms,
)

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173"
).split(",")

app = FastAPI(
    title="FindAI API",
    description="AI-powered site search backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Widget is embedded on arbitrary sites - allow all
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialise DB on startup
@app.on_event("startup")
def startup():
    init_db()
    logger.info("FindAI API started - DB initialised")


# Lazy Anthropic client
_anthropic_client: anthropic.Anthropic | None = None


def get_anthropic() -> anthropic.Anthropic:
    global _anthropic_client
    if _anthropic_client is None:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=503,
                detail="ANTHROPIC_API_KEY is not configured on the server",
            )
        _anthropic_client = anthropic.Anthropic(api_key=api_key)
    return _anthropic_client


# ---------------------------------------------------------------------------
# Rate limiting (simple in-memory per site_id)
# ---------------------------------------------------------------------------

from collections import defaultdict, deque
import time as _time

_rate_windows: dict[int, deque] = defaultdict(deque)
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))


def check_rate_limit(site_id: int):
    now = _time.time()
    window = _rate_windows[site_id]
    # Purge old entries
    while window and window[0] < now - 60:
        window.popleft()
    if len(window) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again in a minute.")
    window.append(now)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"service": "FindAI API", "status": "ok", "version": "0.1.0"}


@app.get("/health")
def health():
    return {"status": "ok"}


# --- Sites ---

@app.post("/api/sites", response_model=SiteResponse)
def create_site(payload: SiteCreate, db: Session = Depends(get_db)):
    existing = db.query(Site).filter_by(domain=payload.domain).first()
    if existing:
        raise HTTPException(status_code=409, detail="Site with this domain already exists")

    api_key = secrets.token_urlsafe(32)
    site = Site(
        name=payload.name,
        domain=payload.domain,
        sitemap_url=payload.sitemap_url,
        api_key=api_key,
    )
    db.add(site)
    db.commit()
    db.refresh(site)

    page_count = db.query(Page).filter_by(site_id=site.id).count()
    result = SiteResponse.model_validate(site)
    result.page_count = page_count
    return result


@app.get("/api/sites", response_model=list[SiteResponse])
def list_sites(db: Session = Depends(get_db)):
    sites = db.query(Site).filter_by(is_active=True).all()
    results = []
    for site in sites:
        page_count = db.query(Page).filter_by(site_id=site.id).count()
        r = SiteResponse.model_validate(site)
        r.page_count = page_count
        results.append(r)
    return results


@app.get("/api/sites/{site_id}", response_model=SiteResponse)
def get_site(site_id: int, db: Session = Depends(get_db)):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    page_count = db.query(Page).filter_by(site_id=site.id).count()
    r = SiteResponse.model_validate(site)
    r.page_count = page_count
    return r


# --- Crawl ---

@app.post("/api/crawl")
def trigger_crawl(payload: CrawlRequest, db: Session = Depends(get_db)):
    site = db.get(Site, payload.site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    job = CrawlJob(site_id=site.id, status="pending")
    db.add(job)
    db.commit()
    db.refresh(job)

    def _run():
        # Each thread needs its own DB session
        from app.database import SessionLocal
        thread_db = SessionLocal()
        try:
            thread_site = thread_db.get(Site, payload.site_id)
            crawl_site(
                db=thread_db,
                site=thread_site,
                sitemap_url=payload.sitemap_url,
                job_id=job.id,
            )
        except Exception as exc:
            logger.error("Crawl job %d failed: %s", job.id, exc)
            thread_job = thread_db.get(CrawlJob, job.id)
            if thread_job:
                thread_job.status = "failed"
                thread_job.error = str(exc)
                thread_job.finished_at = datetime.utcnow()
                thread_db.commit()
        finally:
            thread_db.close()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {"job_id": job.id, "status": "started", "site_id": site.id}


@app.get("/api/crawl/{job_id}")
def get_crawl_status(job_id: int, db: Session = Depends(get_db)):
    job = db.get(CrawlJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job.id,
        "site_id": job.site_id,
        "status": job.status,
        "pages_found": job.pages_found,
        "pages_indexed": job.pages_indexed,
        "error": job.error,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


# --- Search ---

@app.post("/api/search")
def search(payload: SearchRequest, db: Session = Depends(get_db)):
    check_rate_limit(payload.site_id)

    site = db.get(Site, payload.site_id)
    if not site or not site.is_active:
        raise HTTPException(status_code=404, detail="Site not found")

    pages = db.query(Page).filter_by(site_id=site.id).all()
    if not pages:
        return {
            "query": payload.query,
            "language": "en",
            "results": [],
            "fallback_message": "This site hasn't been indexed yet. Please trigger a crawl first.",
            "response_ms": 0,
        }

    claude = get_anthropic()

    # Get CTR boosts and synonyms for this query
    boosts = get_boosts_for_query(db, site.id, payload.query)
    synonyms = get_synonyms(db, site.id, payload.query)

    response, had_good_results = run_search(
        query=payload.query,
        pages=pages,
        max_results=payload.max_results,
        anthropic_client=claude,
        boosts=boosts,
        synonyms=synonyms,
    )

    # Store shown URLs for CTR learning
    import json as _json
    shown_urls = _json.dumps([r.url for r in response.results])

    # Log search
    log = SearchLog(
        site_id=site.id,
        query=payload.query,
        language=response.language,
        result_count=len(response.results),
        had_good_results=had_good_results,
        response_ms=response.response_ms,
        shown_urls=shown_urls,
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    # Get contact config for zero-result fallback
    contact = get_contact_config(db, site.id) if not response.results else None

    return {
        **response.model_dump(),
        "search_log_id": log.id,
        "contact_config": contact,
    }


@app.post("/api/search/click")
def track_click(payload: ClickTrackRequest, db: Session = Depends(get_db)):
    log = db.get(SearchLog, payload.search_log_id)
    if log:
        log.clicked_url = payload.clicked_url
        log.click_position = payload.click_position
        if payload.session_id:
            log.session_id = payload.session_id
        db.commit()

        # Also record in SearchClick for multi-click tracking
        click = SearchClick(
            search_log_id=log.id,
            site_id=log.site_id,
            clicked_url=payload.clicked_url,
            click_position=payload.click_position,
        )
        db.add(click)
        db.commit()

        # Incremental CTR boost update (fire-and-forget in same thread)
        try:
            update_boosts(db, log.site_id)
        except Exception:
            pass  # Non-critical

    return {"ok": True}


# --- Trending & Suggestions ---

@app.get("/api/sites/{site_id}/trending")
def site_trending(site_id: int, limit: int = 5, db: Session = Depends(get_db)):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    trending = get_trending(db, site_id, limit)
    return {"trending": trending}


@app.get("/api/sites/{site_id}/suggestions")
def site_suggestions(site_id: int, q: str = "", limit: int = 5, db: Session = Depends(get_db)):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    suggestions = get_suggestions(db, site_id, q, limit)
    return {"suggestions": suggestions}


# --- Contact Config ---

@app.get("/api/sites/{site_id}/contact-config")
def get_site_contact_config(site_id: int, db: Session = Depends(get_db)):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    config = get_contact_config(db, site_id)
    if not config:
        return {"site_id": site_id, "enabled": False, "email": None, "phone": None,
                "chat_url": None, "cta_text_fi": "Etkö löytänyt etsimääsi? Ota yhteyttä!",
                "cta_text_en": "Didn't find what you need? Contact us!"}
    return config


@app.put("/api/sites/{site_id}/contact-config")
def update_site_contact_config(site_id: int, payload: ContactConfigRequest, db: Session = Depends(get_db)):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    config = upsert_contact_config(db, site_id, payload.model_dump())
    return config


# --- Learning Stats ---

@app.get("/api/sites/{site_id}/learning-stats")
def site_learning_stats(site_id: int, db: Session = Depends(get_db)):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return get_learning_stats(db, site_id)


@app.post("/api/sites/{site_id}/discover-synonyms")
def trigger_synonym_discovery(site_id: int, db: Session = Depends(get_db)):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    count = discover_synonyms(db, site_id)
    return {"discovered": count}


# --- Analytics ---

@app.get("/api/sites/{site_id}/stats", response_model=StatsResponse)
def site_stats(site_id: int, db: Session = Depends(get_db)):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return get_site_stats(db, site_id)


# --- Widget serving ---

WIDGET_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "widget")

@app.get("/widget.js")
def serve_widget():
    widget_path = os.path.abspath(os.path.join(WIDGET_DIR, "widget.js"))
    if not os.path.exists(widget_path):
        raise HTTPException(status_code=404, detail="Widget not found")
    return FileResponse(
        widget_path,
        media_type="application/javascript",
        headers={"Cache-Control": "public, max-age=300"},
    )


# --- Demo mode ---

@app.get("/api/demo/setup")
def demo_setup(db: Session = Depends(get_db)):
    """Create a demo site with sample data for testing."""
    existing = db.query(Site).filter_by(domain="demo.findai.app").first()
    if existing:
        page_count = db.query(Page).filter_by(site_id=existing.id).count()
        r = SiteResponse.model_validate(existing)
        r.page_count = page_count
        return {"message": "Demo already exists", "site": r}

    site = Site(
        name="FindAI Demo",
        domain="demo.findai.app",
        sitemap_url="https://demo.findai.app/sitemap.xml",
        api_key=secrets.token_urlsafe(32),
    )
    db.add(site)
    db.commit()
    db.refresh(site)

    # Add sample Finnish pages
    sample_pages = [
        {
            "url": "https://demo.findai.app/tuotteet/aurinkopaneelit",
            "title": "Aurinkopaneelit kotiin – säästä sähkölaskussa",
            "meta_description": "Laadukkaita aurinkopaneeleja kotitalouksille. Asennuspalvelu koko Suomessa.",
            "headings": ["Aurinkopaneelit kotiin", "Miksi valita aurinkoenergia?", "Asennus ja huolto"],
            "content": "Aurinkopaneelit ovat erinomainen tapa vähentää sähkölaskua ja tuottaa omaa puhdasta energiaa. Tarjoamme täyden asennuspalvelun koko Suomessa. Paneelit soveltuvat sekä omakotitaloihin että rivitaloihin. Investointi maksaa itsensä takaisin tyypillisesti 7-10 vuodessa.",
        },
        {
            "url": "https://demo.findai.app/tuki/sähkökatkot",
            "title": "Sähkökatko – näin toimit",
            "meta_description": "Ohjeet sähkökatkon varalle. Ilmoita häiriöstä ja tarkista tilanteen kehittyminen.",
            "headings": ["Sähkökatko – mitä tehdä?", "Ilmoita häiriöstä", "Katkon kesto"],
            "content": "Jos sähkö on poikki, toimi näin: 1) Tarkista ensin oma sulakkeesi. 2) Jos naapureillakaan ei ole sähköä, kyseessä on verkkoyhtiön vika. 3) Ilmoita häiriöstä verkkoyhtiölle numeroon 0800 12345. 4) Seuraa tilanteen kehittymistä verkkosivuiltamme tai sovelluksestamme. Sähkökatkon keskimääräinen korjausaika on 2-4 tuntia.",
        },
        {
            "url": "https://demo.findai.app/sopimukset/kotitalous",
            "title": "Sähkösopimus kotitalouksille",
            "meta_description": "Edullinen ja joustava sähkösopimus. Vertaile tuotteita ja tee sopimus helposti verkossa.",
            "headings": ["Valitse sopimus", "Kiinteä vai pörssisähkö?", "Tee sopimus verkossa"],
            "content": "Tarjoamme kotitalouksille useita sähkösopimuksia. Kiinteähintainen sopimus antaa ennustettavuutta budjettiin. Pörssisähkösopimus voi säästää rahaa jos olet joustava sähkön käytössä. Solmi sopimus helposti verkossa – ei puhelinjonoja.",
        },
        {
            "url": "https://demo.findai.app/laskutus/lasku-kysymykset",
            "title": "Usein kysyttyä laskutuksesta",
            "meta_description": "Vastaukset yleisimpiin laskutuskysymyksiin: laskun eräpäivä, maksaminen, erissä maksaminen.",
            "headings": ["Milloin lasku erääntyy?", "Maksaminen", "Laskun tilaaminen"],
            "content": "Sähkölasku lähetetään kuukausittain tai neljännesvuosittain valintasi mukaan. Eräpäivä on 14 päivää laskutuspäivästä. Voit maksaa verkkopankissa, mobiilisovelluksessa tai e-laskuna. Jos lasku on virheellinen, ota yhteyttä asiakaspalveluun viikon sisällä.",
        },
        {
            "url": "https://demo.findai.app/asiakaspalvelu",
            "title": "Asiakaspalvelu – ota yhteyttä",
            "meta_description": "Tavoita asiakaspalvelumme puhelimitse, sähköpostilla tai chatissa.",
            "headings": ["Yhteystiedot", "Puhelinpalvelu", "Chat ja sähköposti"],
            "content": "Asiakaspalvelumme auttaa kaikissa sähkösopimukseen ja laskutukseen liittyvissä kysymyksissä. Puhelin: 0800 98765 (ma-pe 8-20). Sähköposti: asiakaspalvelu@demo.fi. Chat: saatavilla verkkosivuilla arkisin 8-18.",
        },
    ]

    for p in sample_pages:
        import json
        page = Page(
            site_id=site.id,
            url=p["url"],
            title=p["title"],
            meta_description=p["meta_description"],
            headings=json.dumps(p["headings"], ensure_ascii=False),
            content=p["content"],
            word_count=len(p["content"].split()),
        )
        db.add(page)
    db.commit()

    page_count = db.query(Page).filter_by(site_id=site.id).count()
    r = SiteResponse.model_validate(site)
    r.page_count = page_count
    return {
        "message": "Demo site created with sample Finnish content",
        "site": r,
    }
