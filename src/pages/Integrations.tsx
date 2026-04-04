import { ShoppingBag, TrendingUp, Store, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const INTEGRATIONS = [
  {
    id: "shopify",
    name: "Shopify",
    description: "Synkronoi tuotteet, hinnat ja varastotilanne Shopify-kaupastasi hakuun.",
    icon: ShoppingBag,
    status: "coming_soon" as const,
  },
  {
    id: "google_analytics",
    name: "Google Analytics",
    description: "Yhdistä hakuanalytiikka Google Analytics -tilillesi syvempää raportointia varten.",
    icon: TrendingUp,
    status: "coming_soon" as const,
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    description: "Tuo WooCommerce-tuotekatalogi automaattisesti hakuindeksiin.",
    icon: Store,
    status: "coming_soon" as const,
  },
];

export default function Integrations() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Integraatiot</h1>
        <p className="text-sm text-muted-foreground">
          Yhdistä ulkoiset palvelut FindAI-hakuun
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((integration) => {
          const Icon = integration.icon;
          return (
            <Card key={integration.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <CardTitle className="text-base">{integration.name}</CardTitle>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    Tulossa pian
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <p className="text-sm text-muted-foreground">{integration.description}</p>
                <Button variant="outline" size="sm" disabled className="w-full gap-1.5">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Yhdistä
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
