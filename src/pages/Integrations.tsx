import { useEffect, useState } from "react";
import { ShoppingBag, TrendingUp, Store, ExternalLink, CheckCircle2, AlertCircle, Upload, BarChart3, MousePointerClick, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";
import { toast } from "sonner";

type IntegrationStatus = "not_connected" | "connected" | "coming_soon";

interface GAConfig {
  siteId: string;
  siteName: string;
  gaPropertyId: string | null;
  pagesWithData: number;
}

export default function Integrations() {
  const [sites, setSites] = useState<any[]>([]);
  const [gaConfigs, setGaConfigs] = useState<GAConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingGA, setEditingGA] = useState<string | null>(null);
  const [gaInput, setGaInput] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const sitesData = await api.listSites();
      setSites(sitesData);

      // Load GA config for each site
      const configs: GAConfig[] = [];
      for (const site of sitesData) {
        const { data: siteRow } = await supabase
          .from("sites")
          .select("ga_property_id" as any)
          .eq("id", site.id)
          .single();

        const { count } = await supabase
          .from("page_analytics" as any)
          .select("*", { count: "exact", head: true })
          .eq("site_id", site.id);

        configs.push({
          siteId: site.id,
          siteName: site.name,
          gaPropertyId: (siteRow as any)?.ga_property_id || null,
          pagesWithData: count || 0,
        });
      }
      setGaConfigs(configs);
    } catch (e: any) {
      toast.error("Virhe ladattaessa: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveGAProperty(siteId: string) {
    try {
      const { error } = await supabase
        .from("sites")
        .update({ ga_property_id: gaInput.trim() || null } as any)
        .eq("id", siteId);
      if (error) throw new Error(error.message);
      toast.success("GA Property ID tallennettu");
      setEditingGA(null);
      await loadData();
    } catch (e: any) {
      toast.error("Tallennus epäonnistui: " + e.message);
    }
  }

  const gaStatus: IntegrationStatus = gaConfigs.some(c => c.gaPropertyId) ? "connected" : "not_connected";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Integraatiot</h1>
        <p className="text-sm text-muted-foreground">
          Yhdistä ulkoiset palvelut FindAI-hakuun
        </p>
      </div>

      {/* Google Analytics — Full featured */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <TrendingUp className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <CardTitle className="text-base">Google Analytics</CardTitle>
                <CardDescription className="text-xs">
                  Tunnista parhaiten konvertoivat sivut ja buustaa niitä haussa
                </CardDescription>
              </div>
            </div>
            <Badge variant={gaStatus === "connected" ? "default" : "secondary"} className="text-[10px]">
              {gaStatus === "connected" ? (
                <><CheckCircle2 className="mr-1 h-3 w-3" /> Yhdistetty</>
              ) : "Ei yhdistetty"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/50 p-4">
            <h4 className="mb-2 text-sm font-medium">Miten integraatio toimii?</h4>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <BarChart3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" />
                <span><strong>Kävijämäärät:</strong> Eniten kävijöitä saavat sivut nousevat hakutuloksissa</span>
              </li>
              <li className="flex items-start gap-2">
                <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                <span><strong>Konversiot:</strong> Key event -sivut (yhteydenotot, ostot) saavat voimakkaan buustin</span>
              </li>
              <li className="flex items-start gap-2">
                <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span><strong>Konversioprosentti:</strong> Tehokkaimmin konvertoivat sivut korostuvat</span>
              </li>
            </ul>
          </div>

          <Separator />

          {/* Per-site GA config */}
          {loading ? (
            <p className="text-sm text-muted-foreground">Ladataan...</p>
          ) : sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">Lisää ensin sivusto Sites-sivulta.</p>
          ) : (
            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground">Sivukohtaiset asetukset</Label>
              {gaConfigs.map((config) => (
                <div key={config.siteId} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{config.siteName}</p>
                      {config.gaPropertyId ? (
                        <p className="text-xs text-muted-foreground">
                          Property: <code className="rounded bg-muted px-1">{config.gaPropertyId}</code>
                          {config.pagesWithData > 0 && (
                            <span className="ml-2 text-green-600">• {config.pagesWithData} sivua datalla</span>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Ei yhdistetty</p>
                      )}
                    </div>
                    {editingGA === config.siteId ? (
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="G-XXXXXXXXXX tai 123456789"
                          value={gaInput}
                          onChange={(e) => setGaInput(e.target.value)}
                          className="h-8 w-48 text-xs"
                        />
                        <Button size="sm" className="h-8 text-xs" onClick={() => saveGAProperty(config.siteId)}>
                          Tallenna
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditingGA(null)}>
                          Peruuta
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => {
                          setEditingGA(config.siteId);
                          setGaInput(config.gaPropertyId || "");
                        }}
                      >
                        {config.gaPropertyId ? "Muokkaa" : "Yhdistä"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-xs text-amber-800 dark:text-amber-200">
              <strong>Vaihe 1:</strong> Syötä GA Property ID. <strong>Vaihe 2:</strong> Lataa analytiikkadata CSV-tiedostona (tulossa). 
              Tällä hetkellä voit lisätä datan manuaalisesti tietokantaan.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shopify & WooCommerce — Coming soon */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col opacity-75">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                </div>
                <CardTitle className="text-base">Shopify</CardTitle>
              </div>
              <Badge variant="secondary" className="text-[10px]">Tulossa pian</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Synkronoi tuotteet, hinnat ja varastotilanne Shopify-kaupastasi hakuun.
            </p>
            <Button variant="outline" size="sm" disabled className="w-full gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" />
              Yhdistä
            </Button>
          </CardContent>
        </Card>

        <Card className="flex flex-col opacity-75">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Store className="h-5 w-5 text-muted-foreground" />
                </div>
                <CardTitle className="text-base">WooCommerce</CardTitle>
              </div>
              <Badge variant="secondary" className="text-[10px]">Tulossa pian</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Tuo WooCommerce-tuotekatalogi automaattisesti hakuindeksiin.
            </p>
            <Button variant="outline" size="sm" disabled className="w-full gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" />
              Yhdistä
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
