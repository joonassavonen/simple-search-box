import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api, Site } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, Plus, BarChart3, Search, RefreshCw, Loader2, Settings, Plug, Trash2, ExternalLink } from "lucide-react";
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

const NAV_ITEMS = [
  { label: "Settings", icon: Settings, path: "settings" },
  { label: "Analytics", icon: BarChart3, path: "analytics" },
  { label: "Integrations", icon: Plug, path: "integrations" },
  { label: "Test & Design", icon: Search, path: "search" },
  { label: "Crawl", icon: RefreshCw, path: "crawl" },
] as const;

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
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
          <p className="text-sm text-muted-foreground">Manage indexed websites</p>
        </div>
        <Button asChild>
          <Link to="/add-site">
            <Plus className="mr-1.5 h-4 w-4" />
            Add Site
          </Link>
        </Button>
      </div>

      {sites.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-20">
          <div className="mb-4 rounded-full bg-muted p-4">
            <Globe className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="mb-1 text-lg font-semibold">No sites yet</h3>
          <p className="mb-6 text-sm text-muted-foreground">
            Add a site to start indexing.
          </p>
          <Button asChild>
            <Link to="/add-site">Add Your Site</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {sites.map((site) => (
            <div
              key={site.id}
              className="group rounded-xl border border-border bg-card transition-all hover:shadow-md"
            >
              {/* Top row: site info + badge + delete */}
              <div className="flex items-center gap-4 px-5 py-4">
                {/* Favicon / icon */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5">
                  <Globe className="h-5 w-5 text-primary/70" />
                </div>

                {/* Site name + domain */}
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold leading-tight text-foreground truncate">
                    {site.name}
                  </h3>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground truncate">{site.domain}</span>
                    <a
                      href={`https://${site.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground/40 hover:text-primary transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>

                {/* Status + delete */}
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant={site.is_active ? "default" : "secondary"}
                    className="text-[10px] px-2 py-0.5"
                  >
                    {site.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      >
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
                        <AlertDialogAction
                          onClick={() => deleteSite(site)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              {/* Navigation row */}
              <div className="flex items-center gap-1 border-t border-border/50 px-4 py-2">
                {NAV_ITEMS.map(({ label, icon: Icon, path }) => (
                  <Link
                    key={path}
                    to={`/sites/${site.id}/${path}`}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
