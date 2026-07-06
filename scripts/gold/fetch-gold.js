#!/usr/bin/env node
/*
 * Fetch Bangalore gold rates from GoodReturns + international spot, then write:
 *   docs/data/gold/latest.json   (current snapshot)
 *   docs/data/gold/history.json  (accumulated daily history, ascending by date)
 *
 * Runs in GitHub Actions (server-side) so there is no browser/CORS restriction.
 * No npm dependencies: uses Node 18+ global fetch. Robust HTML parsing via regex
 * anchored on GoodReturns' stable id="24K-price" / id="22K-price" and the
 * "last 10 days" table.
 */
const fs = require('fs');
const path = require('path');

const SRC = 'https://www.goodreturns.in/gold-rates/bangalore.html';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const OUNCE_G = 31.1034768;

const DATA_DIR = path.join(__dirname, '..', '..', 'docs', 'data', 'gold');
const LATEST = path.join(DATA_DIR, 'latest.json');
const HISTORY = path.join(DATA_DIR, 'history.json');

const MONTHS = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 };

function num(s) { return parseInt(String(s).replace(/[^0-9]/g, ''), 10); }

function toISO(dateStr) {
  // "Jul 06, 2026" -> "2026-07-06"
  const m = dateStr.match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[1]];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2,'0')}-${String(parseInt(m[2],10)).padStart(2,'0')}`;
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function parseGoodReturns(html) {
  const g24 = html.match(/id="24K-price">\s*(?:&#x20b9;|₹)?\s*([0-9,]+)/i);
  const g22 = html.match(/id="22K-price">\s*(?:&#x20b9;|₹)?\s*([0-9,]+)/i);
  if (!g24 || !g22) throw new Error('Could not parse current 24K/22K prices');
  const current = { g24: num(g24[1]), g22: num(g22[1]) };

  // Parse the "last 10 days" table rows: date + 24K cell + 22K cell.
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]);
    if (cells.length < 3) continue;
    const dateTxt = cells[0].replace(/<[^>]*>/g, ' ').replace(/&[^;]+;/g, ' ').trim();
    const iso = toISO(dateTxt);
    if (!iso) continue;
    const v24 = num((cells[1].match(/([0-9][0-9,]{2,})/) || [])[1] || '');
    const v22 = num((cells[2].match(/([0-9][0-9,]{2,})/) || [])[1] || '');
    if (!v24 || !v22) continue;
    rows.push({ date: iso, g24: v24, g22: v22 });
  }
  return { current, rows };
}

async function getSpot() {
  try {
    const [gRaw, fxRaw] = await Promise.all([
      getText('https://api.gold-api.com/price/XAU'),
      getText('https://open.er-api.com/v6/latest/USD'),
    ]);
    const g = JSON.parse(gRaw);
    const fx = JSON.parse(fxRaw);
    const xau_usd = Number(g.price);
    const usd_inr = Number(fx.rates && fx.rates.INR);
    if (!xau_usd || !usd_inr) return null;
    const gold_24k_spot_inr_g = (xau_usd * usd_inr) / OUNCE_G;
    return {
      xau_usd: round2(xau_usd),
      usd_inr: round2(usd_inr),
      gold_24k_spot_inr_g: round2(gold_24k_spot_inr_g),
      updatedAt: g.updatedAt || new Date().toISOString(),
    };
  } catch (e) {
    console.warn('spot fetch failed:', e.message);
    return null;
  }
}

const round2 = n => Math.round(n * 100) / 100;

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function mergeHistory(existing, rows, today) {
  const byDate = new Map();
  for (const r of existing) byDate.set(r.date, { date: r.date, g24: r.g24, g22: r.g22 });
  // table rows (older reference points) then today's authoritative values
  for (const r of rows) byDate.set(r.date, { date: r.date, g24: r.g24, g22: r.g22 });
  if (today) byDate.set(today.date, { date: today.date, g24: today.g24, g22: today.g22 });
  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  // compute day-over-day deltas
  for (let i = 0; i < out.length; i++) {
    const prev = out[i - 1];
    out[i].d24 = prev ? out[i].g24 - prev.g24 : 0;
    out[i].d22 = prev ? out[i].g22 - prev.g22 : 0;
  }
  return out;
}

function istDate() {
  // Current date in Asia/Kolkata as YYYY-MM-DD
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

(async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const html = await getText(SRC);
  const { current, rows } = parseGoodReturns(html);
  const spot = await getSpot();

  const today = { date: istDate(), g24: current.g24, g22: current.g22 };

  const prevHistory = readJSON(HISTORY, []);
  const history = mergeHistory(prevHistory, rows, today);
  const todayRow = history.find(r => r.date === today.date) || { d24: 0, d22: 0 };

  const latest = {
    source: 'GoodReturns — Gold Rate in Bangalore',
    sourceUrl: SRC,
    city: 'Bangalore',
    unit: 'inr_per_gram',
    date: today.date,
    updatedAt: new Date().toISOString(),
    gold_24k: current.g24,
    gold_22k: current.g22,
    delta_24k: todayRow.d24,
    delta_22k: todayRow.d22,
    spot: spot || null,
  };

  fs.writeFileSync(LATEST, JSON.stringify(latest, null, 2) + '\n');
  fs.writeFileSync(HISTORY, JSON.stringify(history, null, 2) + '\n');
  console.log(`OK  24K=${current.g24}  22K=${current.g22}  history=${history.length} days  spot=${spot ? spot.gold_24k_spot_inr_g : 'n/a'}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
