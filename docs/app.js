'use strict';
/* Bangalore Gold PWA — reads committed JSON (official GoodReturns rates) and
   optionally overlays a live intraday estimate from international spot. */

const DATA_BASE = './data/gold/';
const REFRESH_MS = 5 * 60 * 1000;       // re-pull committed JSON every 5 min
const STALE_HOURS = 20;                  // official data older than this = "stale" dot

const state = {
  latest: null,
  history: [],
  unit: 'g',        // 'g' | '10'
  metal: '24',      // '24' | '22'
  range: 30,        // days; 0 = all
  live: false,
  liveSpot: null,   // { g24, g22 } estimated Bangalore live prices
};

const $ = (id) => document.getElementById(id);
const fmtINR = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const arrow = (n) => (n > 0 ? '▲' : n < 0 ? '▼' : '•');
const unitMul = () => (state.unit === '10' ? 10 : 1);

async function getJSON(name) {
  const res = await fetch(DATA_BASE + name + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error(name + ' ' + res.status);
  return res.json();
}

async function loadData() {
  const [latest, history] = await Promise.all([getJSON('latest.json'), getJSON('history.json')]);
  state.latest = latest;
  state.history = Array.isArray(history) ? history : [];
  render();
  if (state.live) refreshLiveSpot();
}

/* ---------- Live spot estimate ----------
   Bangalore price = spot × (last official Bangalore / spot at last official update).
   The ratio captures duty + GST + local premium; scaling by the live spot move
   gives an intraday estimate that stays calibrated to GoodReturns. */
async function refreshLiveSpot() {
  const L = state.latest;
  if (!L || !L.spot || !L.spot.gold_24k_spot_inr_g) { state.liveSpot = null; return renderLive(); }
  try {
    const [gRaw, fxRaw] = await Promise.all([
      fetch('https://api.gold-api.com/price/XAU', { cache: 'no-store' }).then((r) => r.json()),
      fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    const xau = Number(gRaw.price);
    const inr = Number(fxRaw.rates && fxRaw.rates.INR);
    if (!xau || !inr) throw new Error('bad spot');
    const liveSpot24g = (xau * inr) / 31.1034768;
    const ratio24 = L.gold_24k / L.spot.gold_24k_spot_inr_g;
    const g24 = liveSpot24g * ratio24;
    const g22 = g24 * (L.gold_22k / L.gold_24k);
    state.liveSpot = { g24, g22, spot24g: liveSpot24g, at: new Date() };
  } catch (e) {
    state.liveSpot = null;
  }
  renderLive();
}

/* ---------- Rendering ---------- */
function render() {
  const L = state.latest;
  if (!L) return;
  const m = unitMul();

  $('price24').textContent = fmtINR(L.gold_24k * m);
  $('price22').textContent = fmtINR(L.gold_22k * m);
  const ulbl = state.unit === '10' ? '₹ / 10 grams' : '₹ / gram';
  $('unit24').textContent = ulbl; $('unit22').textContent = ulbl;

  renderDelta($('delta24'), L.delta_24k * m);
  renderDelta($('delta22'), L.delta_22k * m);

  // updated text + dot
  const upd = new Date(L.updatedAt);
  const ageH = (Date.now() - upd.getTime()) / 3.6e6;
  $('updatedText').textContent = 'Official · ' + relTime(upd) + ' · ' + (L.date || '');
  const dot = $('liveDot');
  dot.className = 'dot ' + (state.live ? 'live' : ageH > STALE_HOURS ? 'stale' : '');

  $('srcLink').href = L.sourceUrl || '#';

  renderSummary();
  renderChart();
  renderHistory();
  renderSpot();
  renderLive();
}

function renderDelta(el, d) {
  el.className = 'delta ' + cls(d);
  el.textContent = arrow(d) + ' ' + fmtSigned(d) + ' today';
}

function renderLive() {
  const on = state.live && state.liveSpot;
  for (const [karat, id] of [['g24', 'live24'], ['g22', 'live22']]) {
    const el = $(id);
    if (!on) { el.hidden = true; continue; }
    const m = unitMul();
    const official = karat === 'g24' ? state.latest.gold_24k : state.latest.gold_22k;
    const livev = state.liveSpot[karat];
    const diff = (livev - official) * m;
    el.hidden = false;
    el.innerHTML = 'Live ≈ <b>' + fmtINR(livev * m) + '</b> <span class="' + cls(diff) + '">(' + fmtSigned(diff) + ')</span>';
  }
  const dot = $('liveDot');
  if (state.live && state.latest) {
    const ageH = (Date.now() - new Date(state.latest.updatedAt).getTime()) / 3.6e6;
    dot.className = 'dot ' + (state.liveSpot ? 'live' : ageH > STALE_HOURS ? 'stale' : '');
  }
}

function pickField() { return state.metal === '22' ? 'g22' : 'g24'; }
function pickDelta() { return state.metal === '22' ? 'd22' : 'd24'; }

function seriesForRange() {
  const h = state.history;
  if (!state.range || state.range <= 0) return h.slice();
  return h.slice(-state.range);
}

function changeOver(days) {
  const h = state.history;
  const f = pickField();
  if (h.length < 2) return null;
  const last = h[h.length - 1][f];
  // find the point ~`days` ago by index (data is ~daily)
  const idx = Math.max(0, h.length - 1 - days);
  const past = h[idx][f];
  return { abs: (last - past) * unitMul(), pct: ((last - past) / past) * 100 };
}

function renderSummary() {
  const h = state.history;
  const f = pickField();
  const dayAbs = h.length ? h[h.length - 1][pickDelta()] * unitMul() : 0;
  setSum($('sumDay'), { abs: dayAbs, pct: h.length > 1 ? (h[h.length-1][f] - h[h.length-2][f]) / h[h.length-2][f] * 100 : 0 });
  setSum($('sumWeek'), changeOver(7));
  setSum($('sumMonth'), changeOver(30));
}
function setSum(el, c) {
  if (!c) { el.textContent = '—'; el.className = 'sum-v flat'; return; }
  el.className = 'sum-v ' + cls(c.abs);
  el.textContent = fmtSigned(c.abs) + '  ' + (c.pct >= 0 ? '+' : '−') + Math.abs(c.pct).toFixed(2) + '%';
}

/* ---------- SVG line chart ---------- */
const CHART_W = 340, CHART_H = 180, PAD_L = 6, PAD_R = 6, PAD_T = 14, PAD_B = 22;
function renderChart() {
  const svg = $('chart');
  const data = seriesForRange();
  const f = pickField();
  if (data.length < 2) { svg.innerHTML = '<text x="170" y="90" fill="#8a7c5c" font-size="12" text-anchor="middle">Not enough history yet</text>'; $('chartFoot').textContent = ''; return; }
  const m = unitMul();
  const vals = data.map((d) => d[f] * m);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12; min -= pad; max += pad;
  const n = data.length;
  const x = (i) => PAD_L + (i / (n - 1)) * (CHART_W - PAD_L - PAD_R);
  const y = (v) => PAD_T + (1 - (v - min) / (max - min)) * (CHART_H - PAD_T - PAD_B);

  let line = '', area = '';
  data.forEach((d, i) => {
    const px = x(i), py = y(d[f] * m);
    line += (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1) + ' ';
  });
  area = line + 'L' + x(n - 1).toFixed(1) + ' ' + (CHART_H - PAD_B) + ' L' + x(0).toFixed(1) + ' ' + (CHART_H - PAD_B) + ' Z';

  const up = vals[n - 1] >= vals[0];
  const stroke = up ? '#e8b64b' : '#ff8a5c';
  const lastX = x(n - 1), lastY = y(vals[n - 1]);

  svg.innerHTML =
    '<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + stroke + '" stop-opacity="0.28"/>' +
      '<stop offset="1" stop-color="' + stroke + '" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    '<path d="' + area + '" fill="url(#ga)"/>' +
    '<path d="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="3.4" fill="' + stroke + '"/>' +
    '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="6" fill="' + stroke + '" opacity="0.25"/>';

  $('chartFoot').innerHTML =
    '<span>' + fmtDate(data[0].date) + '</span>' +
    '<span>High ' + fmtINR(max - pad) + ' · Low ' + fmtINR(min + pad) + '</span>' +
    '<span>' + fmtDate(data[n - 1].date) + '</span>';

  attachChartInteraction(svg, data, f, m, x, y);
}

function attachChartInteraction(svg, data, f, m, x, y) {
  const tip = $('chartTip');
  const n = data.length;
  const move = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const rel = (clientX - rect.left) / rect.width;
    let i = Math.round(rel * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const d = data[i];
    const px = (x(i) / CHART_W) * rect.width;
    tip.hidden = false;
    tip.style.left = Math.max(30, Math.min(rect.width - 30, px)) + 'px';
    tip.style.top = ((y(d[f] * m) / CHART_H) * rect.height) + 'px';
    const delta = f === 'g24' ? d.d24 : d.d22;
    tip.innerHTML = '<b>' + fmtINR(d[f] * m) + '</b><br>' + fmtDate(d.date) + ' · ' + fmtSigned((delta || 0) * m);
  };
  const end = () => { tip.hidden = true; };
  svg.ontouchstart = (e) => move(e.touches[0].clientX);
  svg.ontouchmove = (e) => { move(e.touches[0].clientX); };
  svg.ontouchend = end;
  svg.onmousemove = (e) => move(e.clientX);
  svg.onmouseleave = end;
}

function renderHistory() {
  const list = $('histList');
  const h = state.history.slice().reverse().slice(0, 30);
  const m = unitMul();
  let html = '<div class="hist-row head"><span>Date</span><span style="text-align:right">24K</span><span style="text-align:right">22K</span></div>';
  for (const d of h) {
    html += '<div class="hist-row">' +
      '<span class="hist-date">' + fmtDate(d.date) + '</span>' +
      '<span class="hist-val">' + fmtINR(d.g24 * m) + '<small class="' + cls(d.d24) + '">' + arrow(d.d24) + ' ' + fmtSigned((d.d24 || 0) * m) + '</small></span>' +
      '<span class="hist-val">' + fmtINR(d.g22 * m) + '<small class="' + cls(d.d22) + '">' + arrow(d.d22) + ' ' + fmtSigned((d.d22 || 0) * m) + '</small></span>' +
    '</div>';
  }
  list.innerHTML = html;
}

function renderSpot() {
  const L = state.latest;
  const box = $('spotBox');
  if (!L || !L.spot || !L.spot.gold_24k_spot_inr_g) { box.hidden = true; return; }
  box.hidden = false;
  $('spotVal').textContent = fmtINR(L.spot.gold_24k_spot_inr_g * unitMul()) + (state.unit === '10' ? ' /10g' : ' /g');
}

/* ---------- helpers ---------- */
function relTime(d) {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
function fmtDate(iso) {
  const [y, mo, da] = iso.split('-').map(Number);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return da + ' ' + M[mo - 1];
}
let toastT;
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- wiring ---------- */
function bindSeg(segId, key, cast) {
  $(segId).addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.classList.remove('active'));
    b.classList.add('active');
    state[key] = cast(b.dataset[Object.keys(b.dataset)[0]]);
    render();
  });
}

async function refresh(manual) {
  const btn = $('refreshBtn');
  btn.classList.add('spin');
  try {
    await loadData();
    if (state.live) await refreshLiveSpot();
    if (manual) toast('Updated');
  } catch (e) {
    toast('Offline — showing saved data');
  } finally {
    setTimeout(() => btn.classList.remove('spin'), 500);
  }
}

function init() {
  bindSeg('unitSeg', 'unit', (v) => v);
  bindSeg('metalSeg', 'metal', (v) => v);
  bindSeg('rangeSeg', 'range', (v) => parseInt(v, 10));

  $('refreshBtn').addEventListener('click', () => refresh(true));

  $('liveToggle').addEventListener('change', (e) => {
    state.live = e.target.checked;
    localStorage.setItem('gold.live', state.live ? '1' : '0');
    if (state.live) { refreshLiveSpot(); startLiveTimer(); } else { stopLiveTimer(); }
    renderLive();
    const dot = $('liveDot');
    if (state.latest) {
      const ageH = (Date.now() - new Date(state.latest.updatedAt).getTime()) / 3.6e6;
      dot.className = 'dot ' + (state.live ? (state.liveSpot ? 'live' : 'stale') : ageH > STALE_HOURS ? 'stale' : '');
    }
  });
  if (localStorage.getItem('gold.live') === '1') { state.live = true; $('liveToggle').checked = true; }

  // install hint for iOS Safari (not already installed)
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if (isiOS && !standalone && localStorage.getItem('gold.hint') !== 'off') {
    setTimeout(() => { $('installHint').hidden = false; }, 1500);
  }
  $('installClose').addEventListener('click', () => { $('installHint').hidden = true; localStorage.setItem('gold.hint', 'off'); });

  loadData().then(() => { if (state.live) { refreshLiveSpot(); startLiveTimer(); } }).catch(() => toast('Could not load rates'));

  // periodic + on focus
  setInterval(() => refresh(false), REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
}

let liveTimer;
function startLiveTimer() { stopLiveTimer(); liveTimer = setInterval(refreshLiveSpot, 60 * 1000); }
function stopLiveTimer() { clearInterval(liveTimer); }

// service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

document.addEventListener('DOMContentLoaded', init);
