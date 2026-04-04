import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  api,
  Site,
  SearchResponse,
  SearchResult,
  TrendingItem,
  ContactConfig,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  ArrowLeft,
  Loader2,
  ArrowUpRight,
  TrendingUp,
  Sparkles,
  Star,
  Calendar,
  MapPin,
  Mail,
  Phone,
  MessageCircle,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a clean display title — never show raw URLs */
function cleanTitle(title: string, url: string): string {
  // If it looks like a URL, derive a human name from the path
  if (!title || title.startsWith("http") || title.includes("://")) {
    try {
      const path = new URL(url).pathname.replace(/\/$/, "");
      const segment = path.split("/").pop() || "";
      const cleaned = segment
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
      return cleaned || new URL(url).hostname;
    } catch {
      return url;
    }
  }
  return title;
}

/** Extract short readable domain + path */
function shortDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url;
  }
}

function shortPath(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    if (!path || path === "/") return "";
    return decodeURIComponent(path)
      .replace(/^\//, "")
      .split("/")
      .map((seg) =>
        seg
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
      )
      .join(" > ");
  } catch {
    return "";
  }
}

/** Clean snippet — strip nav/header/footer cruft */
function cleanSnippet(snippet: string): string {
  if (!snippet) return "";
  // Remove common nav/footer patterns
  return snippet
    .replace(/Siirry sisältöön/gi, "")
    .replace(/Kirjaudu sisään/gi, "")
    .replace(/Luo tili/gi, "")
    .replace(/Unohditko salasanasi\??/gi, "")
    .replace(/Palauta salasana/gi, "")
    .replace(/Sähköposti\s+Salasana/gi, "")
    .replace(/Ota yhteyttä\s+Varaa huolto/gi, "")
    .replace(/Google\s*★+\s*-?\s*/g, "")
    .replace(/\|\s*\+?\d+\s*arvostelua/g, "")
    .replace(/\d{2,3}\s+\d{4}\s+\d{4}/g, "") // phone numbers
    .replace(/Uusi asiakas\?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Single result card — user-facing, no developer metrics
// ---------------------------------------------------------------------------

function ResultCard({
  result,
  index,
  onTrackClick,
}: {
  result: SearchResult;
  index: number;
  onTrackClick: (url: string, position: number) => void;
}) {
  const title = cleanTitle(result.title, result.url);
  const path = shortPath(result.url);
  const snippet = cleanSnippet(result.snippet);
  const s = result.schema_data;
  const isProduct = s?.type === "Product";
  const isArticle = s?.type === "Article";
  const isEvent = s?.type === "Event";
  const isFAQ = s?.type === "FAQPage";

  return (
    <button
      type="button"
      onClick={() => onTrackClick(result.url, index)}
      className="group flex w-full cursor-pointer items-stretch gap-0 overflow-hidden rounded-2xl border border-border/40 bg-card text-left transition-all duration-200 ease-out hover:border-primary/20 hover:shadow-lg hover:shadow-primary/[0.03] active:scale-[0.995]"
    >
      {/* Product card — horizontal layout with large image */}
      {isProduct ? (
        <div className="flex gap-0">
          {s.image && (
            <div className="hidden shrink-0 sm:block">
              <img
                src={s.image}
                alt={s.name || title}
                className="h-full w-32 rounded-l-xl border-r border-border/30 object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).parentElement!.style.display = "none";
                }}
              />
            </div>
          )}
          <div className="min-w-0 flex-1 p-4">
            {path && (
              <div className="mb-1 text-[11px] text-muted-foreground/60 truncate">{path}</div>
            )}
            <h3 className="text-[15px] font-semibold leading-snug text-foreground group-hover:text-primary">
              {title}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {s.price && (
                <span className="text-lg font-bold text-foreground">
                  {s.price}{s.currency === "EUR" ? " €" : ` ${s.currency || ""}`}
                </span>
              )}
              {s.rating && (
                <span className="flex items-center gap-1 text-sm">
                  <span className="flex">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={`h-3.5 w-3.5 ${
                          i < Math.round(Number(s.rating))
                            ? "fill-amber-400 text-amber-400"
                            : "fill-muted text-muted"
                        }`}
                      />
                    ))}
                  </span>
                  {s.reviewCount && (
                    <span className="text-xs text-muted-foreground">({s.reviewCount})</span>
                  )}
                </span>
              )}
              {s.availability && (
                <Badge
                  variant="secondary"
                  className={`text-[10px] ${
                    s.availability.includes("InStock")
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-orange-200 bg-orange-50 text-orange-700"
                  }`}
                >
                  {s.availability.includes("InStock") ? "✓ Varastossa" : "Ei varastossa"}
                </Badge>
              )}
            </div>
            {snippet && (
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground line-clamp-2">{snippet}</p>
            )}
          </div>
        </div>
      ) : (
        /* Standard / Article / Event / FAQ card */
        <div className="p-4">
          <div className="flex gap-4">
            {/* Article/Event image */}
            {(isArticle || isEvent) && s?.image && (
              <div className="hidden shrink-0 sm:block">
                <img
                  src={s.image}
                  alt=""
                  className="h-20 w-28 rounded-lg border border-border/30 object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).parentElement!.style.display = "none";
                  }}
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              {path && (
                <div className="mb-1 text-[11px] text-muted-foreground/60 truncate">{path}</div>
              )}

              {/* Type indicator */}
              {(isArticle || isEvent || isFAQ) && (
                <div className="mb-1 flex items-center gap-1.5">
                  {isArticle && (
                    <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
                      <Calendar className="h-2.5 w-2.5" />
                      Artikkeli
                    </Badge>
                  )}
                  {isEvent && (
                    <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
                      <Calendar className="h-2.5 w-2.5" />
                      Tapahtuma
                    </Badge>
                  )}
                  {isFAQ && (
                    <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
                      UKK
                    </Badge>
                  )}
                </div>
              )}

              <h3 className="text-[15px] font-semibold leading-snug text-foreground group-hover:text-primary">
                {title}
              </h3>

              {/* Article meta */}
              {isArticle && (s.author || s.datePublished) && (
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {s.author && <span>{s.author}</span>}
                  {s.author && s.datePublished && <span>·</span>}
                  {s.datePublished && (
                    <span>{new Date(s.datePublished).toLocaleDateString("fi-FI")}</span>
                  )}
                </div>
              )}

              {/* Event meta */}
              {isEvent && (
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {s.startDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(s.startDate).toLocaleDateString("fi-FI", {
                        weekday: "short",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  )}
                  {s.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {s.location}
                    </span>
                  )}
                </div>
              )}

              {/* Snippet */}
              {snippet && !isFAQ && (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-2">{snippet}</p>
              )}
            </div>

            {/* Arrow on hover */}
            <div className="hidden shrink-0 self-center sm:flex">
              <ArrowUpRight className="h-4 w-4 text-muted-foreground/0 transition-all duration-200 group-hover:text-primary/40" />
            </div>
          </div>

          {/* FAQ questions */}
          {isFAQ && s.questions && s.questions.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-border/30 pt-3">
              {s.questions.slice(0, 3).map((faq, i) => (
                <div key={i} className="rounded-lg bg-muted/40 px-3 py-2">
                  <p className="text-xs font-medium text-foreground">{faq.q}</p>
                  {faq.a && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">{faq.a}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Trending pills
// ---------------------------------------------------------------------------

function TrendingSection({
  items,
  onSelect,
}: {
  items: TrendingItem[];
  onSelect: (q: string) => void;
}) {
  if (!items.length) return null;

  return (
    <div className="mt-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <TrendingUp className="h-3.5 w-3.5" />
        Suositut haut
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.query}
            onClick={() => onSelect(item.query)}
            className="cursor-pointer rounded-full border border-border/40 bg-card px-3.5 py-1.5 text-[13px] font-medium text-foreground transition-all duration-150 ease-out hover:border-primary/25 hover:bg-primary/[0.04] hover:text-primary"
          >
            {item.query}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Autocomplete dropdown
// ---------------------------------------------------------------------------

function AutocompleteDropdown({
  suggestions,
  visible,
  activeIndex,
  onSelect,
}: {
  suggestions: string[];
  visible: boolean;
  activeIndex: number;
  onSelect: (q: string) => void;
}) {
  if (!visible || !suggestions.length) return null;

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-xl shadow-black/[0.06] animate-in fade-in slide-in-from-top-1 duration-150">
      {suggestions.map((s, i) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-[14px] transition-colors duration-100 hover:bg-muted/50 ${
            i === activeIndex ? "bg-muted/60" : ""
          }`}
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <span>{s}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contact CTA (zero results)
// ---------------------------------------------------------------------------

function ContactCTA({ config }: { config: ContactConfig }) {
  if (!config.enabled) return null;

  return (
    <div className="mt-6 rounded-xl border border-border/50 bg-muted/30 p-6 text-center animate-in fade-in slide-in-from-bottom-3 duration-400">
      <p className="mb-4 text-sm font-medium text-foreground">
        {config.cta_text_fi}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {config.email && (
          <Button variant="outline" size="sm" className="gap-2 text-xs" asChild>
            <a href={`mailto:${config.email}`}>
              <Mail className="h-3.5 w-3.5" />
              Sähköposti
            </a>
          </Button>
        )}
        {config.phone && (
          <Button variant="outline" size="sm" className="gap-2 text-xs" asChild>
            <a href={`tel:${config.phone}`}>
              <Phone className="h-3.5 w-3.5" />
              {config.phone}
            </a>
          </Button>
        )}
        {config.chat_url && (
          <Button size="sm" className="gap-2 text-xs" asChild>
            <a href={config.chat_url} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-3.5 w-3.5" />
              Chat
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No results
// ---------------------------------------------------------------------------

function NoResults({ query, contact }: { query: string; contact?: ContactConfig | null }) {
  return (
    <div className="mt-10 text-center animate-in fade-in duration-300">
      <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
      <p className="text-sm font-medium text-foreground">
        Ei tuloksia haulle "{query}"
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Kokeile eri hakusanoja tai tarkista kirjoitusasu.
      </p>
      {contact && <ContactCTA config={contact} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function SearchPreview() {
  const { siteId } = useParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [site, setSite] = useState<Site | null>(null);

  const [trending, setTrending] = useState<TrendingItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [copied, setCopied] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const suggestRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sessionId = useRef(
    sessionStorage.getItem("findai-session") ||
    (() => {
      const id = crypto.randomUUID();
      sessionStorage.setItem("findai-session", id);
      return id;
    })()
  );

  useEffect(() => {
    if (!siteId) return;
    api.getSite(siteId).then(setSite).catch(() => {});
    api.getTrending(siteId).then((d) => setTrending(d.trending)).catch(() => {});
  }, [siteId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchSuggestions = useCallback(
    (q: string) => {
      clearTimeout(suggestRef.current);
      if (!q.trim() || q.length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      suggestRef.current = setTimeout(async () => {
        try {
          const data = await api.getSuggestions(siteId!, q);
          setSuggestions(data.suggestions || []);
          setShowSuggestions(true);
          setActiveIndex(-1);
        } catch {
          setSuggestions([]);
        }
      }, 150);
    },
    [siteId]
  );

  function handleInput(q: string) {
    setQuery(q);
    setError(null);
    clearTimeout(debounceRef.current);
    fetchSuggestions(q);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(q), 400);
  }

  function selectSuggestion(q: string) {
    setQuery(q);
    setShowSuggestions(false);
    setSuggestions([]);
    doSearch(q);
    inputRef.current?.focus();
  }

  function selectTrending(q: string) {
    setQuery(q);
    doSearch(q);
    inputRef.current?.focus();
  }

  async function doSearch(q: string) {
    setLoading(true);
    setError(null);
    setShowSuggestions(false);
    try {
      const data = await api.search(siteId!, q);
      setResults(data);
    } catch (e: any) {
      setError(e.message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showSuggestions || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  function trackClick(url: string, position: number) {
    if (results?.search_log_id) {
      api.trackClick(results.search_log_id, url, position, sessionId.current).catch(() => {});
    }
    window.open(url, "_blank", "noopener");
  }

  function copySnippet() {
    const snippet = `<script\n  src="YOUR_API_URL/widget.js"\n  data-site-id="${siteId}"\n  data-api-url="YOUR_API_URL">\n</script>`;
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const hasResults = results && results.results && results.results.length > 0;
  const noResults = results && results.results && results.results.length === 0;

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {site?.name || "Search Preview"}
          </h1>
          <p className="text-xs text-muted-foreground">{site?.domain}</p>
        </div>
        <Button variant="ghost" size="sm" className="cursor-pointer" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Takaisin
          </Link>
        </Button>
      </div>

      {/* Search box */}
      <div ref={containerRef} className="relative">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground/50" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Mitä etsit?"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            className="h-[52px] w-full rounded-2xl border border-border/50 bg-card pl-11 pr-11 text-[15px] shadow-sm outline-none transition-all duration-200 ease-out placeholder:text-muted-foreground/35 focus:border-primary/25 focus:shadow-md focus:shadow-primary/[0.04]"
            autoFocus
          />
          {loading && (
            <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground/50" />
          )}
        </div>

        <AutocompleteDropdown
          suggestions={suggestions}
          visible={showSuggestions}
          activeIndex={activeIndex}
          onSelect={selectSuggestion}
        />
      </div>

      {/* Trending */}
      {!query && !results && (
        <TrendingSection items={trending} onSelect={selectTrending} />
      )}


      {/* AI summary */}
      {hasResults && results.ai_summary && (
        <div className="mb-3 mt-5 flex items-start gap-2 rounded-2xl border border-primary/10 bg-primary/[0.03] px-4 py-3">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" />
          <p className="text-[13px] leading-relaxed text-foreground/80">
            {results.ai_summary}
          </p>
        </div>
      )}

      {/* Results count — minimal */}
      {hasResults && (
        <p className="mb-2.5 mt-5 text-[12px] text-muted-foreground/60">
          {results.results.length} tulosta
        </p>
      )}

      {/* Results */}
      {hasResults && (
        <div className="space-y-2 animate-in fade-in slide-in-from-bottom-1 duration-200">
          {results.results.map((r, i) => (
            <ResultCard
              key={`${r.url}-${i}`}
              result={r}
              index={i}
              onTrackClick={trackClick}
            />
          ))}
        </div>
      )}

      {/* No results */}
      {noResults && (
        <NoResults query={query} contact={results.contact_config} />
      )}

      {/* Fallback */}
      {results?.fallback_message && !noResults && (
        <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
          {results.fallback_message}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Widget snippet */}
      <Card className="mt-12 border-border/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Upotuskoodi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">{`<script
  src="YOUR_API_URL/widget.js"
  data-site-id="${siteId}"
  data-api-url="YOUR_API_URL">
</script>`}</pre>
            <Button
              variant="ghost"
              size="sm"
              onClick={copySnippet}
              className="absolute right-1 top-1 h-7 gap-1 text-[10px]"
            >
              {copied ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied ? "Kopioitu" : "Kopioi"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
