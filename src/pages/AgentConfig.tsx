import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Bot, Save, Check } from "lucide-react";
import { toast } from "sonner";

export default function AgentConfig() {
  const { siteId } = useParams();
  const [siteName, setSiteName] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!siteId || !supabase) return;
    supabase
      .from("sites")
      .select("name, agent_prompt")
      .eq("id", siteId)
      .single()
      .then(({ data }) => {
        if (data) {
          setSiteName(data.name);
          setAgentPrompt((data as any).agent_prompt || "");
        }
      });
  }, [siteId]);

  async function handleSave() {
    if (!siteId || !supabase) return;
    setSaving(true);
    const { error } = await supabase
      .from("sites")
      .update({ agent_prompt: agentPrompt } as any)
      .eq("id", siteId);
    setSaving(false);
    if (error) {
      toast.error("Tallennus epäonnistui");
    } else {
      setSaved(true);
      toast.success("Agentin ohjeistus tallennettu");
      setTimeout(() => setSaved(false), 2000);
    }
  }

  const SNIPPET = `<div id="findai-search"></div>
<script
  src="https://findaisearch.lovable.app/widget.js"
  data-site-id="${siteId || "SITE_ID"}"
  data-mode="agent"
  data-position="inline"
  data-inline-target="#findai-search"
  data-supabase-url="${import.meta.env.VITE_SUPABASE_URL || ""}"
  data-supabase-key="${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ""}">
</script>`;

  return (
    <div className="mx-auto max-w-2xl px-1 sm:px-0">
      <div className="mb-4 sm:mb-6 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            AI-agentti
          </h1>
          <p className="text-[11px] sm:text-xs text-muted-foreground">{siteName}</p>
        </div>
        <Button variant="ghost" size="sm" className="cursor-pointer shrink-0 text-xs sm:text-sm" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-3 w-3" />
            Takaisin
          </Link>
        </Button>
      </div>

      <Card className="border-border/30 mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Agentin ohjeistus (System Prompt)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Kirjoita ohjeet, joiden mukaan AI-agentti toimii. Agentti käyttää automaattisesti sivuston sisältöä, 
            analytiikkaa ja yhteystietoja kontekstina. Tämä ohjeistus antaa lisäkontekstin.
          </p>
          <Textarea
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            placeholder={`Esim:\n- Olet Yritys Oy:n myyntineuvoja\n- Suosittele aina premium-tuotteita ensisijaisesti\n- Tarjoa aina mahdollisuus varata esittely\n- Mainitse aina ilmainen toimitus yli 100€ tilauksissa`}
            className="min-h-[180px] text-sm"
          />
          <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
            {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "Tallennetaan..." : saved ? "Tallennettu" : "Tallenna"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Agentti-widgetin upotuskoodi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Lisää tämä koodi sivustollesi aktivoidaksesi keskustelevan AI-agentin perinteisen haun tilalle.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {SNIPPET}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
