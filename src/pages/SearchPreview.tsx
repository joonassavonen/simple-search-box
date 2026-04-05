import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Site } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Copy, Check } from "lucide-react";

export default function SearchPreview() {
  const { siteId } = useParams();
  const [site, setSite] = useState<Site | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetLoaded = useRef(false);

  useEffect(() => {
    if (!siteId) return;
    api.getSite(siteId).then(setSite).catch(() => {});
  }, [siteId]);

  // Load the widget script in inline mode
  useEffect(() => {
    if (!siteId || widgetLoaded.current) return;
    if (!containerRef.current) return;

    // Clean up any previous widget instance
    const existingHost = document.getElementById("findai-host");
    if (existingHost) existingHost.remove();

    const script = document.createElement("script");
    script.src = "/widget.js";
    script.setAttribute("data-site-id", siteId);
    script.setAttribute("data-position", "inline");
    script.setAttribute("data-inline-target", "#findai-preview-container");
    script.setAttribute("data-supabase-url", import.meta.env.VITE_SUPABASE_URL || "");
    script.setAttribute("data-supabase-key", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "");
    document.body.appendChild(script);
    widgetLoaded.current = true;

    return () => {
      script.remove();
      const host = document.getElementById("findai-host");
      if (host) host.remove();
      widgetLoaded.current = false;
    };
  }, [siteId]);

  function copySnippet() {
    const snippet = `<script\n  src="YOUR_API_URL/widget.js"\n  data-site-id="${siteId}"\n  data-api-url="YOUR_API_URL">\n</script>`;
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mx-auto max-w-2xl px-1 sm:px-0">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
            {site?.name || "Search Preview"}
          </h1>
          <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{site?.domain}</p>
        </div>
        <Button variant="ghost" size="sm" className="cursor-pointer shrink-0 text-xs sm:text-sm" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-3 w-3 sm:h-3.5 sm:w-3.5" />
            <span className="hidden sm:inline">Takaisin</span>
            <span className="sm:hidden">←</span>
          </Link>
        </Button>
      </div>

      {/* Widget container — the actual widget.js renders here */}
      <div id="findai-preview-container" ref={containerRef} className="min-h-[60px]" />

      {/* Widget snippet */}
      <Card className="mt-8 sm:mt-12 border-border/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Upotuskoodi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">{`<script
  src="YOUR_API_URL/widget.js"
  data-site-id="${siteId}"
  data-api-url="YOUR_API_URL">
</script>`}</pre>
            <Button
              variant="ghost"
              size="sm"
              onClick={copySnippet}
              className="absolute right-1 top-1 h-7 gap-1 text-[10px]"
            >
              {copied ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied ? "Kopioitu" : "Kopioi"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
