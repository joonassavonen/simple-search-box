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
import { Separator } from "@/components/ui/separator";
import {
  Search,
  ArrowLeft,
  Loader2,
  ExternalLink,
  TrendingUp,
  Star,
  Calendar,
  MapPin,
  Tag,
  ShoppingCart,
  FileText,
  HelpCircle,
  Mail,
  Phone,
  MessageCircle,
  Sparkles,
  Clock,
  Globe,
  ChevronRight,
  Zap,
  Copy,
  Check,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Score ring — circular indicator
// ---------------------------------------------------------------------------

function ScoreRing({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c - (score * c);
  const color =
    pct >= 80 ? "text-emerald-500" :
    pct >= 60 ? "text-amber-500" :
    pct >= 40 ? "text-orange-400" :
    "text-gray-400";

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="3" className="stroke-muted/40" />
        <circle
          cx="22" cy="22" r={r} fill="none" strokeWidth="3"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${color} stroke-current transition-all duration-700`}
        />
      </svg>
      <span className={`absolute text-xs font-bold ${color}`}>{pct}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schema badges
// ---------------------------------------------------------------------------

function SchemaIcon({ type }: { type: string }) {
  switch (type) {
    case "Product": return <ShoppingCart className="h-3 w-3" />;
    case "Article": return <FileText className="h-3 w-3" />;
    case "FAQPage": return <HelpCircle className="h-3 w-3" />;
    case "Event": return <Calendar className="h-3 w-3" />;
    default: return <Tag className="h-3 w-3" />;
  }
}

function SchemaRichData({ result }: { result: SearchResult }) {
  const s = result.schema_data;
  if (!s) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Badge variant="secondary" className="gap-1 text-[11px] font-medium">
        <SchemaIcon type={s.type} />
        {s.type}
      </Badge>

      {/* Product */}
      {s.type === "Product" && s.price && (
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-sm font-bold text-emerald-700">
          {s.currency === "EUR" ? "\u20AC" : s.currency || ""}{s.price}
        </span>
      )}
      {s.rating && (
        <span className="flex items-center gap-1 text-sm">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          <span className="font-semibold text-amber-700">{s.rating}</span>
          {s.reviewCount && (
            <span className="text-xs text-muted-foreground">({s.reviewCount})</span>
          )}
        </span>
      )}
      {s.availability && (
        <Badge variant={s.availability.includes("InStock") ? "default" : "secondary"}
          className={`text-[10px] ${s.availability.includes("InStock") ? "bg-emerald-500" : ""}`}>
          {s.availability.includes("InStock") ? "In Stock" : "Out of Stock"}
        </Badge>
      )}

      {/* Article */}
      {s.type === "Article" && s.author && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="font-medium">{s.author}</span>
        </span>
      )}
      {s.type === "Article" && s.datePublished && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {new Date(s.datePublished).toLocaleDateString("fi-FI")}
        </span>
      )}

      {/* Event */}
      {s.type === "Event" && s.startDate && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {new Date(s.startDate).toLocaleDateString("fi-FI")}
        </span>
      )}
      {s.type === "Event" && s.location && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {s.location}
        </span>
      )}

      {/* Product image */}
      {s.image && s.type === "Product" && (
        <img
          src={s.image}
          alt=""
          className="ml-auto h-10 w-10 rounded-md object-cover shadow-sm"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FAQ accordion
// ---------------------------------------------------------------------------

function FaqSection({ questions }: { questions: { q: string; a: string }[] }) {
  if (!questions?.length) return null;
  return (
    <div className="mt-2 space-y-1">
      {questions.slice(0, 3).map((faq, i) => (
        <div key={i} className="rounded-md bg-muted/50 px-3 py-2">
          <p className="text-xs font-medium">{faq.q}</p>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{faq.a}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single result card
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
  const domain = result.url.replace(/^https?:\/\//, "").split("/")[0];
  const path = result.url.replace(/^https?:\/\/[^/]+/, "") || "/";

  return (
    <div
      className="group relative rounded-xl border border-border/60 bg-card p-4 transition-all duration-200 hover:border-primary/20 hover:shadow-md hover:shadow-primary/5"
      onClick={() => onTrackClick(result.url, index)}
    >
      {/* Top row: domain + score */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* Breadcrumb URL */}
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">{domain}</span>
            {path !== "/" && (
              <>
                <ChevronRight className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{decodeURIComponent(path).replace(/^\//, "").replace(/\//g, " > ")}</span>
              </>
            )}
          </div>

          {/* Title */}
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-base font-semibold text-foreground transition-colors hover:text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            {result.title || domain}
            <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
          </a>

          {/* Snippet */}
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground line-clamp-3">
            {result.snippet}
          </p>

          {/* AI reasoning */}
          {result.reasoning && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-primary/5 px-3 py-2">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <p className="text-xs leading-relaxed text-primary/80">{result.reasoning}</p>
            </div>
          )}

          {/* Schema rich data */}
          <SchemaRichData result={result} />

          {/* FAQ questions */}
          {result.schema_data?.type === "FAQPage" && result.schema_data.questions && (
            <FaqSection questions={result.schema_data.questions} />
          )}
        </div>

        {/* Score ring */}
        <ScoreRing score={result.score} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trending section
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
    <div className="mt-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <TrendingUp className="h-4 w-4" />
        <span>Suositut haut</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.query}
            onClick={() => onSelect(item.query)}
            className="group flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-all hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm"
          >
            <Search className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-primary" />
            {item.query}
            <Badge variant="secondary" className="ml-1 h-5 rounded-full px-1.5 text-[10px]">
              {item.count}
            </Badge>
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
    <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg shadow-black/5 animate-in fade-in slide-in-from-top-1 duration-150">
      {suggestions.map((s, i) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/80 ${
            i === activeIndex ? "bg-muted/80" : ""
          }`}
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">{s}</span>
          <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
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

  const isFinnish = true; // could detect from UI language
  const ctaText = isFinnish ? config.cta_text_fi : config.cta_text_en;

  return (
    <div className="mt-6 rounded-xl border-2 border-dashed border-primary/20 bg-primary/5 p-6 text-center animate-in fade-in slide-in-from-bottom-3 duration-500">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <MessageCircle className="h-6 w-6 text-primary" />
      </div>
      <p className="mb-4 text-base font-semibold text-foreground">{ctaText}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {config.email && (
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a href={`mailto:${config.email}`}>
              <Mail className="h-4 w-4" />
              {config.email}
            </a>
          </Button>
        )}
        {config.phone && (
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a href={`tel:${config.phone}`}>
              <Phone className="h-4 w-4" />
              {config.phone}
            </a>
          </Button>
        )}
        {config.chat_url && (
          <Button size="sm" className="gap-2" asChild>
            <a href={config.chat_url} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" />
              Avaa chat
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No results message
// ---------------------------------------------------------------------------

function NoResults({ query, contact }: { query: string; contact?: ContactConfig | null }) {
  return (
    <div className="mt-8 text-center animate-in fade-in duration-300">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Search className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">Ei tuloksia haulle "{query}"</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Kokeile eri hakusanoja tai tarkista kirjoitusasu.
      </p>
      {contact && <ContactCTA config={contact} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SearchPreview() {
  const { siteId } = useParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [site, setSite] = useState<Site | null>(null);

  // Learning features state
  const [trending, setTrending] = useState<TrendingItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Widget snippet copy
  const [copied, setCopied] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const suggestRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Session ID for click tracking
  const sessionId = useRef(
    sessionStorage.getItem("findai-session") ||
    (() => {
      const id = crypto.randomUUID();
      sessionStorage.setItem("findai-session", id);
      return id;
    })()
  );

  // Load site + trending on mount
  useEffect(() => {
    if (!siteId) return;
    api.getSite(siteId).then(setSite).catch(() => {});
    api.getTrending(siteId).then((d) => setTrending(d.trending)).catch(() => {});
  }, [siteId]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Fetch autocomplete suggestions
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

    // Fetch suggestions while typing
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
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Search Preview</h1>
          </div>
          {site && (
            <p className="mt-1 text-sm text-muted-foreground">
              {site.name} &middot; {site.domain}
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Takaisin
          </Link>
        </Button>
      </div>

      {/* Search box */}
      <div ref={searchContainerRef} className="relative mb-2">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Hae sivustolta..."
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            className="h-14 w-full rounded-2xl border border-border/60 bg-card pl-12 pr-12 text-base shadow-sm outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary/30 focus:ring-2 focus:ring-primary/10 focus:shadow-lg focus:shadow-primary/5"
            autoFocus
          />
          {loading && (
            <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-primary" />
          )}
        </div>

        {/* Autocomplete dropdown */}
        <AutocompleteDropdown
          suggestions={suggestions}
          visible={showSuggestions}
          activeIndex={activeIndex}
          onSelect={selectSuggestion}
        />
      </div>

      {/* Trending — shown when input is empty and no results */}
      {!query && !results && (
        <TrendingSection items={trending} onSelect={selectTrending} />
      )}

      {/* Results meta bar */}
      {hasResults && (
        <div className="mb-4 mt-6 flex items-center gap-3">
          <span className="text-sm font-medium">
            {results.results.length} tulosta
          </span>
          <Separator orientation="vertical" className="h-4" />
          <Badge variant="secondary" className="gap-1 text-xs">
            <Globe className="h-3 w-3" />
            {results.language === "fi" ? "Suomi" : "English"}
          </Badge>
          <Badge variant="secondary" className="gap-1 text-xs">
            <Clock className="h-3 w-3" />
            {results.response_ms} ms
          </Badge>
          <Badge variant="secondary" className="gap-1 text-xs">
            <Sparkles className="h-3 w-3" />
            AI-ranked
          </Badge>
        </div>
      )}

      {/* Results list */}
      {hasResults && (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
        <NoResults
          query={query}
          contact={results.contact_config}
        />
      )}

      {/* Fallback message */}
      {results?.fallback_message && !noResults && (
        <div className="mt-4 rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
          {results.fallback_message}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive animate-in fade-in duration-200">
          Hakuvirhe: {error}
        </div>
      )}

      {/* Widget embed snippet */}
      <Card className="mt-10 overflow-hidden border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Copy className="h-4 w-4 text-muted-foreground" />
            Widget-upotuskoodi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg bg-muted/70 p-4 text-xs leading-relaxed">{`<script
  src="YOUR_API_URL/widget.js"
  data-site-id="${siteId}"
  data-api-url="YOUR_API_URL">
</script>`}</pre>
            <Button
              variant="ghost"
              size="sm"
              onClick={copySnippet}
              className="absolute right-2 top-2 h-8 gap-1.5 text-xs"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Kopioitu!" : "Kopioi"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
