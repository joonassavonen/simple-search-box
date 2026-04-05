import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Site, SiteStats } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Search, Loader2, AlertCircle, Brain, RefreshCw, TrendingUp, TrendingDown, MousePointerClick, FileSearch, SearchX, Ban } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Synonym {
  id: string;
  query_from: string;
  query_to: string;
  confidence: number;
  times_used: number;
}

export default function Analytics() {
  const { siteId } = useParams();
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [synonyms, setSynonyms] = useState<Synonym[]>([]);
  const [learningRunning, setLearningRunning] = useState(false);

  useEffect(() => {
    if (!siteId) {
      setLoading(false);
      setError("No site selected. Go to Sites and click Analytics on a specific site.");
      return;
    }
    async function load() {
      try {
        const [s, st] = await Promise.all([
          api.getSite(siteId!),
          api.getStats(siteId!),
        ]);
        setSite(s);
        setStats(st);
        const { data: syns } = await supabase
          .from("search_synonyms")
          .select("*")
          .eq("site_id", siteId!)
          .order("confidence", { ascending: false })
          .limit(50);
        setSynonyms((syns as any[]) || []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [siteId]);

  const runLearning = async () => {
    if (!siteId) return;
    setLearningRunning(true);
    try {
      const result = await api.discoverSynonyms(siteId);
      toast({
        title: "Oppiminen valmis",
        description: `${result.discovered} uutta synonyymia löydetty`,
      });
      const { data: syns } = await supabase
        .from("search_synonyms")
        .select("*")
        .eq("site_id", siteId)
        .order("confidence", { ascending: false })
        .limit(50);
      setSynonyms((syns as any[]) || []);
    } catch (e: any) {
      toast({ title: "Virhe", description: e.message, variant: "destructive" });
    } finally {
      setLearningRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading analytics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-destructive">
        <AlertCircle className="mr-2 h-5 w-5" />
        Error: {error}
      </div>
    );
  }

  if (!stats || !site) return null;

  const ctrPct = (stats.click_through_rate * 100).toFixed(1);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const periodLabel = `${thirtyDaysAgo.toLocaleDateString("fi-FI", { day: "numeric", month: "short" })} – ${now.toLocaleDateString("fi-FI", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {site.name} — Analytics
          </h1>
          <p className="text-sm text-muted-foreground">{site.domain}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" asChild>
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" />
              All Sites
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/search/${siteId}`}>
              <Search className="mr-1 h-4 w-4" />
              Test Search
            </Link>
          </Button>
        </div>
      </div>

      {/* Search Performance Section */}
      <div>
        <div className="flex items-baseline gap-3 mb-4">
          <h2 className="text-lg font-semibold">Search performance</h2>
          <span className="text-sm text-muted-foreground">{periodLabel}</span>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground mb-1">Click rate</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">{ctrPct} %</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground mb-1">Total searches</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">{stats.total_searches.toLocaleString("fi-FI")}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground mb-1">Searches (7d)</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">{stats.searches_last_7d.toLocaleString("fi-FI")}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground mb-1">Pages indexed</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">{stats.pages_indexed.toLocaleString("fi-FI")}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Three column tables */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Top Searches */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileSearch className="h-4 w-4 text-muted-foreground" />
                Top searches
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {stats.top_queries.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No searches yet</p>
              ) : (
                <div className="space-y-1">
                  {stats.top_queries.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                      <span className="text-sm truncate mr-2">{r.query}</span>
                      <span className="text-sm font-medium text-muted-foreground tabular-nums">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top searches with no results */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <SearchX className="h-4 w-4 text-muted-foreground" />
                Top searches with no results
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {stats.failed_searches.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No failed searches 🎉</p>
              ) : (
                <div className="space-y-1">
                  {stats.failed_searches.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                      <span className="text-sm truncate mr-2">{r.query}</span>
                      <span className="text-sm font-medium text-muted-foreground tabular-nums">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top searches with no clicks */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Ban className="h-4 w-4 text-muted-foreground" />
                Top searches with no clicks
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {stats.no_click_queries.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">All searches got clicks 🎉</p>
              ) : (
                <div className="space-y-1">
                  {stats.no_click_queries.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                      <span className="text-sm truncate mr-2">{r.query}</span>
                      <span className="text-sm font-medium text-muted-foreground tabular-nums">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Learning section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Oppiva haku — Synonyymit
          </CardTitle>
          <Button
            size="sm"
            onClick={runLearning}
            disabled={learningRunning}
          >
            {learningRunning ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            {learningRunning ? "Oppii..." : "Käynnistä oppiminen"}
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Oppiminen analysoi hakuhistorian ja löytää synonyymeja sekä assosiaatioita klikkausten ja AI:n avulla.
          </p>
          {synonyms.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Ei opittuja synonyymejä vielä. Käynnistä oppiminen kun hakudataa on kertynyt.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hakulause</TableHead>
                  <TableHead>Synonyymi</TableHead>
                  <TableHead className="w-24 text-right">Luottamus</TableHead>
                  <TableHead className="w-20 text-right">Käytöt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {synonyms.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.query_from}</TableCell>
                    <TableCell>{s.query_to}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={s.confidence >= 0.7 ? "default" : "secondary"}>
                        {(s.confidence * 100).toFixed(0)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{s.times_used}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
