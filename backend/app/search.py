"""
Search engine: TF-IDF retrieval + Claude re-ranking and response generation.

Pipeline:
  1. TF-IDF candidate retrieval (top-20 pages)
  2. Claude prompt: understand user problem, re-rank candidates, write snippets
  3. Return top-N results with AI-generated reasoning
"""

import json
import logging
import re
import time
from typing import Optional

import anthropic
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy.orm import Session

from app.models import Page, SearchResult, SearchResponse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Language detection (simple heuristic - no extra deps needed)
# ---------------------------------------------------------------------------

FINNISH_WORDS = {
    # Question words & connectors
    "mitä", "mikä", "kuinka", "miten", "missä", "milloin", "miksi", "kuka",
    "onko", "voiko", "pitää", "täytyy", "pitäisi", "kannattaa",
    "halusin", "haluaisin", "tarvitsen", "tarvitsee", "tarvitsisin",
    "olen", "olet", "hän", "he", "me", "te", "jos", "kun", "koska",
    "että", "mutta", "tai", "ja", "ei", "en", "emme", "eikä",
    # Common Finnish nouns & verbs (e-commerce / service contexts)
    "sähkökatko", "lasku", "sopimus", "asiakas", "palvelu", "tuote",
    "toimitus", "tilaus", "hinta", "maksu", "tuki", "ohje",
    "televisio", "puhelin", "tietokone", "kannettava", "tabletti",
    "takuu", "palautus", "reklamaatio", "viallinen", "rikki", "hajosi",
    "ostaa", "ostaminen", "tilata", "toimittaa", "maksaa", "palauttaa",
    "halpa", "edullinen", "kallis", "paras", "uusi", "käytetty",
    "opiskelijalle", "kotiin", "nopea", "ilmainen", "saatavilla",
    "yhteystiedot", "asiakaspalvelu", "yhteys", "soittaa", "sähköposti",
    "kauppa", "verkkokauppa", "myymälä", "tuotteet", "valikoima",
}


def detect_language(text: str) -> str:
    """Return 'fi' if text looks Finnish, else 'en'."""
    words = set(re.findall(r"\b\w+\b", text.lower()))
    finnish_matches = len(words & FINNISH_WORDS)
    # Also check for Finnish-specific characters
    has_fi_chars = bool(re.search(r"[äöåÄÖÅ]", text))
    if finnish_matches >= 1 or has_fi_chars:
        return "fi"
    return "en"


# ---------------------------------------------------------------------------
# TF-IDF retrieval
# ---------------------------------------------------------------------------

def _build_corpus(pages: list[Page]) -> tuple[list[str], list[int]]:
    texts = []
    ids = []
    for page in pages:
        text = page.searchable_text()
        if text.strip():
            texts.append(text)
            ids.append(page.id)
    return texts, ids


def retrieve_candidates(
    query: str,
    pages: list[Page],
    top_k: int = 20,
) -> list[tuple[Page, float]]:
    """Return (page, tfidf_score) tuples sorted by relevance."""
    if not pages:
        return []

    texts, ids = _build_corpus(pages)
    if not texts:
        return []

    try:
        vectorizer = TfidfVectorizer(
            analyzer="word",
            ngram_range=(1, 2),
            max_features=50_000,
            sublinear_tf=True,
            min_df=1,
        )
        tfidf_matrix = vectorizer.fit_transform(texts)
        query_vec = vectorizer.transform([query])
        scores = cosine_similarity(query_vec, tfidf_matrix)[0]
    except Exception as exc:
        logger.warning("TF-IDF failed: %s", exc)
        return []

    # Map back to Page objects
    page_map = {p.id: p for p in pages}
    ranked = sorted(
        [(page_map[ids[i]], float(scores[i])) for i in range(len(ids))],
        key=lambda x: x[1],
        reverse=True,
    )
    # Return pages with non-zero score, up to top_k
    return [(p, s) for p, s in ranked if s > 0][:top_k]


# ---------------------------------------------------------------------------
# Claude re-ranking + response generation
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are FindAI, an intelligent search assistant that helps users find the most relevant pages on a website.

Your job is to:
1. Understand the user's UNDERLYING PROBLEM or intent (not just match keywords)
2. Identify which pages will actually help solve their problem
3. Explain clearly WHY each page is relevant
4. Detect and respond in the same language as the user's query

You think like a helpful expert who knows the site deeply, not like a keyword matcher."""

RANKING_PROMPT_TEMPLATE = """A user searched on a website with the following query:

USER QUERY: "{query}"

Here are candidate pages from the website (in no particular order):

{candidates_text}

---

Your task:
1. Understand what problem or need the user is expressing
2. Rank the pages from most to least relevant to solving their actual problem
3. For each relevant page, write a brief snippet explaining how it helps
4. Skip pages that are clearly irrelevant
5. If NO pages are truly helpful, say so honestly

Respond in {language_instruction}.

Return ONLY valid JSON in this exact format (no markdown, no explanation outside JSON):
{{
  "detected_intent": "Brief description of what the user actually needs",
  "language": "{language}",
  "results": [
    {{
      "page_id": <integer>,
      "url": "<url>",
      "title": "<title>",
      "score": <float 0.0-1.0>,
      "snippet": "<1-2 sentence explanation of how this page helps the user>",
      "reasoning": "<why this page is relevant to the user's specific problem>"
    }}
  ],
  "has_good_results": <true|false>,
  "fallback_message": "<null or a helpful message if no good results found>"
}}

Return at most {max_results} results. Only include pages that are genuinely helpful."""


def _format_candidates(candidates: list[tuple[Page, float]]) -> str:
    parts = []
    for page, score in candidates:
        headings = page.headings_list()[:5]
        headings_str = " | ".join(headings) if headings else ""
        snippet = (page.content or "")[:400]
        parts.append(
            f"[PAGE_ID: {page.id}]\n"
            f"URL: {page.url}\n"
            f"Title: {page.title}\n"
            f"Description: {page.meta_description}\n"
            f"Headings: {headings_str}\n"
            f"Content snippet: {snippet}\n"
        )
    return "\n---\n".join(parts)


def ai_rerank(
    query: str,
    candidates: list[tuple[Page, float]],
    language: str,
    max_results: int,
    client: anthropic.Anthropic,
) -> dict:
    """Call Claude to re-rank candidates and generate snippets."""
    if not candidates:
        return {
            "detected_intent": query,
            "language": language,
            "results": [],
            "has_good_results": False,
            "fallback_message": "No relevant pages found for your search.",
        }

    language_instruction = (
        "Finnish (respond in Finnish)" if language == "fi"
        else "English (respond in English)"
    )

    candidates_text = _format_candidates(candidates)

    prompt = RANKING_PROMPT_TEMPLATE.format(
        query=query,
        candidates_text=candidates_text,
        language_instruction=language_instruction,
        language=language,
        max_results=max_results,
    )

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)

    return json.loads(raw)


# ---------------------------------------------------------------------------
# Public search function
# ---------------------------------------------------------------------------

def run_search(
    query: str,
    pages: list[Page],
    max_results: int,
    anthropic_client: anthropic.Anthropic,
) -> tuple[SearchResponse, bool]:
    """
    Execute full search pipeline. Returns (SearchResponse, had_good_results).
    """
    start = time.time()
    language = detect_language(query)

    # Step 1: TF-IDF candidate retrieval
    candidates = retrieve_candidates(query, pages, top_k=20)

    # If TF-IDF finds nothing (e.g. cross-language query), send top pages
    # to Claude anyway — it can bridge language gaps and understand intent
    if not candidates and pages:
        sample = pages[:15]  # send up to 15 pages for Claude to evaluate
        candidates = [(p, 0.0) for p in sample]

    # Step 2: Claude re-ranking
    ai_response = ai_rerank(
        query=query,
        candidates=candidates,
        language=language,
        max_results=max_results,
        client=anthropic_client,
    )

    # Step 3: Build response
    results = []
    for r in ai_response.get("results", []):
        results.append(SearchResult(
            url=r.get("url", ""),
            title=r.get("title", ""),
            snippet=r.get("snippet", ""),
            score=float(r.get("score", 0.0)),
            reasoning=r.get("reasoning", ""),
        ))

    response_ms = int((time.time() - start) * 1000)
    had_good_results = ai_response.get("has_good_results", len(results) > 0)

    fallback = None
    if not had_good_results:
        if language == "fi":
            fallback = ai_response.get(
                "fallback_message",
                "Hakusi ei tuottanut tarkkoja tuloksia. Kokeile eri hakusanoja tai ota yhteyttä asiakaspalveluun."
            )
        else:
            fallback = ai_response.get(
                "fallback_message",
                "Your search didn't return precise results. Try different keywords or contact support."
            )

    return SearchResponse(
        query=query,
        language=language,
        results=results,
        fallback_message=fallback,
        response_ms=response_ms,
    ), had_good_results
