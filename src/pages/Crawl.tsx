import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Site, CrawlJob } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, RefreshCw, Loader2, CheckCircle, XCircle, Clock, Palette, Type } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function Crawl() {
  const { siteId } = useParams();
  const [site, setSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    if (!siteId) return;
    try {
      const [s, { data: jobs }] = await Promise.all([
        api.getSite(siteId),
        supabase
          .from("crawl_jobs")
          .select("*")
          .eq("site_id", siteId)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      setSite(s);
      setHistory(jobs || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function triggerCrawl() {
    if (!siteId) return;
    setCrawling(true);
    try {
      const newJob = await api.triggerCrawl(siteId);
      setJob(newJob);
      pollJob(newJob.job_id);
    } catch (e: any) {
      toast.error("Crawl failed: " + e.message);
      setCrawling(false);
    }
  }

  function pollJob(jobId: string) {
    const interval = setInterval(async () => {
      try {
        const status = await api.getCrawlJob(jobId);
        setJob(status);
        if (["done", "done_with_errors", "failed"].includes(status.status)) {
          clearInterval(interval);
          setCrawling(false);
          toast.success(`Crawl finished: ${status.pages_indexed} pages indexed`);
          await loadData();
        }
      } catch {
        clearInterval(interval);
        setCrawling(false);
      }
    }, 2000);
  }

  const crawlProgress =
    job && job.pages_found ? Math.round((job.pages_indexed / job.pages_found) * 100) : 0;

  const getHistorySummary = (entry: { status: string; pages_indexed: number; pages_found: number }) => {
    if (entry.status === "pending") return "Queued";
    if (entry.status === "discovering") return "Discovering pages...";
    if (entry.status === "crawling") {
      return entry.pages_found > 0
        ? `${entry.pages_indexed}/${entry.pages_found} pages indexed`
        : `${entry.pages_indexed} pages indexed`;
    }
    if (entry.pages_found > 0) {
      return `${entry.pages_indexed} pages indexed / ${entry.pages_found} found`;
    }
    return `${entry.pages_indexed} pages indexed`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Crawl</h1>
          <p className="text-sm text-muted-foreground">{site?.name} — {site?.domain}</p>
        </div>
        <Button variant="ghost" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Takaisin
          </Link>
        </Button>
      </div>

      {/* Crawl action */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Start Crawl</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {site?.page_count || 0} pages indexed
                {site?.last_crawled_at && (
                  <> · Last crawled {new Date(site.last_crawled_at).toLocaleDateString("fi-FI")}</>
                )}
              </p>
              {site?.sitemap_url && (
                <p className="mt-1 text-xs text-muted-foreground truncate max-w-md">
                  Sitemap: {site.sitemap_url}
                </p>
              )}
            </div>
            <Button onClick={triggerCrawl} disabled={crawling}>
              {crawling ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              {crawling ? "Crawling..." : "Start Crawl"}
            </Button>
          </div>

          {crawling && job && (
            <div className="space-y-2">
              <Progress value={crawlProgress || 5} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {job.pages_found > 0
                  ? `${job.pages_indexed}/${job.pages_found} pages indexed`
                  : "Discovering pages from sitemap..."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Crawl history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Crawl History</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No crawls yet.</p>
          ) : (
            <div className="space-y-3">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                  <div className="flex items-center gap-3">
                    {h.status === "done" ? (
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                    ) : h.status === "failed" ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Clock className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {getHistorySummary(h)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(h.created_at).toLocaleString("fi-FI")}
                      </p>
                    </div>
                  </div>
                  <Badge variant={h.status === "done" ? "default" : h.status === "failed" ? "destructive" : "secondary"}>
                    {h.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
