import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { hasSupabaseConfig, supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import DashboardLayout from "@/components/DashboardLayout";
import Sites from "./pages/Sites";
import AddSite from "./pages/AddSite";
import Analytics from "./pages/Analytics";
import SearchPreview from "./pages/SearchPreview";
import Auth from "./pages/Auth";
import ContactConfig from "./pages/ContactConfig";
import Integrations from "./pages/Integrations";
import Crawl from "./pages/Crawl";
import NotFound from "./pages/NotFound";
import AgentConfig from "./pages/AgentConfig";
import ResetPassword from "./pages/ResetPassword";

const queryClient = new QueryClient();

const App = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!hasSupabaseConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Supabase Config Missing</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
            {" "}in Lovable project environment variables so the app can initialize.
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Auth />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <DashboardLayout>
            <Routes>
              <Route path="/" element={<Sites />} />
              <Route path="/add-site" element={<AddSite />} />
              <Route path="/sites/:siteId/analytics" element={<Analytics />} />
              <Route path="/sites/:siteId/search" element={<SearchPreview />} />
              <Route path="/sites/:siteId/settings" element={<ContactConfig />} />
              <Route path="/sites/:siteId/integrations" element={<Integrations />} />
              <Route path="/sites/:siteId/crawl" element={<Crawl />} />
              <Route path="/sites/:siteId/agent" element={<AgentConfig />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </DashboardLayout>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
