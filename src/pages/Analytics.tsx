import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Site, SiteStats, LearningStats } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
  Lightbulb,
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
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Check,
  X,
  BarChart3,
  TrendingUp,
  Eye,
  Target,
  Activity,
  Layers3,
  WandSparkles,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  LineChart,
  Line,
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

interface HighCtrPattern {
  pattern: string;
  top_url: string;
  ctr: number;
  clicks: number;
}

interface PageBoost {
  page_path: string;
  ga_boost: number;
  ctr_boost: number;
  popularity_boost: number;
  total_boost: number;
  reasons: string[];
}

interface GAPageData {
  page_path: string;
  pageviews: number;
  sessions: number;
  conversions: number;
  bounce_rate: number;
  avg_time_on_page: number;
  period_start: string;
  period_end: string;
  fetched_at: string;
}

type DateRange = "7" | "30" | "90";
type ChartMetric = "searches" | "clicks" | "no_results" | "click_rate";

const metricLabels: Record<ChartMetric, string> = {
  searches: "Searches",
  clicks: "Clicks",
  no_results: "No results",
  click_rate: "Click rate %",
};

const QUERIES_PER_PAGE = 10;

function AnalyticsMetricCard({
  title,
  value,
  hint,
  icon,
  tone = "primary",
}: {
  title: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: "primary" | "accent" | "secondary" | "muted";
}) {
  const toneMap = {
    primary: "bg-primary/10 text-primary ring-primary/15",
    accent: "bg-accent text-accent-foreground ring-border",
    secondary: "bg-secondary text-secondary-foreground ring-border",
    muted: "bg-muted text-muted-foreground ring-border",
  } as const;

  return (
    <Card className="min-w-0 border-border/80 bg-card shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
            <div className="font-mono text-2xl font-semibold tracking-tight text-foreground">{value}</div>
            {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
          </div>
          <div className={`self-start rounded-2xl p-3 ring-1 ${toneMap[tone]}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function PaginatedQueryList({
  items,
  emptyMessage,
  renderExtra,
}: {
  items: { query: string; count: number }[];
  emptyMessage: string;
  renderExtra?: (query: string) => React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(items.length / QUERIES_PER_PAGE);
  const paged = items.slice(page * QUERIES_PER_PAGE, (page + 1) * QUERIES_PER_PAGE);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground italic">{emptyMessage}</p>;
  }

  return (
    <div>
      <div className="space-y-1">
        {paged.map((r, i) => (
          <div key={i} className="border-b border-border/30 last:border-0 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm truncate mr-2">{r.query}</span>
              <span className="text-sm font-medium text-muted-foreground tabular-nums">{r.count}</span>
            </div>
            {renderExtra?.(r.query)}
          </div>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3">
          <span className="text-xs text-muted-foreground">
            {page * QUERIES_PER_PAGE + 1}–{Math.min((page + 1) * QUERIES_PER_PAGE, items.length)} / {items.length}
          </span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [editingSynonym, setEditingSynonym] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ query_from: "", query_to: "" });
  const [learningRunning, setLearningRunning] = useState(false);
  const [gaPages, setGaPages] = useState<GAPageData[]>([]);
  const [synonymPage, setSynonymPage] = useState(0);
  const [pageSuggestions, setPageSuggestions] = useState<Record<string, { url: string; title: string; reason: string }[]>>({});
  const [optimizing, setOptimizing] = useState(false);
  const [highCtrPatterns, setHighCtrPatterns] = useState<HighCtrPattern[]>([]);
  const [popularityData, setPopularityData] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!siteId) {
      setLoading(false);
      setError("No site selected. Go to Sites and click Analytics on a specific site.");
      return;
    }
    let isMounted = true;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    async function load(silent = false) {
      try {
        if (!silent) setLoading(true);
        const [s, st, ls] = await Promise.all([
          api.getSite(siteId!),
          api.getStats(siteId!, Number(dateRange)),
          api.getLearningStats(siteId!),
        ]);
        if (!isMounted) return;
        setSite(s);
        setStats(st);
        setLearningStats(ls);
        setPageSuggestions(ls.failed_query_suggestions || {});
        const [{ data: syns }, { data: gaData }, { data: strategyData }, { data: clickPopularity }] = await Promise.all([
          supabase
            .from("search_synonyms")
            .select("*")
            .eq("site_id", siteId!)
            .order("confidence", { ascending: false })
            .limit(50),
          supabase
            .from("page_analytics")
            .select("*")
            .eq("site_id", siteId!)
            .order("pageviews", { ascending: false })
            .limit(200),
          (supabase as any)
            .from("site_search_strategy")
            .select("high_ctr_patterns")
            .eq("site_id", siteId!)
            .maybeSingle(),
          supabase
            .from("search_clicks")
            .select("page_url, click_count")
            .eq("site_id", siteId!)
            .order("click_count", { ascending: false })
            .limit(100),
        ]);
        if (!isMounted) return;
        setSynonyms((syns as any[]) || []);
        setGaPages((gaData as GAPageData[]) || []);
        setHighCtrPatterns((strategyData?.high_ctr_patterns as HighCtrPattern[]) || []);
        const popMap: Record<string, number> = {};
        for (const c of (clickPopularity || []) as any[]) {
          const path = (() => { try { return new URL(c.page_url).pathname; } catch { return c.page_url; } })();
          popMap[path] = (popMap[path] || 0) + (c.click_count || 0);
        }
        setPopularityData(popMap);
      } catch (e: any) {
        if (!isMounted) return;
        setError(e.message);
      } finally {
        if (!silent && isMounted) setLoading(false);
      }
    }

    const queueRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        load(true);
      }, 300);
    };

    load();

    const channel = supabase
      .channel(`analytics-live-${siteId}-${dateRange}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "search_logs",
        filter: `site_id=eq.${siteId}`,
      }, queueRefresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "search_clicks",
        filter: `site_id=eq.${siteId}`,
      }, queueRefresh)
      .subscribe();

    return () => {
      isMounted = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [siteId, dateRange]);

  const runOptimization = async () => {
    if (!siteId) return;
    setOptimizing(true);
    try {
      const result = await api.runOptimization(siteId);
      setPageSuggestions(result.suggestions || {});
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
      setPageSuggestions(ls.failed_query_suggestions || {});
      setSynonyms((syns as any[]) || []);
      const matchCount = Object.keys(result.suggestions || {}).length;
      toast({
        title: "Optimointi valmis",
        description: `${result.high_ctr_patterns || 0} korkean CTR:n mallia, ${result.zero_result_queries || 0} nollatuloshakua analysoitu${matchCount ? `, ${matchCount} sivumatchia löytyi` : ""}${result.synonyms_created ? `, ${result.synonyms_created} synonyymia tallennettu` : ""}`,
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

  const deleteSynonym = async (id: string) => {
    const { error } = await supabase.from("search_synonyms").delete().eq("id", id);
    if (error) {
      toast({ title: "Virhe", description: error.message, variant: "destructive" });
      return;
    }
    setSynonyms((prev) => prev.filter((s) => s.id !== id));
    toast({ title: "Synonyymi poistettu" });
  };

  const startEdit = (s: Synonym) => {
    setEditingSynonym(s.id);
    setEditForm({ query_from: s.query_from, query_to: s.query_to });
  };

  const saveEdit = async (id: string) => {
    const from = editForm.query_from.trim();
    const to = editForm.query_to.trim();
    if (!from || !to) return;
    const { error } = await supabase
      .from("search_synonyms")
      .update({ query_from: from, query_to: to })
      .eq("id", id);
    if (error) {
      toast({ title: "Virhe", description: error.message, variant: "destructive" });
      return;
    }
    setSynonyms((prev) => prev.map((s) => (s.id === id ? { ...s, query_from: from, query_to: to } : s)));
    setEditingSynonym(null);
    toast({ title: "Synonyymi päivitetty" });
  };
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center rounded-[28px] border border-border bg-card py-20 shadow-sm">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-sm font-medium">Ladataan analytiikkaa...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center rounded-[28px] border border-destructive/20 bg-destructive/10 py-20 text-destructive shadow-sm">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm font-medium">Virhe: {error}</span>
        </div>
      </div>
    );
  }

  if (!stats || !site) return null;

  const ctrPct = (stats.click_through_rate * 100).toFixed(1);
  const now = new Date();
  const daysNum = Number(dateRange);
  const periodStart = new Date(now.getTime() - daysNum * 24 * 60 * 60 * 1000);
  const periodLabel = `${periodStart.toLocaleDateString("fi-FI", { day: "numeric", month: "short" })} – ${now.toLocaleDateString("fi-FI", { day: "numeric", month: "short", year: "numeric" })}`;
  const failedSearchCount = stats.failed_searches.reduce((sum, item) => sum + item.count, 0);
  const noClickCount = stats.no_click_queries.reduce((sum, item) => sum + item.count, 0);
  const panelClass = "border-border bg-card shadow-sm";
  const mutedPanelClass = "border-border bg-muted/30 shadow-sm";
  const topAffinityPreview = learningStats?.top_affinities.slice(0, 5) ?? [];
  const lastOptimized = learningStats?.last_optimized_at
    ? new Date(learningStats.last_optimized_at).toLocaleString("fi-FI")
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={`rounded-[28px] border ${panelClass}`}>
        <div className="flex flex-col gap-5 px-4 py-5 sm:px-8 sm:py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Analytics
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                {site.name}
              </h1>
              <p className="text-sm text-muted-foreground">{site.domain}</p>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Näe nopeasti, mitä haetaan, missä haku epäonnistuu ja miten oppiminen sekä konversiosignaalit kehittyvät.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:min-w-[220px]">
              <Button variant="ghost" asChild className="w-full justify-start rounded-2xl border border-border bg-background/80 sm:w-auto">
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  All Sites
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid gap-3 border-t border-border pt-5 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Jakso
              <div className="mt-1 font-medium text-foreground">{periodLabel}</div>
            </div>
            <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Nollatuloshaut
              <div className="mt-1 font-medium text-foreground">{failedSearchCount}</div>
            </div>
            <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Haut ilman klikkiä
              <div className="mt-1 font-medium text-foreground">{noClickCount}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="performance" className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-[18px] border border-border bg-card p-1.5 shadow-sm sm:grid-cols-3">
          <TabsTrigger value="performance" className="min-w-0 gap-2 rounded-[18px] px-3 py-3 text-sm data-[state=active]:shadow-none">
            <FileSearch className="h-4 w-4" />
            Hakuanalyysi
          </TabsTrigger>
          <TabsTrigger value="ga" className="min-w-0 gap-2 rounded-[18px] px-3 py-3 text-sm data-[state=active]:shadow-none">
            <BarChart3 className="h-4 w-4" />
            Google Analytics
          </TabsTrigger>
          <TabsTrigger value="learning" className="min-w-0 gap-2 rounded-[18px] px-3 py-3 text-sm data-[state=active]:shadow-none">
            <Brain className="h-4 w-4" />
            Oppiminen
          </TabsTrigger>
        </TabsList>

        {/* ─── Search Performance Tab ─── */}
        <TabsContent value="performance" className="min-w-0 space-y-5">
          <div className={`rounded-[24px] border ${panelClass} p-4 sm:p-6`}>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Hakujen suorituskyky</h2>
              <span className="hidden text-sm text-muted-foreground sm:inline">{periodLabel}</span>
            </div>
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
              <SelectTrigger className="h-10 w-full rounded-2xl border-border bg-background text-xs sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 päivää</SelectItem>
                <SelectItem value="30">30 päivää</SelectItem>
                <SelectItem value="90">90 päivää</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AnalyticsMetricCard title="CTR" value={`${ctrPct} %`} hint="Kuinka moni haku johtaa klikkiin" icon={<Activity className="h-5 w-5" />} tone="primary" />
            <AnalyticsMetricCard title="Haut yhteensä" value={stats.total_searches.toLocaleString("fi-FI")} hint="Kaikki haut valitulla jaksolla" icon={<Search className="h-5 w-5" />} tone="muted" />
            <AnalyticsMetricCard title="Haut 7 päivää" value={stats.searches_last_7d.toLocaleString("fi-FI")} hint="Tuore kysyntä viimeiseltä viikolta" icon={<TrendingUp className="h-5 w-5" />} tone="accent" />
            <AnalyticsMetricCard title="Indeksoidut sivut" value={stats.pages_indexed.toLocaleString("fi-FI")} hint="Sisältöpohja haulle" icon={<Layers3 className="h-5 w-5" />} tone="secondary" />
          </div>

          {/* Line Chart */}
          <Card className={`mt-5 ${mutedPanelClass}`}>
            <CardHeader className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-foreground">Päivittäinen kehitys</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Seuraa kysynnän, klikkien ja epäonnistuneiden hakujen rytmiä päiväkohtaisesti.</p>
              </div>
              <Select value={chartMetric} onValueChange={(v) => setChartMetric(v as ChartMetric)}>
                <SelectTrigger className="h-10 w-full rounded-2xl border-border bg-background text-xs sm:w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="searches">Haut</SelectItem>
                  <SelectItem value="clicks">Klikit</SelectItem>
                  <SelectItem value="no_results">Nollatulokset</SelectItem>
                  <SelectItem value="click_rate">CTR %</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="h-[220px] sm:h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.daily}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/80" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => {
                        const date = new Date(d);
                        return `${date.getDate()}.${date.getMonth() + 1}`;
                      }}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis tick={{ fontSize: 11 }} width={40} />
                    <Tooltip
                      labelFormatter={(d: string) => new Date(d).toLocaleDateString("fi-FI")}
                      formatter={(value: number) => [
                        chartMetric === "click_rate" ? `${value}%` : value,
                        metricLabels[chartMetric],
                      ]}
                      contentStyle={{
                        backgroundColor: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "16px",
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
          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            <Card className={panelClass}>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
                  <FileSearch className="h-4 w-4 text-primary" />
                  Haetuimmat haut
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <PaginatedQueryList items={stats.top_queries} emptyMessage="Hakuja ei ole vielä kertynyt." />
              </CardContent>
            </Card>

            <Card className={panelClass}>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
                  <MousePointerClick className="h-4 w-4 text-primary" />
                  Eniten klikattuja hakuja
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <PaginatedQueryList items={stats.top_clicked_queries} emptyMessage="Klikkejä ei ole vielä kertynyt." />
              </CardContent>
            </Card>

            <Card className={panelClass}>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
                  <Ban className="h-4 w-4 text-muted-foreground" />
                  Haut ilman klikkiä
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <PaginatedQueryList items={stats.no_click_queries} emptyMessage="Kaikki haut saivat klikkejä." />
              </CardContent>
            </Card>
          </div>

          <Card className={panelClass}>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
                  <SearchX className="h-4 w-4 text-primary" />
                  Haut ilman tuloksia
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <PaginatedQueryList
                  items={stats.failed_searches}
                  emptyMessage="Ei epäonnistuneita hakuja."
                />
              </CardContent>
          </Card>
          </div>
        </TabsContent>

        {/* ─── GA Tab ─── */}
        <TabsContent value="ga" className="min-w-0 space-y-5">
          {gaPages.length === 0 ? (
            <Card className={panelClass}>
              <CardContent className="p-8 text-center">
                <BarChart3 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <h3 className="mb-1 font-semibold text-foreground">Ei GA-dataa</h3>
                <p className="text-sm text-muted-foreground">
                  Synkronoi Google Analytics -data Integraatiot-sivulla ensin.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* GA KPI Cards */}
              {(() => {
                const totalPV = gaPages.reduce((s, p) => s + p.pageviews, 0);
                const totalKE = gaPages.reduce((s, p) => s + p.conversions, 0);
                const totalSessions = gaPages.reduce((s, p) => s + p.sessions, 0);
                const overallRate = totalPV > 0 ? (totalKE / totalPV * 100) : 0;
                const fetched = gaPages[0]?.fetched_at;
                return (
                  <>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <h2 className="text-xl font-semibold tracking-tight text-foreground">Google Analytics — Key Events</h2>
                      {fetched && (
                        <span className="text-xs text-muted-foreground">
                          Synkronoitu: {new Date(fetched).toLocaleDateString("fi-FI", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <AnalyticsMetricCard title="Katselut" value={totalPV.toLocaleString("fi-FI")} hint="Sivujen kokonaisnäytöt" icon={<Eye className="h-5 w-5" />} tone="primary" />
                      <AnalyticsMetricCard title="Key Events" value={totalKE.toLocaleString("fi-FI")} hint="Tavoitetapahtumat yhteensä" icon={<Target className="h-5 w-5" />} tone="accent" />
                      <AnalyticsMetricCard title="Key Event Rate" value={`${overallRate.toFixed(2)} %`} hint="Konversiot katselua kohti" icon={<TrendingUp className="h-5 w-5" />} tone="secondary" />
                      <AnalyticsMetricCard title="Sessiot" value={totalSessions.toLocaleString("fi-FI")} hint="Istunnot valitulla datasetillä" icon={<BarChart3 className="h-5 w-5" />} tone="muted" />
                    </div>
                  </>
                );
              })()}

              {/* Top Pages with Boost Effect */}
              <Card className={panelClass}>
                <CardHeader className="border-b border-border pb-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
                    <Zap className="h-4 w-4 text-primary" />
                    Top-sivut ja hakuboostaus (kävijämäärällä painotettu Key Event Rate)
                  </CardTitle>
                </CardHeader>
                <CardContent className="min-w-0 pt-0">
                  {(() => {
                    const totalPV = gaPages.reduce((s, p) => s + p.pageviews, 0) || 1;
                    const maxPV = Math.max(...gaPages.map(p => p.pageviews), 1);
                    const pagesWithBoost = gaPages
                      .filter(p => p.pageviews > 0 && (p.conversions / p.pageviews) <= 1 && p.page_path !== "/")
                      .map(p => {
                        const keyEventRate = p.conversions / p.pageviews;
                        const pvWeight = p.pageviews / totalPV;
                        const weightedRate = keyEventRate * pvWeight;
                        return { ...p, keyEventRate, weightedRate };
                      })
                      .sort((a, b) => b.weightedRate - a.weightedRate);

                    const maxWR = pagesWithBoost[0]?.weightedRate || 0.0001;

                    return (
                      <div className="max-w-full overflow-x-auto">
                      <Table className="min-w-[720px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Sivu</TableHead>
                            <TableHead className="w-24 text-right">Katselut</TableHead>
                            <TableHead className="w-24 text-right">Key Events</TableHead>
                            <TableHead className="w-28 text-right">KE Rate</TableHead>
                            <TableHead className="w-28 text-right">Painotettu</TableHead>
                            <TableHead className="w-24 text-right">Boost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pagesWithBoost.slice(0, 20).map((p, i) => {
                            const normalizedWR = p.weightedRate / maxWR;
                            const boostPoints = Math.round(normalizedWR * 25 + (p.pageviews / maxPV) * 8);
                            return (
                              <TableRow key={i}>
                                <TableCell className="max-w-[300px] truncate font-medium">
                                  {p.page_path}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {p.pageviews.toLocaleString("fi-FI")}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {p.conversions}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {(p.keyEventRate * 100).toFixed(2)} %
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {(p.weightedRate * 10000).toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Badge variant={boostPoints >= 10 ? "default" : "secondary"}>
                                    +{boostPoints}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="learning" className="min-w-0 space-y-5">
          {/* Actions */}
          <div className={`rounded-[24px] border ${panelClass} p-5 sm:p-6`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-foreground">Oppiminen & optimointi</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  AI tunnistaa synonyymit hakulogeista ja yhdistää nollatuloshaut relevantteihin sivuihin.
                </p>
                {lastOptimized && (
                  <p className="mt-1 text-xs text-muted-foreground">Viimeksi optimoitu: {lastOptimized}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={runOptimization} disabled={optimizing} className="rounded-2xl">
                  {optimizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-2 h-4 w-4" />}
                  {optimizing ? "Optimoidaan..." : "Optimoi"}
                </Button>
                <Button onClick={runLearning} disabled={learningRunning} variant="outline" className="rounded-2xl">
                  {learningRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  {learningRunning ? "Opitaan..." : "Opi synonyymit"}
                </Button>
              </div>
            </div>
          </div>

          {/* KPI row */}
          <div className="grid gap-4 sm:grid-cols-3">
            <AnalyticsMetricCard title="Synonyymit" value={String(synonyms.length)} hint="Opitut synonyymit" icon={<BookOpen className="h-5 w-5" />} tone="primary" />
            <AnalyticsMetricCard title="Klikkisignaalit" value={String(learningStats?.affinity_count ?? 0)} hint="Query → sivu -yhteydet" icon={<MousePointerClick className="h-5 w-5" />} tone="accent" />
            <AnalyticsMetricCard title="Klikkejä yhteensä" value={String(learningStats?.total_affinity_clicks ?? 0)} hint="Käyttäjäsignaalit" icon={<TrendingUp className="h-5 w-5" />} tone="secondary" />
          </div>

          {/* Top click signals */}
          {topAffinityPreview.length > 0 && (
            <Card className={panelClass}>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  Vahvimmat klikkisignaalit
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  {topAffinityPreview.map((item, index) => (
                    <div key={`${item.query}-${index}`} className="flex items-center justify-between rounded-xl border border-border bg-background p-3">
                      <div className="min-w-0 mr-3">
                        <p className="text-sm font-medium text-foreground truncate">{item.query}</p>
                        <p className="text-xs text-muted-foreground truncate">{(() => { try { return new URL(item.url).pathname; } catch { return item.url; } })()}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{item.clicks} klik.</span>
                        <Badge variant={item.confidence >= 0.7 ? "default" : "secondary"} className="rounded-full">
                          {(item.confidence * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI suggestions for failed queries */}
          {Object.keys(pageSuggestions).length > 0 && (
            <Card className={panelClass}>
              <CardHeader className="border-b border-border pb-4">
                <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  AI-ehdotukset nollatuloshauille
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {Object.entries(pageSuggestions).map(([query, matches]) => (
                    <div key={query} className="rounded-xl border border-border bg-muted/25 p-3">
                      <p className="text-sm font-semibold text-foreground">{query}</p>
                      <div className="mt-2 space-y-1">
                        {matches.map((s, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                            <a href={s.url} target="_blank" rel="noopener" className="text-primary hover:underline">{s.title}</a>
                            <span className="text-muted-foreground">— {s.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Page Boost Breakdown */}
          {(() => {
            // Compute boost per page (mirrors search function logic)
            const boostMap: Record<string, PageBoost> = {};

            // GA boost: visitor-weighted key event rate → max +25, traffic → max +8
            if (gaPages.length > 0) {
              const totalPV = gaPages.reduce((s, p) => s + p.pageviews, 0) || 1;
              const maxPV = Math.max(...gaPages.map(p => p.pageviews), 1);
              const gaEntries = gaPages
                .filter(p => p.page_path !== "/" && p.pageviews > 0 && (p.conversions / p.pageviews) <= 1)
                .map(p => {
                  const keyEventRate = p.conversions / p.pageviews;
                  const pvWeight = p.pageviews / totalPV;
                  const weightedRate = keyEventRate * pvWeight;
                  return { ...p, weightedRate };
                });
              const maxWR = Math.max(...gaEntries.map(e => e.weightedRate), 0.0001);

              for (const p of gaEntries) {
                const normalizedWR = p.weightedRate / maxWR;
                const gaBoost = Math.round((normalizedWR * 25 + (p.pageviews / maxPV) * 8) * 10) / 10;
                if (gaBoost > 0.5) {
                  if (!boostMap[p.page_path]) boostMap[p.page_path] = { page_path: p.page_path, ga_boost: 0, ctr_boost: 0, popularity_boost: 0, total_boost: 0, reasons: [] };
                  boostMap[p.page_path].ga_boost = gaBoost;
                  boostMap[p.page_path].reasons.push(`GA: ${p.pageviews} katselua, ${p.conversions} key events`);
                }
              }
            }

            // High-CTR patterns → max +15
            for (const p of highCtrPatterns) {
              const path = (() => { try { return new URL(p.top_url).pathname; } catch { return p.top_url; } })();
              if (!boostMap[path]) boostMap[path] = { page_path: path, ga_boost: 0, ctr_boost: 0, popularity_boost: 0, total_boost: 0, reasons: [] };
              const ctrBoost = Math.round(Math.min(p.ctr * 20, 15) * 10) / 10;
              boostMap[path].ctr_boost = Math.max(boostMap[path].ctr_boost, ctrBoost);
              boostMap[path].reasons.push(`CTR: "${p.pattern}" ${(p.ctr * 100).toFixed(0)}% (${p.clicks} klik.)`);
            }

            // Popularity boost → max +10
            for (const [path, clicks] of Object.entries(popularityData)) {
              if (path === "/") continue;
              const popBoost = Math.round(Math.min(clicks * 0.5, 10) * 10) / 10;
              if (popBoost > 0.5) {
                if (!boostMap[path]) boostMap[path] = { page_path: path, ga_boost: 0, ctr_boost: 0, popularity_boost: 0, total_boost: 0, reasons: [] };
                boostMap[path].popularity_boost = popBoost;
                boostMap[path].reasons.push(`Suosio: ${clicks} klikkausta hauista`);
              }
            }

            // Calculate totals and sort
            const boosts = Object.values(boostMap)
              .map(b => ({ ...b, total_boost: Math.round((b.ga_boost + b.ctr_boost + b.popularity_boost) * 10) / 10 }))
              .filter(b => b.total_boost > 0)
              .sort((a, b) => b.total_boost - a.total_boost);

            if (boosts.length === 0) return null;

            return (
              <Card className={panelClass}>
                <CardHeader className="border-b border-border pb-4">
                  <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    Sivujen boostaus ({boosts.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <p className="mb-3 text-xs text-muted-foreground">
                    Hakutuloksia boostetaan automaattisesti Google Analytics -datan, klikkaushistorian ja CTR-mallien perusteella.
                  </p>
                  <div className="max-w-full overflow-x-auto">
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Sivu</TableHead>
                          <TableHead className="w-20 text-right">GA</TableHead>
                          <TableHead className="w-20 text-right">CTR</TableHead>
                          <TableHead className="w-20 text-right">Suosio</TableHead>
                          <TableHead className="w-20 text-right">Yhteensä</TableHead>
                          <TableHead>Perustelu</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {boosts.slice(0, 20).map((b) => (
                          <TableRow key={b.page_path}>
                            <TableCell className="max-w-[200px] truncate font-medium">{b.page_path}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {b.ga_boost > 0 ? <Badge variant="secondary" className="rounded-full">+{b.ga_boost}</Badge> : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {b.ctr_boost > 0 ? <Badge variant="secondary" className="rounded-full">+{b.ctr_boost}</Badge> : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {b.popularity_boost > 0 ? <Badge variant="secondary" className="rounded-full">+{b.popularity_boost}</Badge> : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="default" className="rounded-full">+{b.total_boost}</Badge>
                            </TableCell>
                            <TableCell className="max-w-[250px]">
                              <div className="space-y-0.5">
                                {b.reasons.map((r, i) => (
                                  <p key={i} className="text-xs text-muted-foreground truncate">{r}</p>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          <Card className={panelClass}>
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                Synonyymit ({synonyms.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {synonyms.length === 0 ? (
                <p className="text-sm italic text-muted-foreground">Ei synonyymejä vielä. Käytä "Opi synonyymit" -nappia.</p>
              ) : (
                <>
                  <div className="max-w-full overflow-x-auto">
                    <Table className="min-w-[600px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Hakulause</TableHead>
                          <TableHead>Synonyymi</TableHead>
                          <TableHead className="w-24 text-right">Luottamus</TableHead>
                          <TableHead className="w-20 text-right">Käytöt</TableHead>
                          <TableHead className="w-20 text-right">Toiminnot</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {synonyms.slice(synonymPage * QUERIES_PER_PAGE, (synonymPage + 1) * QUERIES_PER_PAGE).map((s) => (
                          <TableRow key={s.id}>
                            {editingSynonym === s.id ? (
                              <>
                                <TableCell>
                                  <input className="w-full rounded border border-border bg-background px-2 py-1 text-sm" value={editForm.query_from} onChange={(e) => setEditForm((f) => ({ ...f, query_from: e.target.value }))} />
                                </TableCell>
                                <TableCell>
                                  <input className="w-full rounded border border-border bg-background px-2 py-1 text-sm" value={editForm.query_to} onChange={(e) => setEditForm((f) => ({ ...f, query_to: e.target.value }))} />
                                </TableCell>
                                <TableCell className="text-right">
                                  <Badge variant={s.confidence >= 0.7 ? "default" : "secondary"}>{(s.confidence * 100).toFixed(0)}%</Badge>
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">{s.times_used}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => saveEdit(s.id)}><Check className="h-3.5 w-3.5 text-primary" /></Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingSynonym(null)}><X className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                                  </div>
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="font-medium">{s.query_from}</TableCell>
                                <TableCell>{s.query_to}</TableCell>
                                <TableCell className="text-right">
                                  <Badge variant={s.confidence >= 0.7 ? "default" : "secondary"}>{(s.confidence * 100).toFixed(0)}%</Badge>
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">{s.times_used}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(s)}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteSynonym(s.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                                  </div>
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {(() => {
                    const totalSynPages = Math.ceil(synonyms.length / QUERIES_PER_PAGE);
                    return totalSynPages > 1 ? (
                      <div className="flex items-center justify-between pt-3">
                        <span className="text-xs text-muted-foreground">
                          {synonymPage * QUERIES_PER_PAGE + 1}–{Math.min((synonymPage + 1) * QUERIES_PER_PAGE, synonyms.length)} / {synonyms.length}
                        </span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={synonymPage === 0} onClick={() => setSynonymPage(synonymPage - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={synonymPage >= totalSynPages - 1} onClick={() => setSynonymPage(synonymPage + 1)}><ChevronRight className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    ) : null;
                  })()}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
