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
import { ArrowLeft, Search, Lightbulb, Loader2, AlertCircle, Brain, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

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
  const [optimizing, setOptimizing] = useState(false);

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
        // Load synonyms
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

  const runOptimization = async () => {
    if (!siteId) return;
    setOptimizing(true);
    try {
      const result = await api.runOptimization(siteId);
      toast({
        title: "Optimointi valmis",
        description: `${result.high_ctr_patterns || 0} korkean CTR:n mallia, ${result.zero_result_queries || 0} nollatuloshakua analysoitu`,
      });
    } catch (e: any) {
      toast({ title: "Virhe", description: e.message, variant: "destructive" });
    } finally {
      setOptimizing(false);
    }
  };

  const runLearning = async () => {
    if (!siteId) return;
    setLearningRunning(true);
    try {
      const result = await api.discoverSynonyms(siteId);
      toast({
        title: "Oppiminen valmis",
        description: `${result.discovered} uutta synonyymia löydetty`,
      });
      // Reload synonyms
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

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Searches" value={stats.total_searches.toLocaleString()} sub="All time" />
        <StatCard label="Searches (7 days)" value={stats.searches_last_7d.toLocaleString()} sub="Last 7 days" />
        <StatCard label="Click-through Rate" value={`${ctrPct}%`} sub="Searches with a click" />
        <StatCard label="Avg Results" value={stats.avg_results_per_search.toFixed(1)} sub="Per search" />
        <StatCard label="Pages Indexed" value={stats.pages_indexed.toLocaleString()} sub="In search index" />
      </div>

      {/* AI Optimization Agent */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI-optimointiagentti
          </CardTitle>
          <Button
            size="sm"
            onClick={runOptimization}
            disabled={optimizing}
          >
            {optimizing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            {optimizing ? "Optimoi..." : "Käynnistä optimointi"}
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Optimointiagentti analysoi hakuhistorian, CTR-datan ja konversiot, ja kirjoittaa strategian joka ohjaa hakutekoälyä ja yhteydenotto-CTA:iden näyttämistä dynaamisesti.
          </p>
        </CardContent>
      </Card>

      {/* Learning section */}
      <Card className="mt-6">
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

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Queries (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.top_queries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No searches yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead className="w-20 text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.top_queries.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{r.query}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{r.count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Failed Searches — Content Gaps</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.failed_searches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No failed searches. Great!</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Query</TableHead>
                    <TableHead className="w-20 text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.failed_searches.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Badge variant="destructive" className="mr-2 text-[10px]">!</Badge>
                        {r.query}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{r.count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {stats.failed_searches.length > 0 && (
        <Card className="mt-4">
          <CardContent className="flex items-start gap-3 p-4">
            <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-accent-foreground" />
            <div>
              <p className="font-medium">Content Gap Insight</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Users searched for the queries above but didn't click any results. Consider
                creating new content or improving existing pages to cover these topics.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}