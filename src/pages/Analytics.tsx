import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Site, SiteStats, LearningStats } from "@/lib/api";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Search,
  Loader2,
  AlertCircle,
  Brain,
  RefreshCw,
  FileSearch,
  SearchX,
  Ban,
  Zap,
  BookOpen,
  MousePointerClick,
  ExternalLink,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Synonym {
  id: string;
  query_from: string;
  query_to: string;
  confidence: number;
  times_used: number;
}

type DateRange = "7" | "30" | "90";
type ChartMetric = "searches" | "clicks" | "no_results" | "click_rate";

const metricLabels: Record<ChartMetric, string> = {
  searches: "Searches",
  clicks: "Clicks",
  no_results: "No results",
  click_rate: "Click rate %",
};

export default function Analytics() {
  const { siteId } = useParams();
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("searches");
  const [dateRange, setDateRange] = useState<DateRange>("30");
  const [synonyms, setSynonyms] = useState<Synonym[]>([]);
  const [learningStats, setLearningStats] = useState<LearningStats | null>(null);
  const [learningRunning, setLearningRunning] = useState(false);

  useEffect(() => {
    if (!siteId) {
      setLoading(false);
      setError("No site selected. Go to Sites and click Analytics on a specific site.");
      return;
    }
    async function load() {
      try {
        const [s, st, ls] = await Promise.all([
          api.getSite(siteId!),
          api.getStats(siteId!),
          api.getLearningStats(siteId!),
        ]);
        setSite(s);
        setStats(st);
        setLearningStats(ls);
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
      const [ls, { data: syns }] = await Promise.all([
        api.getLearningStats(siteId),
        supabase
          .from("search_synonyms")
          .select("*")
          .eq("site_id", siteId)
          .order("confidence", { ascending: false })
          .limit(50),
      ]);
      setLearningStats(ls);
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

      {/* Tabs */}
      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="performance" className="gap-1.5">
            <FileSearch className="h-4 w-4" />
            Hakuanalyysi
          </TabsTrigger>
          <TabsTrigger value="learning" className="gap-1.5">
            <Brain className="h-4 w-4" />
            Oppiminen
          </TabsTrigger>
        </TabsList>

        {/* ─── Search Performance Tab ─── */}
        <TabsContent value="performance" className="space-y-4">
          <div className="flex items-baseline gap-3 mb-2">
            <h2 className="text-lg font-semibold">Search performance</h2>
            <span className="text-sm text-muted-foreground">{periodLabel}</span>
          </div>

          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground mb-1">Click rate</p>
                <span className="text-2xl font-bold">{ctrPct} %</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground mb-1">Total searches</p>
                <span className="text-2xl font-bold">{stats.total_searches.toLocaleString("fi-FI")}</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground mb-1">Searches (7d)</p>
                <span className="text-2xl font-bold">{stats.searches_last_7d.toLocaleString("fi-FI")}</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground mb-1">Pages indexed</p>
                <span className="text-2xl font-bold">{stats.pages_indexed.toLocaleString("fi-FI")}</span>
              </CardContent>
            </Card>
          </div>

          {/* Line Chart */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Daily trend</CardTitle>
              <Select value={chartMetric} onValueChange={(v) => setChartMetric(v as ChartMetric)}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="searches">Searches</SelectItem>
                  <SelectItem value="clicks">Clicks</SelectItem>
                  <SelectItem value="no_results">No results</SelectItem>
                  <SelectItem value="click_rate">Click rate %</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.daily}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => {
                        const date = new Date(d);
                        return `${date.getDate()}.${date.getMonth() + 1}`;
                      }}
                      className="text-xs"
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis className="text-xs" tick={{ fontSize: 11 }} width={40} />
                    <Tooltip
                      labelFormatter={(d: string) => new Date(d).toLocaleDateString("fi-FI")}
                      formatter={(value: number) => [
                        chartMetric === "click_rate" ? `${value}%` : value,
                        metricLabels[chartMetric],
                      ]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey={chartMetric}
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0, fill: "hsl(var(--primary))" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Three column tables */}
          <div className="grid gap-4 md:grid-cols-3">
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
        </TabsContent>

        {/* ─── Learning Tab ─── */}
        <TabsContent value="learning" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Oppiva haku</h2>
              <p className="text-sm text-muted-foreground">
                AI analysoi hakuhistorian ja oppii synonyymeja, assosiaatioita ja relevanssiboosteja klikkausten perusteella.
              </p>
            </div>
            <Button onClick={runLearning} disabled={learningRunning}>
              {learningRunning ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              {learningRunning ? "Oppii..." : "Käynnistä oppiminen"}
            </Button>
          </div>

          {/* Learning KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5 flex items-center gap-4">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Synonyymit</p>
                  <span className="text-2xl font-bold">{learningStats?.synonym_count ?? 0}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex items-center gap-4">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Boost-parit</p>
                  <span className="text-2xl font-bold">{learningStats?.boost_pairs ?? 0}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex items-center gap-4">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <MousePointerClick className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Opitut klikkaukset</p>
                  <span className="text-2xl font-bold">{learningStats?.total_learned_clicks ?? 0}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Boosts Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Relevanssiboostit — Top query → URL -parit
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {!learningStats || learningStats.top_boosted.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  Ei opittuja boosteja vielä. Klikkausdataa kertyy sitä mukaa kun käyttäjät hakevat.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Haku</TableHead>
                      <TableHead>Boostattu URL</TableHead>
                      <TableHead className="w-24 text-right">Klikkaukset</TableHead>
                      <TableHead className="w-24 text-right">Boost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {learningStats.top_boosted.map((b, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{b.query}</TableCell>
                        <TableCell className="max-w-[250px] truncate">
                          <a
                            href={b.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {new URL(b.url).pathname}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{b.clicks}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={b.boost >= 5 ? "default" : "secondary"}>
                            +{b.boost}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Synonyms Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                Opitut synonyymit
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {synonyms.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  Ei opittuja synonyymejä vielä. Käynnistä oppiminen kun hakudataa on kertynyt.
                </p>
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

          {/* Click Distribution Bar Chart */}
          {learningStats && learningStats.top_boosted.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Klikkausjakauma — Top boostit</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={learningStats.top_boosted.slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                      <XAxis
                        dataKey="query"
                        tick={{ fontSize: 11 }}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                        height={50}
                      />
                      <YAxis tick={{ fontSize: 11 }} width={35} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(value: number) => [value, "Klikkaukset"]}
                      />
                      <Bar dataKey="clicks" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
