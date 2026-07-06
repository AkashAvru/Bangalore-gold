# Bangalore Gold — iPhone home-screen web app

A tiny installable PWA that shows **live 22K & 24K gold rates for Bangalore**
(sourced from [GoodReturns](https://www.goodreturns.in/gold-rates/bangalore.html))
with **daily change** and **weekly / monthly history + charts**.

## How it works

- **Data**: A GitHub Action (`.github/workflows/gold.yml`) runs several times a
  day, fetches the Bangalore rates from GoodReturns *server-side* (no browser
  CORS limits, no scraping from your phone), and commits them into
  `docs/data/gold/`:
  - `latest.json` — current 24K/22K price + today's change + international spot.
  - `history.json` — daily history that keeps growing (seeded with GoodReturns'
    last-10-days table so charts work from day one).
- **App**: The static files in `docs/` read those JSON files. No API keys, no
  backend, works offline (service worker caches the last data).
- **Live estimate (optional)**: Toggle it on and the app fetches the *live
  international spot* price directly in your browser and scales the last
  official Bangalore rate by the intraday spot move — so you see a live estimate
  between the scheduled official updates. Official GoodReturns numbers always
  remain the headline figure.

## One-time setup (you do this once)

### 1. Enable GitHub Pages
After this branch is merged to `main`:
1. Go to the repo on GitHub → **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: **`main`**, folder: **`/docs`** → **Save**.
4. After a minute your app is live at:
   **`https://<your-username>.github.io/bloom/`**

### 2. Turn on the updater
1. Go to **Settings → Actions → General → Workflow permissions** and select
   **Read and write permissions** (lets the bot commit updated rates).
2. Open the **Actions** tab → **Update Bangalore gold rates** → **Run workflow**
   once to confirm it works. After that it runs automatically on schedule.

### 3. Add to your iPhone home screen
1. Open the Pages URL in **Safari** on your iPhone.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch it from the icon — it opens full-screen like a native app.

## Adjusting update frequency
Edit the `cron` lines in `.github/workflows/gold.yml`. Times are **UTC**
(IST = UTC + 5:30). More entries = fresher data (and more commits).

## Notes
- Rates are for **reference only**. Retail Bangalore prices include import duty,
  GST and jeweller margins — that's why they sit ~15% above international spot.
- If GoodReturns ever changes their page layout the scraper may need a small
  tweak in `scripts/gold/fetch-gold.js` (the parser is anchored on their
  `24K-price` / `22K-price` markers and the history table).
