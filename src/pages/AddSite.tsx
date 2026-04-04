import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Site } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function AddSite() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", domain: "", sitemap_url: "" });
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<Site | null>(null);
  const [crawlStarted, setCrawlStarted] = useState(false);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));

    if (field === "domain" && value && !form.sitemap_url) {
      const domain = value.replace(/^https?:\/\//, "").replace(/\/$/, "");
      setForm((f) => ({
        ...f,
        domain,
        sitemap_url: `https://${domain}/sitemap.xml`,
        name: f.name || domain,
      }));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const site = await api.createSite({
        name: form.name,
        domain: form.domain.replace(/^https?:\/\//, "").replace(/\/$/, ""),
        sitemap_url: form.sitemap_url || undefined,
      });
      setCreated(site);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function startCrawl() {
    if (!created) return;
    setCrawlStarted(true);
    await api.triggerCrawl(created.id);
    navigate("/");
  }

  if (created) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Site Created</h1>
        <Card className="max-w-lg">
          <CardContent className="pt-6">
            <div className="mb-4 flex justify-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
            <h3 className="mb-4 text-center text-lg font-semibold">
              {created.name} is registered!
            </h3>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span className="text-muted-foreground">Site ID</span>
                <code className="font-mono">{created.id}</code>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span className="text-muted-foreground">API Key</span>
                <code className="break-all font-mono text-xs">{created.api_key}</code>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span className="text-muted-foreground">Domain</span>
                <span>{created.domain}</span>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Save your API key</strong> — it won't be shown again.
              </span>
            </div>

            <div className="mt-5">
              <h4 className="mb-2 text-sm font-medium">Widget snippet</h4>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{`<script
  src="YOUR_API_URL/widget.js"
  data-site-id="${created.id}"
  data-api-url="YOUR_API_URL">
</script>`}</pre>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button variant="outline" onClick={() => navigate("/")}>
              Skip crawl for now
            </Button>
            <Button onClick={startCrawl} disabled={crawlStarted}>
              {crawlStarted ? "Crawl started..." : "Start Crawl Now"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Add Site</h1>
        <p className="text-sm text-muted-foreground">
          Register a new website for AI-powered search
        </p>
      </div>

      <Card className="max-w-lg">
        <form onSubmit={submit}>
          <CardHeader>
            <CardTitle>Site Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="domain">Domain *</Label>
              <Input
                id="domain"
                placeholder="helen.fi"
                value={form.domain}
                onChange={(e) => set("domain", e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Just the domain, e.g. helen.fi or example.com
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Site Name *</Label>
              <Input
                id="name"
                placeholder="Helen"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sitemap">Sitemap URL</Label>
              <Input
                id="sitemap"
                type="url"
                placeholder="https://helen.fi/sitemap.xml"
                value={form.sitemap_url}
                onChange={(e) => set("sitemap_url", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to auto-discover at /sitemap.xml
              </p>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => navigate("/")}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Registering..." : "Register Site"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
