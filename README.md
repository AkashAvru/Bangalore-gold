# Bangalore Gold 🥇

An installable iPhone home-screen web app showing **live 22K & 24K gold rates
for Bangalore** (from [GoodReturns](https://www.goodreturns.in/gold-rates/bangalore.html)),
with daily change and weekly / monthly history charts.

**Live app:** `https://akashavru.github.io/bangalore-gold/` *(after you enable Pages — see below)*

## How it stays live
A GitHub Action (`.github/workflows/gold.yml`) runs several times a day, fetches
the Bangalore rates server-side, and commits them into `docs/data/gold/`
(`latest.json` + a growing `history.json`). The static app in `docs/` reads
those files — no API keys, no backend, works offline.

## Enable it (one-time)

### 1. Turn on hosting
Repo **Settings → Pages → Build and deployment**:
- **Source:** Deploy from a branch
- **Branch:** `main` · **Folder:** `/docs` → **Save**

Direct link: `https://github.com/akashavru/bangalore-gold/settings/pages`

Your app goes live at **`https://akashavru.github.io/bangalore-gold/`** in ~1 min.

### 2. Let it auto-update
Repo **Settings → Actions → General → Workflow permissions**:
- Select **Read and write permissions** → **Save**

Direct link: `https://github.com/akashavru/bangalore-gold/settings/actions`

Then open the **Actions** tab → **Update Bangalore gold rates** → **Run workflow**
once to confirm. After that it runs automatically on schedule.

### 3. Add to your iPhone home screen
Open the Pages URL in **Safari** → **Share** → **Add to Home Screen** → **Add**.

## Notes
- Rates are for reference only. Retail Bangalore prices include import duty, GST
  and jeweller margins (~15% above international spot — shown for context).
- Update frequency lives in the `cron` lines of `.github/workflows/gold.yml`
  (times are UTC; IST = UTC + 5:30).
- The scraper is anchored on GoodReturns' `24K-price` / `22K-price` markers and
  their history table; a layout change there is the only thing that would need a
  tweak in `scripts/gold/fetch-gold.js`.
