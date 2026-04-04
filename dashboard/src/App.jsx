import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Sites from "./pages/Sites";
import AddSite from "./pages/AddSite";
import Analytics from "./pages/Analytics";
import SearchPreview from "./pages/SearchPreview";

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Sites />} />
          <Route path="/add-site" element={<AddSite />} />
          <Route path="/analytics/:siteId" element={<Analytics />} />
          <Route path="/search/:siteId" element={<SearchPreview />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
