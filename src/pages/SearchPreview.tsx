import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Site } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Copy, Check, Search, MousePointerClick, SearchIcon } from "lucide-react";

type EmbedMode = "inline" | "floating" | "header-icon";

const EMBED_MODES: { value: EmbedMode; label: string; icon: typeof Search; description: string }[] = [
  { value: "inline", label: "Header-haku", icon: Search, description: "Hakukenttä upotetaan suoraan sivun headeriin tai sisältöön" },
  { value: "floating", label: "Kelluva nappi", icon: MousePointerClick, description: "Kelluva \"Hae\"-nappi avaa hakumodaalin" },
  { value: "header-icon", label: "Hakuikoni", icon: SearchIcon, description: "Hakuikoni upotetaan headeriin — klikkaus avaa overlay-haun" },
];

function getSnippet(mode: EmbedMode, siteId: string) {
  if (mode === "inline") {
    return `<div id="findai-search"></div>
<script
  src="YOUR_DOMAIN/widget.js"
  data-site-id="${siteId}"
  data-position="inline"
  data-inline-target="#findai-search">
</script>`;
  }
  if (mode === "floating") {
    return `<script
  src="YOUR_DOMAIN/widget.js"
  data-site-id="${siteId}"
  data-position="bottom-right">
</script>`;
  }
  return `<div id="findai-search"></div>
<script
  src="YOUR_DOMAIN/widget.js"
  data-site-id="${siteId}"
  data-position="header-icon"
  data-inline-target="#findai-search">
</script>`;
}

export default function SearchPreview() {
  const { siteId } = useParams();
  const [site, setSite] = useState<Site | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeMode, setActiveMode] = useState<EmbedMode>("inline");
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetScriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    if (!siteId) return;
    api.getSite(siteId).then(setSite).catch(() => {});
  }, [siteId]);

  const loadWidget = useCallback((mode: EmbedMode) => {
    if (!siteId) return;

    // Clean up previous widget
    if (widgetScriptRef.current) {
      widgetScriptRef.current.remove();
      widgetScriptRef.current = null;
    }
    const existingHost = document.getElementById("findai-host");
    if (existingHost) existingHost.remove();

    const script = document.createElement("script");
    script.src = "/widget.js";
    script.setAttribute("data-site-id", siteId);
    script.setAttribute("data-supabase-url", import.meta.env.VITE_SUPABASE_URL || "");
    script.setAttribute("data-supabase-key", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "");

    if (mode === "inline") {
      script.setAttribute("data-position", "inline");
      script.setAttribute("data-inline-target", "#findai-preview-container");
    } else if (mode === "header-icon") {
      script.setAttribute("data-position", "header-icon");
      script.setAttribute("data-inline-target", "#findai-preview-container");
    } else {
      script.setAttribute("data-position", "fullscreen");
    }

    document.body.appendChild(script);
    widgetScriptRef.current = script;
  }, [siteId]);

  // Load widget on mount and mode change
  useEffect(() => {
    loadWidget(activeMode);
    return () => {
      if (widgetScriptRef.current) {
        widgetScriptRef.current.remove();
        widgetScriptRef.current = null;
      }
      const host = document.getElementById("findai-host");
      if (host) host.remove();
    };
  }, [activeMode, loadWidget]);

  function copySnippet() {
    const snippet = getSnippet(activeMode, siteId || "");
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleModeChange(mode: string) {
    setActiveMode(mode as EmbedMode);
  }

  return (
    <div className="mx-auto max-w-2xl px-1 sm:px-0">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
            {site?.name || "Hakuwidget"}
          </h1>
          <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{site?.domain}</p>
        </div>
        <Button variant="ghost" size="sm" className="cursor-pointer shrink-0 text-xs sm:text-sm" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-3 w-3 sm:h-3.5 sm:w-3.5" />
            Takaisin
          </Link>
        </Button>
      </div>

      {/* Embed mode tabs */}
      <Tabs value={activeMode} onValueChange={handleModeChange} className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-4">
          {EMBED_MODES.map((mode) => {
            const Icon = mode.icon;
            return (
              <TabsTrigger key={mode.value} value={mode.value} className="gap-1.5 text-xs sm:text-sm">
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{mode.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {EMBED_MODES.map((mode) => (
          <TabsContent key={mode.value} value={mode.value}>
            <p className="text-xs text-muted-foreground mb-4">{mode.description}</p>

            {/* Inline / header-icon preview container */}
            {(mode.value === "inline" || mode.value === "header-icon") && (
              <div id="findai-preview-container" ref={containerRef} className="min-h-[60px]" />
            )}

            {/* Floating hint */}
            {mode.value === "floating" && (
              <Card className="border-dashed border-border/50">
                <CardContent className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Kelluva "Hae"-nappi näkyy oikeassa alakulmassa →
                  </p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">
                    Klikkaa nappia testataksesi
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Embed snippet */}
            <Card className="mt-6 border-border/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Upotuskoodi
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    {getSnippet(mode.value, siteId || "")}
                  </pre>
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
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
