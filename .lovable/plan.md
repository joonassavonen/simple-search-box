

## Problem

The SearchPreview page is currently a standalone React page with its own styling (Tailwind classes, dashboard header, "Takaisin" button, widget snippet card at the bottom). It does not resemble how the widget actually looks when embedded on a customer's website.

The actual widget (`widget/widget.js`) uses Shadow DOM with its own CSS, a modal/inline panel design, custom colors, and a completely different visual structure. The preview should show exactly what the end user sees on the customer's site.

## Plan

### 1. Redesign SearchPreview as a widget simulator

Replace the current SearchPreview page content with two sections:
- A **mock website background** (simulated customer page with placeholder content) 
- The **actual widget rendered inside it** — either by embedding the real `widget.js` or by faithfully recreating its exact UI in React

### 2. Approach: Iframe-based widget embed

The cleanest approach — load the actual widget in an iframe so the preview is pixel-perfect:

- Create a minimal HTML page (`public/widget-preview.html`) that includes a mock site background and loads `widget/widget.js` with the correct `data-site-id` and `data-api-url` (Supabase edge function URL)
- In `SearchPreview.tsx`, render this page inside a styled iframe with device-frame chrome (optional border/shadow to look like a browser or phone)
- Keep the "Takaisin" button and "Upotuskoodi" snippet card outside the iframe, as admin-only controls

### 3. Specific changes

**New file: `public/widget-preview.html`**
- Minimal page with mock site content (gray background, placeholder header/paragraphs)
- `<script>` tag loading `/widget/widget.js` with dynamic `data-site-id` from URL params and `data-api-url` pointing to the Supabase search edge function

**Modified: `src/pages/SearchPreview.tsx`**
- Remove all the search logic, ResultCard, FeaturedCard, PopularSection, AutocompleteDropdown, ContactCTA, NoResults components (these live in widget.js)
- Replace with an iframe pointing to `/widget-preview.html?siteId={siteId}`
- Keep admin controls: back button, site name, and widget snippet copy card
- The iframe gets a realistic viewport size with a subtle device frame

### Technical details

- The iframe approach guarantees the preview matches production exactly (same Shadow DOM, same CSS, same JS)
- The widget.js already handles all search, trending, autocomplete, schema rendering, and contact CTAs
- URL params pass the site ID into the preview HTML which sets `data-site-id` on the script tag
- The Supabase edge function URL for search is constructed from `VITE_SUPABASE_URL`

