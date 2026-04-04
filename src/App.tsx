import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
import Sites from "./pages/Sites";
import AddSite from "./pages/AddSite";
import Analytics from "./pages/Analytics";
import SearchPreview from "./pages/SearchPreview";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <DashboardLayout>
          <Routes>
            <Route path="/" element={<Sites />} />
            <Route path="/add-site" element={<AddSite />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/analytics/:siteId" element={<Analytics />} />
            <Route path="/search/:siteId" element={<SearchPreview />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </DashboardLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
