import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Site, SearchResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, Loader2, ExternalLink } from "lucide-react";

function scoreLabel(score: number) {
  if (score >= 0.8) return { text: "Great match", color: "bg-green-100 text-green-700" };
  if (score >= 0.6) return { text: "Good match", color: "bg-yellow-100 text-yellow-700" };
  if (score >= 0.4) return { text: "Possible match", color: "bg-gray-100 text-gray-700" };
  return { text: "Related", color: "bg-gray-100 text-gray-500" };
}

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

  const EXAMPLES = [
    "sähkökatko mitä teen",
    "how do I cancel my contract",
    "lasku virheellinen",
    "renewable energy options",
  ];

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={
                site?.domain?.includes("helen") || /[äöå]/i.test(query)
                  ? "Hae sivustolta, esim. 'sähkökatko mitä teen'..."
                  : "Search the site, e.g. 'how do I pay my bill'..."
              }
              value={query}
              onChange={(e) => handleQuery(e.target.value)}
              className="pl-10 pr-10"
              autoFocus
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {!query && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-muted-foreground">Try example queries:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((h) => (
                  <Button
                    key={h}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => handleQuery(h)}
                  >
                    {h}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {results && !results.error && (
            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>{results.results?.length || 0} results</span>
                <span>{results.language === "fi" ? "Finnish" : "English"}</span>
                <span>{results.response_ms}ms</span>
              </div>

              {results.results?.map((r, i) => {
                const sl = scoreLabel(r.score);
                return (
                  <div key={i} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener"
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {r.title || r.url}
                        <ExternalLink className="ml-1 inline h-3 w-3" />
                      </a>
                      <Badge className={sl.color} variant="outline">
                        {(r.score * 100).toFixed(0)}% — {sl.text}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm">{r.snippet}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <strong>Why:</strong> {r.reasoning}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.url.replace(/^https?:\/\//, "")}
                    </p>
                  </div>
                );
              })}

              {results.fallback_message && (
                <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                  {results.fallback_message}
                </div>
              )}
            </div>
          )}

          {results?.error && (
            <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              Search error: {results.error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-sm">Widget snippet for {site?.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`<script
  src="YOUR_API_URL/widget.js"
  data-site-id="${siteId}"
  data-api-url="YOUR_API_URL">
</script>`}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
