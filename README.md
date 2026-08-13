# Bloomé — Create Your Own Bouquet

A custom bouquet builder: pick flowers, choose a wrap, add a ribbon, watch a
live SVG preview build itself, then check out. Single self-contained file —
no build step, no dependencies.

## Files in this repo

| File | What it is |
|---|---|
| `index.html` | The entire website — homepage, bouquet customizer, cart, checkout, order confirmation, and the admin dashboard. Open it directly or deploy it as-is. |
| `GOOGLE_APPS_SCRIPT.gs` | Paste into Google Sheets → Extensions → Apps Script to sync every paid order into a Sheet, for free, with no backend. Setup steps are in the comments at the top of the file. |
| `BACKEND_SPEC.md` | For a developer: what's needed to move from this prototype to production — real payment (Razorpay), a real database, WhatsApp order notifications, and real admin auth. |

## Deploy for free with GitHub Pages

1. Push this repo to GitHub (or upload these files into a new repo).
2. Repo → **Settings** → **Pages**.
3. Under "Build and deployment", set **Source** to `Deploy from a branch`,
   branch `main`, folder `/ (root)`. Save.
4. GitHub gives you a live URL, usually
   `https://<your-username>.github.io/<repo-name>/`, live within a minute or two.

Netlify, Vercel, and Cloudflare Pages all work the same way if you'd rather
use one of those instead — just point them at this repo, no build command needed.

## Connect the Google Sheet (optional but recommended)

1. Open your Sheet, rename the first tab to `Orders`, and add the header row
   listed at the top of `GOOGLE_APPS_SCRIPT.gs`.
2. Extensions → Apps Script → paste in `GOOGLE_APPS_SCRIPT.gs` → Deploy →
   New deployment → Web app → Execute as **Me**, access **Anyone** → Deploy.
3. Copy the `.../exec` URL it gives you.
4. In `index.html`, find this line near the top of the `<script>` section:
   ```js
   const SHEET_WEBAPP_URL = '';
   ```
   Paste your URL between the quotes, save, and re-deploy the site.

Every paid order will now append a row with date, time, and the full
customer + bouquet + pricing breakdown.

## Things to know before this goes live for real customers

- **Payment is simulated.** There's no real money movement yet — see
  `BACKEND_SPEC.md` §4 for the Razorpay integration a developer needs to add.
- **Admin login** (top-right "Studio Admin", password `bloome2026`) is a
  placeholder for demoing the dashboard — replace with real authentication
  before handling real orders (`BACKEND_SPEC.md` §8).
- **GST rate** defaults to 5% — change `GST_RATE` near the top of
  `index.html`'s script to whatever slab actually applies to your business.
- **Stock counts** are editable in Admin → Product Management and decrease
  automatically as orders come in, but this happens in the browser, so it
  isn't safe against two customers checking out the same low-stock item at
  the exact same moment — fine for a small studio, worth moving server-side
  before scaling up.
- **WhatsApp order notifications** (to the studio owner and the customer)
  are specified in `BACKEND_SPEC.md` §7 but need a small server to send them,
  since WhatsApp's Business API can't be called safely from the browser.
