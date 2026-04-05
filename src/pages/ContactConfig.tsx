import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, ContactConfig as ContactConfigType, Site } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Save, Copy, Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export default function ContactConfig() {
  const { siteId } = useParams();
  const [site, setSite] = useState<Site | null>(null);
  const [config, setConfig] = useState<ContactConfigType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [s, c] = await Promise.all([
          api.getSite(siteId!),
          api.getContactConfig(siteId!),
        ]);
        setSite(s);
        setConfig(c);
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [siteId]);

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await api.updateContactConfig(siteId!, config);
      setConfig(updated);
      toast.success("Contact config saved!");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  function update(field: string, value: string | boolean) {
    setConfig((c) => (c ? { ...c, [field]: value } : c));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config) return null;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contact Settings</h1>
          <p className="text-sm text-muted-foreground">
            {site?.name} — Zero-result contact buttons
          </p>
        </div>
        <Button variant="ghost" asChild>
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Contact CTA</span>
            <div className="flex items-center gap-2">
              <Label htmlFor="enabled" className="text-sm font-normal text-muted-foreground">
                {config.enabled ? "Enabled" : "Disabled"}
              </Label>
              <Switch
                id="enabled"
                checked={config.enabled}
                onCheckedChange={(v) => update("enabled", v)}
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              placeholder="support@example.fi"
              value={config.email || ""}
              onChange={(e) => update("email", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Phone</Label>
            <Input
              type="tel"
              placeholder="+358 800 12345"
              value={config.phone || ""}
              onChange={(e) => update("phone", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Chat URL</Label>
            <Input
              type="url"
              placeholder="https://chat.example.fi"
              value={config.chat_url || ""}
              onChange={(e) => update("chat_url", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>CTA Text (Finnish)</Label>
            <Textarea
              value={config.cta_text_fi}
              onChange={(e) => update("cta_text_fi", e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>CTA Text (English)</Label>
            <Textarea
              value={config.cta_text_en}
              onChange={(e) => update("cta_text_en", e.target.value)}
              rows={2}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
