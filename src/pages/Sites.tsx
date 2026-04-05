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
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-primary/50" />
        <span className="ml-2.5 text-sm text-muted-foreground">Loading sites...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your indexed websites</p>
        </div>
        <Button asChild className="rounded-lg">
          <Link to="/add-site">
            <Plus className="mr-1.5 h-4 w-4" />
            Add Site
          </Link>
        </Button>
      </div>

      {sites.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/60 py-24">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/8">
            <Globe className="h-7 w-7 text-primary/60" />
          </div>
          <h3 className="mb-1.5 text-lg font-semibold">No sites yet</h3>
          <p className="mb-7 text-sm text-muted-foreground">
            Add a site to start indexing and searching.
          </p>
          <Button asChild className="rounded-lg">
            <Link to="/add-site">Add Your First Site</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {sites.map((site) => (
            <div
              key={site.id}
              className="group rounded-xl border border-border/70 bg-card shadow-sm transition-all duration-200 hover:border-border hover:shadow-md"
            >
              {/* Site info row */}
              <div className="flex items-center gap-4 px-5 py-4">
                {/* Icon */}
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/8">
                  <Globe className="h-5 w-5 text-primary/70" />
                </div>

                {/* Name + domain */}
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold leading-tight truncate">
                    {site.name}
                  </h3>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground truncate">{site.domain}</span>
                    <a
                      href={`https://${site.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground/30 hover:text-primary transition-colors duration-150"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>

                {/* Status + page count + delete */}
                <div className="flex items-center gap-3 shrink-0">
                  <span className="hidden sm:block text-xs text-muted-foreground/60">
                    {site.page_count} pages
                  </span>
                  <Badge
                    variant={site.is_active ? "default" : "secondary"}
                    className="text-[10px] px-2.5 py-0.5 rounded-full"
                  >
                    {site.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100 transition-all duration-150"
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
              <div className="flex items-center gap-0.5 border-t border-border/40 px-3 py-2 bg-muted/30">
                {NAV_ITEMS.map(({ label, icon: Icon, path }) => (
                  <Link
                    key={path}
                    to={`/sites/${site.id}/${path}`}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground/70 transition-all duration-150 hover:bg-background hover:text-foreground hover:shadow-sm"
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
