import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export default function SearchPreview() {
  const { siteId } = useParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [siteName, setSiteName] = useState("");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  // Load site name
  useEffect(() => {
    if (!siteId) return;
    api.getSite(siteId).then((s) => setSiteName(s.name)).catch(() => {});
  }, [siteId]);

  // Inject widget.js into the preview container
  useEffect(() => {
    if (!siteId || !containerRef.current) return;

    // Clean previous widget
    containerRef.current.innerHTML = "";

    // Set config for widget (since dynamically injected scripts can't use document.currentScript)
    (window as any).__FINDAI_CONFIG = {
      siteId: siteId,
      apiUrl: supabaseUrl + "/functions/v1",
      position: "inline",
      inlineTarget: "#findai-preview-target",
    };

    // Create target div for inline mode
    const target = document.createElement("div");
    target.id = "findai-preview-target";
    containerRef.current.appendChild(target);

    const script = document.createElement("script");
    script.src = "/widget/widget.js";
    containerRef.current.appendChild(script);

    return () => {
      // Cleanup: remove widget elements
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      // Remove any floating widget elements the script may have added to body
      document.querySelectorAll("[data-findai-widget]").forEach((el) => el.remove());
    };
  }, [siteId, supabaseUrl]);

  function copySnippet() {
    const snippet = `<script
  src="YOUR_DOMAIN/widget.js"
  data-site-id="${siteId}"
  data-api-url="${supabaseUrl}/functions/v1">
</script>`;
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!siteId) {
    return <p className="text-muted-foreground">Site ID puuttuu.</p>;
  }

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-4 -ml-2 h-8 gap-1 text-xs text-muted-foreground" asChild>
        <Link to="/"><ArrowLeft className="h-3.5 w-3.5" /> Takaisin</Link>
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Haun esikatselu</h1>
        {siteName && (
          <p className="text-sm text-muted-foreground">{siteName}</p>
        )}
      </div>

      {/* Widget preview area */}
      <Card className="mb-8">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Live-esikatselu</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={containerRef}
            className="min-h-[200px] rounded-lg border border-dashed border-border/50 bg-white p-4"
          />
        </CardContent>
      </Card>

      {/* Widget snippet */}
      <Card className="border-border/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Upotuskoodi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">{`<script
  src="YOUR_DOMAIN/widget.js"
  data-site-id="${siteId}"
  data-api-url="${supabaseUrl}/functions/v1">
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
