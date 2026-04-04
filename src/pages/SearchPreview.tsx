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
import { supabase } from "@/integrations/supabase/client";
import {
  Search,
  ArrowLeft,
  Loader2,
  ExternalLink,
  TrendingUp,
  Sparkles,
  Star,
  Calendar,
  MapPin,
  Mail,
  Phone,
  MessageCircle,
  X,
  Copy,
  Check,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types for popular products
// ---------------------------------------------------------------------------
interface PopularProduct {
  title: string;
  url: string;
  image?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanTitle(title: string, url: string): string {
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
      .join(" › ");
  } catch {
    return "";
  }
}

function cleanSnippet(snippet: string): string {
  if (!snippet) return "";
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
    .replace(/\d{2,3}\s+\d{4}\s+\d{4}/g, "")
    .replace(/Uusi asiakas\?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatPrice(price: string | number, currency?: string): string {
  const num = typeof price === "string" ? parseFloat(price) : price;
  if (isNaN(num)) return String(price);
  const formatted = num.toFixed(2).replace(".", ",");
  return currency === "EUR" || !currency
    ? `alk. ${formatted} €`
    : `alk. ${formatted} ${currency}`;
}

// ---------------------------------------------------------------------------
// Result card
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
  const snippet = cleanSnippet(result.snippet);
  const s = result.schema_data;
  const isProduct = s?.type === "Product";
  const [imgError, setImgError] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onTrackClick(result.url, index)}
      className="group flex w-full cursor-pointer items-start gap-3 sm:gap-4 rounded-lg sm:rounded-xl border border-transparent bg-white p-3 sm:p-4 text-left transition-all duration-150 hover:border-[hsl(145,50%,40%)]/10 hover:shadow-md"
    >
      {/* Product image */}
      {isProduct && s?.image && !imgError && (
        <div className="shrink-0">
          <img
            src={s.image}
            alt={s.name || title}
            className="h-14 w-14 sm:h-16 sm:w-16 rounded-lg border border-border/30 object-contain bg-white"
            onError={() => setImgError(true)}
          />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h3 className="text-sm sm:text-[15px] font-semibold leading-snug text-foreground group-hover:text-[hsl(145,50%,35%)]">
          {title}
        </h3>

        {/* Price & availability for products */}
        {isProduct && s?.price && (
          <p className="mt-1 text-sm font-bold text-[hsl(145,60%,35%)]">
            {formatPrice(s.price, s.currency)}
          </p>
        )}

        {/* Rating */}
        {isProduct && s?.rating && (
          <div className="mt-1 flex items-center gap-1">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                className={`h-3 w-3 ${
                  i < Math.round(Number(s.rating))
                    ? "fill-amber-400 text-amber-400"
                    : "fill-muted text-muted"
                }`}
              />
            ))}
            {s.reviewCount && (
              <span className="ml-1 text-xs text-muted-foreground">({s.reviewCount})</span>
            )}
          </div>
        )}

        {/* Availability badge */}
        {isProduct && s?.availability && (
          <Badge
            variant="secondary"
            className={`mt-1.5 text-[10px] ${
              s.availability.includes("InStock")
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-orange-200 bg-orange-50 text-orange-700"
            }`}
          >
            {s.availability.includes("InStock") ? "✓ Varastossa" : "Ei varastossa"}
          </Badge>
        )}

        {/* Snippet */}
        {snippet && (
          <p className="mt-1 sm:mt-1.5 text-xs sm:text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
            {snippet}
          </p>
        )}

        {/* Article/Event meta */}
        {s?.type === "Article" && (s.author || s.datePublished) && (
          <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            {s.author && <span>{s.author}</span>}
            {s.author && s.datePublished && <span>·</span>}
            {s.datePublished && <span>{new Date(s.datePublished).toLocaleDateString("fi-FI")}</span>}
          </div>
        )}

        {s?.type === "Event" && (
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {s.startDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(s.startDate).toLocaleDateString("fi-FI")}
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

        {/* FAQ */}
        {s?.type === "FAQPage" && s.questions && s.questions.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {s.questions.slice(0, 2).map((faq, i) => (
              <div key={i} className="rounded-lg bg-muted/40 px-3 py-2">
                <p className="text-xs font-medium text-foreground">{faq.q}</p>
                {faq.a && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">{faq.a}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* External link icon */}
      <div className="shrink-0 pt-1">
        <ExternalLink className="h-4 w-4 text-muted-foreground/0 transition-all group-hover:text-[hsl(145,50%,40%)]/50" />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Featured / promoted result card (green tint)
// ---------------------------------------------------------------------------

function FeaturedCard({
  result,
  onTrackClick,
}: {
  result: SearchResult;
  onTrackClick: (url: string, position: number) => void;
}) {
  const title = cleanTitle(result.title, result.url);
  const snippet = cleanSnippet(result.snippet);
  const s = result.schema_data;
  const [imgError, setImgError] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onTrackClick(result.url, 0)}
      className="group flex w-full cursor-pointer items-center gap-4 rounded-xl border border-[hsl(145,40%,85%)] bg-[hsl(145,40%,96%)] p-4 text-left transition-all hover:shadow-md"
    >
      {s?.image && !imgError && (
        <div className="shrink-0">
          <img
            src={s.image}
            alt={title}
            className="h-12 w-12 rounded-lg object-contain"
            onError={() => setImgError(true)}
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
        {snippet && (
          <p className="mt-0.5 text-[13px] text-muted-foreground line-clamp-1">{snippet}</p>
        )}
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-[hsl(145,50%,40%)]" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Popular products (trending with images)
// ---------------------------------------------------------------------------

function PopularSection({
  products,
  onSelect,
}: {
  products: PopularProduct[];
  onSelect: (q: string) => void;
}) {
  if (!products.length) return null;

  return (
    <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Suosittua juuri nyt
      </div>
      <div className="space-y-1">
        {products.map((p) => (
          <button
            key={p.url}
            onClick={() => onSelect(p.title)}
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/50"
          >
            {p.image ? (
              <img
                src={p.image}
                alt=""
                className="h-10 w-10 shrink-0 rounded-lg border border-border/30 object-contain bg-white"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-lg bg-muted/50" />
            )}
            <span className="text-[14px] font-medium text-foreground">{p.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Autocomplete with images
// ---------------------------------------------------------------------------

function SearchDropdown({
  suggestions,
  visible,
  activeIndex,
  onSelect,
  pages,
  results,
  loading,
  noResults,
  query,
  onTrackClick,
  zeroSuggestions,
  onSuggestionClick,
  contactConfig,
}: {
  suggestions: string[];
  visible: boolean;
  activeIndex: number;
  onSelect: (q: string) => void;
  pages: PopularProduct[];
  results: SearchResponse | null;
  loading: boolean;
  noResults: boolean;
  query: string;
  onTrackClick: (url: string, position: number) => void;
  zeroSuggestions?: string[];
  onSuggestionClick?: (q: string) => void;
  contactConfig?: ContactConfig | null;
}) {
  const hasResults = results && results.results && results.results.length > 0;
  const showAutocomplete = visible && suggestions.length > 0;
  const showResults = query.trim().length > 0 && (hasResults || noResults || loading);

  if (!showAutocomplete && !showResults) return null;

  const getImage = (q: string) => {
    const match = pages.find((p) =>
      p.title.toLowerCase().includes(q.toLowerCase())
    );
    return match?.image;
  };

  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto overscroll-contain rounded-xl sm:rounded-2xl border border-border/50 bg-white shadow-xl animate-in fade-in slide-in-from-top-1 duration-150">
      {/* Autocomplete suggestions */}
      {showAutocomplete && (
        <div className={hasResults || loading ? "border-b border-border/30" : ""}>
          {suggestions.map((s, i) => {
            const img = getImage(s);
            return (
              <button
                key={`sug-${s}`}
                onClick={() => onSelect(s)}
                className={`flex w-full cursor-pointer items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 text-left transition-colors hover:bg-muted/40 ${
                  i === activeIndex ? "bg-muted/50" : ""
                }`}
              >
                {img ? (
                  <img
                    src={img}
                    alt=""
                    className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-lg border border-border/20 object-contain bg-white"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                )}
                <span className="text-[13px] sm:text-[14px] text-foreground">{s}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center gap-2 px-4 py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground">Haetaan...</span>
        </div>
      )}

      {/* Search results inline */}
      {hasResults && !loading && (
        <div>
          {/* Results count */}
          <div className="flex items-center gap-1.5 px-3 sm:px-4 pt-2.5 pb-1 text-xs sm:text-sm font-semibold text-[hsl(145,50%,35%)]">
            <Sparkles className="h-3.5 w-3.5" />
            {results.results.length} osuma{results.results.length !== 1 ? "a" : ""}
          </div>

          {/* Featured / AI summary */}
          {results.ai_summary && (
            <button
              type="button"
              onClick={() => onTrackClick(results.results[0]?.url || "", 0)}
              className="group mx-2 mb-1 flex w-[calc(100%-16px)] cursor-pointer items-center gap-3 rounded-lg border border-[hsl(145,40%,85%)] bg-[hsl(145,40%,96%)] p-3 text-left transition-all hover:shadow-md"
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-foreground line-clamp-2">{results.ai_summary.split(".")[0]}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{results.ai_summary}</p>
              </div>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[hsl(145,50%,40%)]" />
            </button>
          )}

          {/* Result items */}
          {results.results.map((r, i) => (
            <DropdownResultItem key={`res-${r.url}-${i}`} result={r} index={i} onTrackClick={onTrackClick} />
          ))}

          {/* Contact CTA inline */}
          {contactConfig && contactConfig.enabled && (
            <div className="border-t border-border/30 p-3">
              <ContactCTA config={contactConfig} />
            </div>
          )}
        </div>
      )}

      {/* No results */}
      {noResults && !loading && (
        <div className="px-4 py-6 text-center">
          <Search className="mx-auto mb-2 h-6 w-6 text-muted-foreground/30" />
          <p className="text-xs font-medium text-foreground">Ei tuloksia haulle "{query}"</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Kokeile eri hakusanoja</p>
          {zeroSuggestions && zeroSuggestions.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Tarkoititko:</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {zeroSuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => onSuggestionClick?.(s)}
                    className="rounded-full bg-[hsl(145,40%,95%)] px-2.5 py-1 text-[11px] font-medium text-[hsl(145,50%,30%)] hover:bg-[hsl(145,40%,88%)] transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Compact result item for the dropdown
function DropdownResultItem({
  result,
  index,
  onTrackClick,
}: {
  result: SearchResult;
  index: number;
  onTrackClick: (url: string, position: number) => void;
}) {
  const title = cleanTitle(result.title, result.url);
  const snippet = cleanSnippet(result.snippet);
  const s = result.schema_data;
  const isProduct = s?.type === "Product";
  const [imgError, setImgError] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onTrackClick(result.url, index)}
      className="group flex w-full cursor-pointer items-start gap-3 px-3 sm:px-4 py-2.5 sm:py-3 text-left transition-colors hover:bg-muted/30"
    >
      {isProduct && s?.image && !imgError && (
        <div className="shrink-0 mt-0.5">
          <img
            src={s.image}
            alt={s.name || title}
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-lg border border-border/30 object-contain bg-white"
            onError={() => setImgError(true)}
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] sm:text-sm font-semibold leading-snug text-foreground group-hover:text-[hsl(145,50%,35%)] line-clamp-2">
          {title}
        </h3>
        {isProduct && s?.price && (
          <p className="mt-0.5 text-xs font-bold text-[hsl(145,60%,35%)]">
            {formatPrice(s.price, s.currency)}
          </p>
        )}
        {isProduct && s?.rating && (
          <div className="mt-0.5 flex items-center gap-0.5">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                className={`h-2.5 w-2.5 ${
                  i < Math.round(Number(s.rating))
                    ? "fill-amber-400 text-amber-400"
                    : "fill-muted text-muted"
                }`}
              />
            ))}
            {s.reviewCount && (
              <span className="ml-0.5 text-[10px] text-muted-foreground">({s.reviewCount})</span>
            )}
          </div>
        )}
        {snippet && (
          <p className="mt-0.5 text-[11px] sm:text-xs leading-relaxed text-muted-foreground line-clamp-2">
            {snippet}
          </p>
        )}
        {s?.type === "Article" && (s.author || s.datePublished) && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {s.author && <span>{s.author}</span>}
            {s.author && s.datePublished && <span>·</span>}
            {s.datePublished && <span>{new Date(s.datePublished).toLocaleDateString("fi-FI")}</span>}
          </div>
        )}
      </div>
      <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Contact CTA — full-width green buttons
// ---------------------------------------------------------------------------

function ContactCTA({ config }: { config: ContactConfig }) {
  if (!config.enabled) return null;

  return (
    <div className="mt-6 space-y-2 animate-in fade-in slide-in-from-bottom-3 duration-400">
      {config.phone && (
        <a
          href={`tel:${config.phone}`}
          className="flex w-full items-center justify-center gap-2 rounded-lg sm:rounded-xl bg-[hsl(145,45%,35%)] px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-[15px] font-semibold text-white transition-all hover:bg-[hsl(145,45%,30%)]"
        >
          <Phone className="h-5 w-5" />
          Soita {config.phone}
        </a>
      )}
      {config.chat_url && (
        <a
          href={config.chat_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-lg sm:rounded-xl bg-[hsl(145,55%,50%)] px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-[15px] font-semibold text-white transition-all hover:bg-[hsl(145,55%,45%)]"
        >
          <MessageCircle className="h-5 w-5" />
          Lähetä WhatsApp-viesti
        </a>
      )}
      {config.email && (
        <a
          href={`mailto:${config.email}`}
          className="flex w-full items-center justify-center gap-2 rounded-lg sm:rounded-xl border border-border/50 bg-white px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-[15px] font-medium text-foreground transition-all hover:bg-muted/30"
        >
          <Mail className="h-5 w-5" />
          {config.email}
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// No results
// ---------------------------------------------------------------------------

function NoResults({ query, contact, suggestions, onSuggestionClick }: { 
  query: string; 
  contact?: ContactConfig | null;
  suggestions?: string[];
  onSuggestionClick?: (q: string) => void;
}) {
  return (
    <div className="mt-8 text-center animate-in fade-in duration-300">
      <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
      <p className="text-sm font-medium text-foreground">
        Ei tuloksia haulle "{query}"
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Kokeile eri hakusanoja tai tarkista kirjoitusasu.
      </p>
      {suggestions && suggestions.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Tarkoititko ehkä:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onSuggestionClick?.(s)}
                className="rounded-full bg-[hsl(145,40%,95%)] px-3 py-1 text-xs font-medium text-[hsl(145,50%,30%)] hover:bg-[hsl(145,40%,88%)] transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
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
  const [popularProducts, setPopularProducts] = useState<PopularProduct[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [copied, setCopied] = useState(false);
  const [contactConfig, setContactConfig] = useState<ContactConfig | null>(null);

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

  // Fetch site, trending, popular products, and contact config
  useEffect(() => {
    if (!siteId) return;
    api.getSite(siteId).then(setSite).catch(() => {});
    api.getTrending(siteId).then((d) => setTrending(d.trending)).catch(() => {});
    api.getContactConfig(siteId).then(setContactConfig).catch(() => {});

    // Fetch popular products (pages with schema images)
    supabase
      .from("pages")
      .select("title, url, schema_data")
      .eq("site_id", siteId)
      .not("schema_data", "is", null)
      .limit(50)
      .then(({ data }) => {
        if (!data) return;
        const products: PopularProduct[] = [];
        for (const p of data) {
          try {
            const schema = typeof p.schema_data === "string"
              ? JSON.parse(p.schema_data)
              : p.schema_data;
            if (schema?.type === "Product" && p.title) {
              products.push({
                title: p.title,
                url: p.url,
                image: schema.image || undefined,
              });
            }
          } catch { /* skip */ }
        }
        setPopularProducts(products.slice(0, 5));
      });
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
    if (siteId && query) {
      api.trackClick(siteId, query, url).catch(() => {});
    }
    window.open(url, "_blank", "noopener");
  }

  function clearQuery() {
    setQuery("");
    setResults(null);
    setError(null);
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
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
    <div className="mx-auto max-w-2xl px-1 sm:px-0">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
            {site?.name || "Search Preview"}
          </h1>
          <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{site?.domain}</p>
        </div>
        <Button variant="ghost" size="sm" className="cursor-pointer shrink-0 text-xs sm:text-sm" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span className="hidden sm:inline">Takaisin</span>
            <span className="sm:hidden">←</span>
          </Link>
        </Button>
      </div>

      {/* Search box — green focus, X clear, search button */}
      <div ref={containerRef} className="relative">
        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 sm:left-4 top-1/2 h-4 w-4 sm:h-[18px] sm:w-[18px] -translate-y-1/2 text-muted-foreground/40" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Kysy meiltä mitä vain..."
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              className="h-11 sm:h-[52px] w-full rounded-xl sm:rounded-2xl border-2 border-border/50 bg-white pl-9 sm:pl-11 pr-9 sm:pr-10 text-sm sm:text-[15px] shadow-sm outline-none transition-all duration-200 placeholder:text-muted-foreground/40 focus:border-[hsl(145,50%,45%)] focus:shadow-md focus:shadow-[hsl(145,50%,45%)]/10"
              autoFocus
            />
            {query && !loading && (
              <button
                onClick={clearQuery}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground/50" />
            )}
          </div>

          {/* Search button — appears when there's a query */}
          {query.trim() && (
            <button
              onClick={() => doSearch(query)}
              className="flex h-10 w-10 sm:h-[48px] sm:w-[48px] shrink-0 items-center justify-center rounded-lg sm:rounded-xl bg-amber-400 text-white shadow-md transition-all hover:bg-amber-500 active:scale-95"
            >
              <Search className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          )}
        </div>

        {/* Autocomplete */}
        <AutocompleteDropdown
          suggestions={suggestions}
          visible={showSuggestions}
          activeIndex={activeIndex}
          onSelect={selectSuggestion}
          pages={popularProducts}
        />
      </div>

      {/* Subtext removed */}
      {false && (
        <p></p>
      )}

      {/* Popular products (trending with images) */}
      {!query && !results && popularProducts.length > 0 && (
        <PopularSection products={popularProducts} onSelect={selectTrending} />
      )}

      {/* Text-only trending fallback if no products */}
      {!query && !results && popularProducts.length === 0 && trending.length > 0 && (
        <div className="mt-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Suosittua juuri nyt
          </div>
          <div className="flex flex-wrap gap-2">
            {trending.map((item) => (
              <button
                key={item.query}
                onClick={() => selectTrending(item.query)}
                className="cursor-pointer rounded-full border border-border/40 bg-white px-3.5 py-1.5 text-[13px] font-medium text-foreground transition-all hover:border-[hsl(145,50%,45%)]/25 hover:bg-[hsl(145,50%,45%)]/5"
              >
                {item.query}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results count */}
      {hasResults && (
        <div className="mb-3 mt-5 flex items-center gap-1.5 text-sm font-semibold text-[hsl(145,50%,35%)]">
          <Sparkles className="h-4 w-4" />
          {results.results.length} osuma{results.results.length !== 1 ? "a" : ""}
        </div>
      )}

      {/* AI summary as featured card */}
      {hasResults && results.ai_summary && (
        <FeaturedCard
          result={{
            url: results.results[0]?.url || "",
            title: results.ai_summary.split(".")[0] || "Löydä sopivin vaihtoehto",
            snippet: results.ai_summary,
            score: 1,
            reasoning: "",
          }}
          onTrackClick={trackClick}
        />
      )}

      {/* Results */}
      {hasResults && (
        <div className="mt-2 space-y-0.5 sm:space-y-1 rounded-xl sm:rounded-2xl bg-white p-1.5 sm:p-2 shadow-sm border border-border/30 animate-in fade-in slide-in-from-bottom-1 duration-200">
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

      {/* Contact CTA — always show after results if configured */}
      {hasResults && contactConfig && <ContactCTA config={contactConfig} />}

      {/* No results */}
      {noResults && (
        <NoResults 
          query={query} 
          contact={contactConfig || results?.contact_config}
          suggestions={results?.suggestions}
          onSuggestionClick={(q) => selectSuggestion(q)}
        />
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Widget snippet */}
      <Card className="mt-8 sm:mt-12 border-border/30">
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
