#!/usr/bin/env node
/*
 * One-time backfill of ~1 year of daily Bangalore gold history so the chart
 * ranges (1M/3M/6M/1Y) are meaningful before the daily scraper has accumulated
 * that much on its own.
 *
 * Real Bangalore retail rates are driven by the international gold price plus a
 * fairly stable premium (import duty + GST + margin). We reconstruct history by
 * taking real daily gold prices in INR (CoinGecko PAX-Gold, 1 token = 1 troy oz)
 * and applying TODAY's actual GoodReturns premium. The most recent days that we
 * already have as REAL GoodReturns values are kept as-is and win over the model.
 *
 * Modeled rows are tagged { est: true } so the UI can label them. As the daily
 * updater runs, real GoodReturns data progressively replaces the modeled tail.
 */
const fs = require('fs');
const path = require('path');

const OUNCE_G = 31.1034768;
const HISTORY = path.join(__dirname, '..', '..', 'docs', 'data', 'gold', 'history.json');

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'bangalore-gold-backfill' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function isoUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

(async () => {
  const real = JSON.parse(fs.readFileSync(HISTORY, 'utf8'));           // existing real GoodReturns days
  const realByDate = new Map(real.map((r) => [r.date, r]));
  const r22over24 = real.length ? real[real.length - 1].g22 / real[real.length - 1].g24 : 13440 / 14662;
  const realToday = real[real.length - 1];

  const cg = await getJSON('https://api.coingecko.com/api/v3/coins/pax-gold/market_chart?vs_currency=inr&days=365');
  // one price per calendar day (last sample of each day)
  const spotByDate = new Map();
  for (const [ms, price] of cg.prices) spotByDate.set(isoUTC(ms), price / OUNCE_G); // INR per gram, 24K spot

  // Calibrate premium so the model lines up with today's real Bangalore 24K.
  const spotToday = spotByDate.get(realToday.date) || [...spotByDate.values()].pop();
  const premium = realToday.g24 / spotToday;
  console.log(`premium (Bangalore/spot) = ${premium.toFixed(4)}  ·  22K/24K = ${r22over24.toFixed(4)}`);

  const merged = new Map();
  for (const [date, spot24] of spotByDate) {
    const g24 = Math.round(spot24 * premium);
    const g22 = Math.round(g24 * r22over24);
    merged.set(date, { date, g24, g22, est: true });
  }
  // Real GoodReturns days override the model.
  for (const [date, r] of realByDate) merged.set(date, { date, g24: r.g24, g22: r.g22 });

  const out = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < out.length; i++) {
    const prev = out[i - 1];
    out[i].d24 = prev ? out[i].g24 - prev.g24 : 0;
    out[i].d22 = prev ? out[i].g22 - prev.g22 : 0;
  }

  fs.writeFileSync(HISTORY, JSON.stringify(out, null, 2) + '\n');
  const estCount = out.filter((r) => r.est).length;
  console.log(`history.json now has ${out.length} days (${estCount} modeled, ${out.length - estCount} real GoodReturns)`);
  console.log(`range: ${out[0].date} → ${out[out.length - 1].date}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
