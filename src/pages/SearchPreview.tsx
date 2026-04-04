import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Site } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Copy, Check } from "lucide-react";

export default function SearchPreview() {
  const { siteId } = useParams();
  const [site, setSite] = useState<Site | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!siteId) return;
    api.getSite(siteId).then(setSite).catch(() => {});
  }, [siteId]);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
  const apiUrl = supabaseUrl ? `${supabaseUrl}/functions/v1` : "";
  const iframeSrc = `/widget-preview.html?siteId=${siteId}&apiUrl=${encodeURIComponent(apiUrl)}`;

  function copySnippet() {
    const snippet = `<script\n  src="YOUR_DOMAIN/widget.js"\n  data-site-id="${siteId}"\n  data-api-url="${apiUrl}">\n</script>`;
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {site?.name || "Widget-esikatselu"}
          </h1>
          <p className="text-xs text-muted-foreground">{site?.domain}</p>
        </div>
        <Button variant="ghost" size="sm" className="cursor-pointer" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Takaisin
          </Link>
        </Button>
      </div>

      {/* Widget preview iframe */}
      <div className="overflow-hidden rounded-xl border border-border/50 shadow-lg bg-background">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-border/30 bg-muted/30 px-4 py-2.5">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-400/60" />
            <div className="h-3 w-3 rounded-full bg-yellow-400/60" />
            <div className="h-3 w-3 rounded-full bg-green-400/60" />
          </div>
          <div className="ml-4 flex-1 rounded-md bg-background/80 px-3 py-1 text-xs text-muted-foreground truncate">
            {site?.domain || "esimerkki.fi"}
          </div>
        </div>
        <iframe
          src={iframeSrc}
          className="w-full border-0"
          style={{ height: "600px" }}
          title="Widget preview"
        />
      </div>

      {/* Widget snippet */}
      <Card className="mt-6 border-border/30">
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
  data-api-url="${apiUrl}">
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
