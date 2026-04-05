import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api, Site } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Plus, BarChart3, Search, RefreshCw, Loader2, Settings, Plug, Trash2 } from "lucide-react";
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




  async function deleteSite(site: Site) {
    try {
      await api.deleteSite(site.id);
      toast.success(`${site.name} deleted`);
      await loadSites();
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    }
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

            return (
              <Card key={site.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{site.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{site.domain}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={site.is_active ? "default" : "secondary"}>
                        {site.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {site.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the site, all indexed pages, and search data. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteSite(site)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
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


                </CardContent>


                <CardFooter className="flex-wrap gap-1.5 pt-0">
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
                    <Link to={`/sites/${site.id}/settings`}>
                      <Settings className="mr-1 h-3 w-3" />
                      Settings
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
                    <Link to={`/sites/${site.id}/analytics`}>
                      <BarChart3 className="mr-1 h-3 w-3" />
                      Analytics
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
                    <Link to={`/sites/${site.id}/integrations`}>
                      <Plug className="mr-1 h-3 w-3" />
                      Integrations
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
                    <Link to={`/sites/${site.id}/search`}>
                      <Search className="mr-1 h-3 w-3" />
                      Test & Design
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
                    {isCrawling ? "Crawling..." : "Crawl"}
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
