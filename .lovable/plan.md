

## Hakutulossivun upotus-elementti

### Idea

Kaksi erillistä upotuskomponenttia:
1. **Hakukenttä-widget** (nykyinen) — näyttää 3-5 tulosta dropdownissa
2. **Hakutulossivun widget** (uusi) — upotetaan asiakkaan erilliselle sivulle (esim. `/hakutulokset`), näyttää kaikki tulokset grid/lista-näkymässä

Hakutermi välitetään URL-parametrilla: hakukenttä ohjaa käyttäjän esim. `https://kauppa.fi/hakutulokset?findai_q=miesten+shortsit`

### Toteutus

#### 1. Hakukenttä-widgetin muutos (`widget/widget.js` + `public/widget.js`)
- Lisätään uusi `data-results-url` attribuutti widgetin script-tagiin
- Kun `data-results-url` on asetettu, "Näytä kaikki" -nappi muuttuu linkiksi joka ohjaa kyseiseen URLiin hakutermin kanssa: `{results-url}?findai_q={query}`
- Enter-napin painallus voisi myös ohjata tulossivulle

#### 2. Uusi hakutulossivun widget (`public/results-widget.js`)
- Erillinen JS-tiedosto joka upotetaan asiakkaan hakutulossivulle
- Lukee `findai_q` parametrin URLista ja tekee haun automaattisesti
- Sisältää oman hakukentän sivun yläosassa (jotta käyttäjä voi tarkentaa hakua)
- Näyttää kaikki tulokset grid-muodossa (tuotekortit kuvilla, hinnoilla, saatavuudella)
- Tukee samoja `data-site-id`, `data-supabase-url`, `data-supabase-key` attribuutteja
- Käyttää samaa hakurajapintaa mutta pyytää enemmän tuloksia (`max_results: 20-50`)
- Tyyliltään sopii asiakkaan sivulle (minimaalinen oma tyyli, responsiivinen gridi)

#### 3. Asennus asiakkaan sivulle

Hakukenttä (olemassa oleva sivu):
```html
<script src="https://findai.app/widget.js"
        data-site-id="xxx"
        data-supabase-url="..."
        data-supabase-key="..."
        data-results-url="/hakutulokset"></script>
```

Hakutulossivulla:
```html
<div id="findai-results"></div>
<script src="https://findai.app/results-widget.js"
        data-site-id="xxx"
        data-supabase-url="..."
        data-supabase-key="..."
        data-target="#findai-results"></script>
```

### Tekninen rakenne (`results-widget.js`)

- Jakaa helper-funktiot nykyisen widgetin kanssa (cleanTitle, formatPrice, addUtm jne.)
- Komponentit: hakukenttä + tulosten lajittelu/filtteröinti + tuotegridi
- Responsiivinen: 4 kolumnia desktop, 2 tabletti, 1 mobile
- Tukee samaa teemaa (light/dark) ja värikustomointia
- Klikkien seuranta toimii samalla logiikalla

### Muutettavat tiedostot
1. `widget/widget.js` — lisää `data-results-url` tuki + muuta "Näytä kaikki" ohjaamaan tulossivulle
2. `public/widget.js` — sama muutos
3. `public/results-widget.js` — **uusi tiedosto**, hakutulossivun upotuswidget
4. `src/pages/SearchPreview.tsx` — lisää esikatselunäkymä tulossivulle dashboardiin (valinnainen)

