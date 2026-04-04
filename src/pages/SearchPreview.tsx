import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Site, SearchResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ExternalLink, Search } from "lucide-react";

export default function SearchPreview() {
  const { siteId } = useParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(SearchResponse & { error?: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [site, setSite] = useState<Site | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.getSite(siteId!).then(setSite).catch(() => {});
  }, [siteId]);

  function handleQuery(q: string) {
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(q), 400);
  }

  async function doSearch(q: string) {
    setLoading(true);
    try {
      const data = await api.search(siteId!, q);
      setResults(data);
    } catch (e: any) {
      setResults({ error: e.message } as any);
    } finally {
      setLoading(false);
    }
  }

  const widgetSnippet = `<script
  src="${window.location.origin}/widget.js"
  data-site-id="${siteId}"
  data-api-url="${import.meta.env.VITE_SUPABASE_URL}/functions/v1">
</script>`;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Test Search</h1>
          <p className="text-sm text-muted-foreground">
            {site?.name} ({site?.domain})
          </p>
        </div>
        <Button variant="ghost" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      {/* Widget Preview Container — simulates a website background */}
      <div className="rounded-xl border bg-muted/30 p-6 sm:p-10">
        <p className="mb-4 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Widget Preview
        </p>

        {/* Widget Panel */}
        <div className="mx-auto w-full max-w-[640px] overflow-hidden rounded-xl border bg-background shadow-lg">
          {/* Search Bar */}
          <div className="flex items-center gap-3 border-b px-4 py-3.5">
            <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => handleQuery(e.target.value)}
              placeholder={
                site?.domain?.includes("fi") ? "Hae sivustolta..." : "Search the site..."
              }
              className="flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          </div>

          {/* Empty state — trending / examples */}
          {!query && !results && (
            <div className="px-5 py-4">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Try searching
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["ilmalämpöpumppu", "huolto", "asennus", "takuu"].map((term) => (
                  <button
                    key={term}
                    onClick={() => handleQuery(term)}
                    className="inline-flex items-center rounded-full border bg-muted/50 px-3 py-1 text-[13px] text-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          {results && !results.error && (
            <div className="max-h-[50vh] overflow-y-auto">
              {results.results?.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No results found. Try different keywords.
                </div>
              )}

              {results.results?.map((r, i) => (
                <a
                  key={i}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block border-b px-5 py-3.5 transition-colors last:border-b-0 hover:bg-primary/5"
                >
                  <div className="mb-1 flex items-center gap-2.5">
                    <span className="flex-1 text-[15px] font-semibold text-primary">
                      {r.title || r.url}
                    </span>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {(r.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mb-1 line-clamp-2 text-[13px] leading-relaxed text-foreground">
                    {r.snippet}
                  </p>
                  <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                    <ExternalLink className="inline h-3 w-3" />
                    {r.url.replace(/^https?:\/\//, "")}
                  </p>
                </a>
              ))}

              {/* Stats footer */}
              <div className="flex items-center justify-between border-t px-4 py-2">
                <span className="text-[11px] text-muted-foreground">
                  {results.results?.length || 0} results · {results.response_ms}ms
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Powered by FindAI
                </span>
              </div>
            </div>
          )}

          {/* Error */}
          {results?.error && (
            <div className="px-5 py-4 text-sm text-destructive">
              Search error: {results.error}
            </div>
          )}
        </div>
      </div>

      {/* Widget Snippet */}
      <div className="mt-6 rounded-xl border p-5">
        <h3 className="mb-3 text-sm font-semibold">Widget snippet for {site?.name}</h3>
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
          {widgetSnippet}
        </pre>
      </div>
    </div>
  );
}
