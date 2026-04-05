import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api, Site, CrawlJob } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Globe, Plus, BarChart3, Search, RefreshCw, Loader2, Settings, ShoppingBag, TrendingUp, Store, Plug, Trash2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Sites() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState<Record<string, boolean>>({});
  const [jobStatus, setJobStatus] = useState<Record<string, CrawlJob>>({});

  const loadSites = useCallback(async () => {
    try {
      const data = await api.listSites();
      setSites(data);
    } catch (e: any) {
      toast.error("Failed to load sites: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSites();
  }, [loadSites]);


  async function triggerCrawl(site: Site) {
    setCrawling((prev) => ({ ...prev, [site.id]: true }));
    try {
      const job = await api.triggerCrawl(site.id);
      pollJob(site.id, job.job_id as string);
    } catch (e: any) {
      toast.error("Crawl failed: " + e.message);
      setCrawling((prev) => ({ ...prev, [site.id]: false }));
    }
  }

  function pollJob(siteId: string, jobId: string) {
    const interval = setInterval(async () => {
      try {
        const status = await api.getCrawlJob(jobId);
        setJobStatus((prev) => ({ ...prev, [siteId]: status }));

        if (["done", "done_with_errors", "failed"].includes(status.status)) {
          clearInterval(interval);
          setCrawling((prev) => ({ ...prev, [siteId]: false }));
          toast.success(`Crawl finished: ${status.pages_indexed} pages indexed`);
          await loadSites();
        }
      } catch {
        clearInterval(interval);
        setCrawling((prev) => ({ ...prev, [siteId]: false }));
      }
    }, 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading sites...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
          <p className="text-sm text-muted-foreground">Manage indexed websites</p>
        </div>
        <Button asChild>
          <Link to="/add-site">
            <Plus className="mr-1 h-4 w-4" />
            Add Site
          </Link>
        </Button>
      </div>

      {sites.length === 0 ? (
        <Card className="py-16 text-center">
          <CardContent>
            <Globe className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">No sites yet</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              Add a site to start indexing.
            </p>
            <Button asChild>
              <Link to="/add-site">Add Your Site</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => {
            const job = jobStatus[site.id];
            const isCrawling = crawling[site.id];
            const crawlProgress =
              job && job.pages_found
                ? Math.round((job.pages_indexed / job.pages_found) * 100)
                : 0;

            return (
              <Card key={site.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{site.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{site.domain}</p>
                    </div>
                    <Badge variant={site.is_active ? "default" : "secondary"}>
                      {site.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="pb-3">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div>
                      <div className="text-lg font-semibold">{site.page_count}</div>
                      <div className="text-xs text-muted-foreground">Pages</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold">
                        {site.last_crawled_at
                          ? new Date(site.last_crawled_at).toLocaleDateString()
                          : "Never"}
                      </div>
                      <div className="text-xs text-muted-foreground">Last crawl</div>
                    </div>
                  </div>

                  {isCrawling && (
                    <div className="mt-3 space-y-1">
                      <Progress value={crawlProgress || 5} className="h-2" />
                      <p className="text-xs text-muted-foreground">
                        {job
                          ? job.pages_found > 0
                            ? `${job.pages_indexed}/${job.pages_found} pages indexed`
                            : "Discovering pages from sitemap..."
                          : "Starting crawl..."}
                      </p>
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                    <span>API Key:</span>
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                      {site.api_key.slice(0, 12)}...
                    </code>
                  </div>
                </CardContent>

                <CardContent className="pb-3 pt-0">
                  <Separator className="mb-3" />
                  <div className="flex items-center gap-1.5 mb-2">
                    <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Integrations</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1" disabled>
                      <ShoppingBag className="h-3 w-3" />
                      Shopify
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1" disabled>
                      <TrendingUp className="h-3 w-3" />
                      Google Analytics
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-[11px] gap-1" disabled>
                      <Store className="h-3 w-3" />
                      WooCommerce
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">Tulossa pian</p>
                </CardContent>

                <CardFooter className="flex-wrap gap-1.5 pt-0">
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
                    <Link to={`/sites/${site.id}/analytics`}>
                      <BarChart3 className="mr-1 h-3 w-3" />
                      Analytics
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
                    <Link to={`/sites/${site.id}/search`}>
                      <Search className="mr-1 h-3 w-3" />
                      Test
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
                    <Link to={`/sites/${site.id}/settings`}>
                      <Settings className="mr-1 h-3 w-3" />
                      Settings
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
                    <Link to={`/sites/${site.id}/integrations`}>
                      <Plug className="mr-1 h-3 w-3" />
                      Integrations
                    </Link>
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="ml-auto h-8 px-2 text-xs"
                    onClick={() => triggerCrawl(site)}
                    disabled={isCrawling}
                  >
                    {isCrawling ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3 w-3" />
                    )}
                    {isCrawling ? "Crawling..." : "Re-crawl"}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
