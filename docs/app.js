'use strict';
/* Bangalore Gold PWA — official GoodReturns rates (raw repo file), 1-year
   history, live intraday estimate, investment calculator, 3D coin. */

const RAW_BASE = 'https://raw.githubusercontent.com/AkashAvru/Bangalore-gold/main/docs/data/gold/';
const LOCAL_BASE = './data/gold/';
const REFRESH_MS = 5 * 60 * 1000;
const STALE_HOURS = 20;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  latest: null, history: [],
  unit: 'g',        // 'g' | '8' (pavan) | '10'
  metal: '24', range: 30,
  live: false, liveSpot: null,
  calcMode: 'qty', calcKarat: '24',
  histExpanded: false,
};

const $ = (id) => document.getElementById(id);
const fmtINR = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
const fmtPct = (p) => (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(2) + '%';
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const arrow = (n) => (n > 0 ? '▲' : n < 0 ? '▼' : '•');
const UNIT_MUL = { g: 1, '8': 8, '10': 10 };
const UNIT_NAME = { g: 'gram', '8': 'pavan', '10': '10 grams' };
const unitMul = () => UNIT_MUL[state.unit];
const unitLabel = () => (state.unit === '8' ? '₹ / pavan (8 g)' : state.unit === '10' ? '₹ / 10 grams' : '₹ / gram');
const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = (iso) => { const p = iso.split('-'); return parseInt(p[2], 10) + ' ' + M[parseInt(p[1], 10) - 1]; };
const fmtDateY = (iso) => { const p = iso.split('-'); return parseInt(p[2], 10) + ' ' + M[parseInt(p[1], 10) - 1] + " '" + p[0].slice(2); };

/* ---- number tween ---- */
function tween(el, to, format) {
  const from = Number(el.dataset.v);
  el.dataset.v = to;
  if (REDUCED || !isFinite(from) || from === to) { el.textContent = format(to); return; }
  const dur = 480, t0 = performance.now();
  (function step(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = format(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  })(performance.now());
}

/* ---- data ---- */
async function getJSON(name) {
  const bust = '?t=' + Date.now();
  try { const r = await fetch(RAW_BASE + name + bust, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) {}
  const res = await fetch(LOCAL_BASE + name + bust, { cache: 'no-store' });
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

/* ---- 3D coin ---- */
function buildCoin() {
  const coin = $('coin');
  let html = '';
  for (let z = -7; z <= 7; z += 1) html += `<div class="slice" style="transform:translateZ(${z}px)"></div>`;
  html += '<div class="face front" style="transform:translateZ(7.5px)"><span class="k">24K</span></div>';
  html += '<div class="face back" style="transform:rotateY(180deg) translateZ(7.5px)"><span class="r">₹</span></div>';
  coin.innerHTML = html;
}

/* ---- live spot estimate ---- */
async function refreshLiveSpot() {
  const L = state.latest;
  if (!L || !L.spot || !L.spot.gold_24k_spot_inr_g) { state.liveSpot = null; return renderLive(); }
  try {
    const [g, fx] = await Promise.all([
      fetch('https://api.gold-api.com/price/XAU', { cache: 'no-store' }).then((r) => r.json()),
      fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' }).then((r) => r.json()),
    ]);
    const xau = Number(g.price), inr = Number(fx.rates && fx.rates.INR);
    if (!xau || !inr) throw 0;
    const liveSpot24g = (xau * inr) / 31.1034768;
    const g24 = liveSpot24g * (L.gold_24k / L.spot.gold_24k_spot_inr_g);
    state.liveSpot = { g24, g22: g24 * (L.gold_22k / L.gold_24k) };
  } catch (e) { state.liveSpot = null; }
  renderLive();
}

/* ---- render ---- */
function render() {
  const L = state.latest; if (!L) return;
  const m = unitMul();
  tween($('price24'), L.gold_24k * m, fmtINR);
  tween($('price22'), L.gold_22k * m, fmtINR);
  $('unit24').textContent = unitLabel(); $('unit22').textContent = unitLabel();
  renderDelta($('delta24'), L.delta_24k * m);
  renderDelta($('delta22'), L.delta_22k * m);

  const upd = new Date(L.updatedAt);
  const ageH = (Date.now() - upd.getTime()) / 3.6e6;
  $('updatedText').textContent = 'Official · ' + relTime(upd) + (L.date ? ' · ' + fmtDate(L.date) : '');
  $('liveDot').className = 'dot ' + (state.live ? (state.liveSpot ? 'live' : 'stale') : ageH > STALE_HOURS ? 'stale' : '');
  if (L.sourceUrl) $('srcLink').href = L.sourceUrl;

  renderSummary(); renderChart(); renderCalc(); renderHistory(); renderSpot(); renderLive();
}
function renderDelta(el, d) { el.className = 'delta ' + cls(d); el.textContent = arrow(d) + ' ' + fmtSigned(d) + ' today'; }

function renderLive() {
  const on = state.live && state.liveSpot, m = unitMul();
  [['g24', 'live24', 'gold_24k'], ['g22', 'live22', 'gold_22k']].forEach(([k, id, off]) => {
    const el = $(id);
    if (!on) { el.hidden = true; return; }
    const official = state.latest[off], live = state.liveSpot[k], diff = (live - official) * m;
    el.hidden = false;
    el.innerHTML = 'Live ≈ <b>' + fmtINR(live * m) + '</b> <span class="' + cls(diff) + '">(' + fmtSigned(diff) + ')</span>';
  });
  if (state.latest) {
    const ageH = (Date.now() - new Date(state.latest.updatedAt).getTime()) / 3.6e6;
    $('liveDot').className = 'dot ' + (state.live ? (state.liveSpot ? 'live' : 'stale') : ageH > STALE_HOURS ? 'stale' : '');
  }
}

const fld = () => (state.metal === '22' ? 'g22' : 'g24');
const dfld = () => (state.metal === '22' ? 'd22' : 'd24');
function changeOver(days) {
  const h = state.history, f = fld(); if (h.length < 2) return null;
  const last = h[h.length - 1][f];
  const idx = days ? Math.max(0, h.length - 1 - days) : 0;
  const past = h[idx][f];
  return { abs: (last - past) * unitMul(), pct: (last - past) / past * 100 };
}
function renderSummary() {
  const h = state.history, f = fld();
  setSum($('sumDay'), { abs: h.length ? h[h.length - 1][dfld()] * unitMul() : 0, pct: h.length > 1 ? (h[h.length - 1][f] - h[h.length - 2][f]) / h[h.length - 2][f] * 100 : 0 });
  setSum($('sumWeek'), changeOver(7));
  setSum($('sumMonth'), changeOver(30));
}
function setSum(el, c) {
  if (!c) { el.textContent = '—'; el.className = 'sum-v flat'; return; }
  el.className = 'sum-v ' + cls(c.abs);
  el.textContent = fmtSigned(c.abs) + '  ' + fmtPct(c.pct);
}

/* ---- chart ---- */
const CW = 340, CH = 190, PL = 6, PR = 6, PT = 14, PB = 22;
function seriesForRange() { const h = state.history; return (!state.range || state.range <= 0) ? h.slice() : h.slice(-state.range); }
function renderChart() {
  const svg = $('chart'), data = seriesForRange(), f = fld(), m = unitMul();
  if (data.length < 2) { svg.innerHTML = '<text x="170" y="95" fill="#647a70" font-size="12" text-anchor="middle">Not enough history</text>'; $('chartFoot').textContent = ''; $('rangeStats').innerHTML = ''; return; }
  const vals = data.map((d) => d[f] * m);
  let min = Math.min(...vals), max = Math.max(...vals);
  const minI = vals.indexOf(min), maxI = vals.indexOf(max);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.14 || 1, lo = min - pad, hi = max + pad;
  const n = data.length;
  const x = (i) => PL + (i / (n - 1)) * (CW - PL - PR);
  const y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (CH - PT - PB);
  let line = '';
  data.forEach((d, i) => { line += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d[f] * m).toFixed(1) + ' '; });
  const area = line + 'L' + x(n - 1).toFixed(1) + ' ' + (CH - PB) + ' L' + x(0).toFixed(1) + ' ' + (CH - PB) + ' Z';
  const up = vals[n - 1] >= vals[0], stroke = up ? '#34d399' : '#fb7185';
  const lastX = x(n - 1).toFixed(1), lastY = y(vals[n - 1]).toFixed(1);

  svg.innerHTML =
    '<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + stroke + '" stop-opacity="0.30"/><stop offset="1" stop-color="' + stroke + '" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + area + '" fill="url(#ga)"/>' +
    '<path d="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" pathLength="1"' + (REDUCED ? '' : ' stroke-dasharray="1" stroke-dashoffset="1"') + '>' + (REDUCED ? '' : '<animate attributeName="stroke-dashoffset" from="1" to="0" dur="0.75s" fill="freeze"/>') + '</path>' +
    '<circle cx="' + x(minI).toFixed(1) + '" cy="' + y(min).toFixed(1) + '" r="2.6" fill="#fb7185"/>' +
    '<circle cx="' + x(maxI).toFixed(1) + '" cy="' + y(max).toFixed(1) + '" r="2.6" fill="var(--gold)" style="fill:#f3c651"/>' +
    '<g id="cx" style="display:none"><line id="cxl" y1="' + PT + '" y2="' + (CH - PB) + '" stroke="#5ff0bb" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/><circle id="cxd" r="4" fill="' + stroke + '"/></g>' +
    '<circle cx="' + lastX + '" cy="' + lastY + '" r="6" fill="' + stroke + '" opacity="0.22"/>' +
    '<circle cx="' + lastX + '" cy="' + lastY + '" r="3.4" fill="' + stroke + '"/>';

  // range stats
  const chg = { abs: (vals[n - 1] - vals[0]), pct: (vals[n - 1] - vals[0]) / vals[0] * 100 };
  $('rangeStats').innerHTML =
    '<span class="rs">Change<b class="' + cls(chg.abs) + '">' + fmtSigned(chg.abs) + ' ' + fmtPct(chg.pct) + '</b></span>' +
    '<span class="rs">High<b>' + fmtINR(max) + '</b></span>' +
    '<span class="rs">Low<b>' + fmtINR(min) + '</b></span>';
  $('chartFoot').innerHTML = '<span>' + fmtDateY(data[0].date) + '</span><span>' + n + ' days</span><span>' + fmtDateY(data[n - 1].date) + '</span>';
  attachChart(svg, data, f, m, x, y);
}
function attachChart(svg, data, f, m, x, y) {
  const tip = $('chartTip'), n = data.length, cx = svg.querySelector('#cx'), cxl = svg.querySelector('#cxl'), cxd = svg.querySelector('#cxd');
  const move = (clientX) => {
    const rect = svg.getBoundingClientRect();
    let i = Math.round(((clientX - rect.left) / rect.width) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const d = data[i], gx = x(i), gy = y(d[f] * m);
    cx.style.display = ''; cxl.setAttribute('x1', gx); cxl.setAttribute('x2', gx); cxd.setAttribute('cx', gx); cxd.setAttribute('cy', gy);
    tip.hidden = false;
    tip.style.left = Math.max(34, Math.min(rect.width - 34, (gx / CW) * rect.width)) + 'px';
    tip.style.top = (gy / CH) * rect.height + 'px';
    const dl = (f === 'g24' ? d.d24 : d.d22) || 0;
    tip.innerHTML = '<b>' + fmtINR(d[f] * m) + '</b><br>' + fmtDateY(d.date) + ' · ' + fmtSigned(dl * m) + (d.est ? ' · est' : '');
  };
  const end = () => { tip.hidden = true; cx.style.display = 'none'; };
  svg.ontouchstart = (e) => move(e.touches[0].clientX);
  svg.ontouchmove = (e) => { move(e.touches[0].clientX); };
  svg.ontouchend = end;
  svg.onmousemove = (e) => move(e.clientX);
  svg.onmouseleave = end;
}

/* ---- calculator ---- */
function renderCalc() {
  const L = state.latest; if (!L) return;
  const perGram = state.calcKarat === '22' ? L.gold_22k : L.gold_24k;
  const val = parseFloat($('calcInput').value);
  $('calcInUnit').textContent = state.calcMode === 'qty' ? 'grams' : '₹';
  if (!isFinite(val) || val < 0) { $('calcOut').textContent = '—'; $('calcNote').textContent = ''; return; }
  if (state.calcMode === 'qty') {
    const out = val * perGram;
    tween($('calcOut'), out, fmtINR);
    $('calcNote').textContent = `${val} g of ${state.calcKarat}K · ${(val / 8).toFixed(2)} pavan · ${fmtINR(perGram)}/g`;
  } else {
    const grams = val / perGram;
    $('calcOut').dataset.v = grams;
    $('calcOut').textContent = grams.toFixed(3) + ' g';
    $('calcNote').textContent = `${fmtINR(val)} buys ${grams.toFixed(3)} g (${(grams / 8).toFixed(3)} pavan) of ${state.calcKarat}K`;
  }
}

/* ---- history ---- */
function renderHistory() {
  const m = unitMul(), all = state.history.slice().reverse();
  const rows = state.histExpanded ? all.slice(0, 120) : all.slice(0, 12);
  let html = '<div class="hist-row head"><span>Date</span><span style="text-align:right">24K</span><span style="text-align:right">22K</span></div>';
  for (const d of rows) {
    html += '<div class="hist-row"><span class="hist-date">' + fmtDateY(d.date) + (d.est ? '<span class="est-tag">est</span>' : '') + '</span>' +
      '<span class="hist-val">' + fmtINR(d.g24 * m) + '<small class="' + cls(d.d24) + '">' + arrow(d.d24) + ' ' + fmtSigned((d.d24 || 0) * m) + '</small></span>' +
      '<span class="hist-val">' + fmtINR(d.g22 * m) + '<small class="' + cls(d.d22) + '">' + arrow(d.d22) + ' ' + fmtSigned((d.d22 || 0) * m) + '</small></span></div>';
  }
  $('histList').innerHTML = html;
  $('histToggle').textContent = state.histExpanded ? 'Show less' : 'Show all';
  const firstReal = state.history.find((d) => !d.est);
  const note = $('estNote');
  if (firstReal && state.history.some((d) => d.est)) {
    note.hidden = false;
    note.textContent = `“est” days before ${fmtDateY(firstReal.date)} are modeled from international gold moves calibrated to today’s Bangalore premium. Live daily rates come from GoodReturns and replace them over time.`;
  } else note.hidden = true;
}

function renderSpot() {
  const L = state.latest, box = $('spotBox');
  if (!L || !L.spot || !L.spot.gold_24k_spot_inr_g) { box.hidden = true; return; }
  box.hidden = false;
  $('spotVal').textContent = fmtINR(L.spot.gold_24k_spot_inr_g * unitMul()) + (state.unit === 'g' ? ' /g' : state.unit === '8' ? ' /pavan' : ' /10g');
}

/* ---- helpers ---- */
function relTime(d) {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
let toastT;
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---- wiring ---- */
function bindSeg(segId, key, cast, after) {
  $(segId).addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.classList.remove('active'));
    b.classList.add('active');
    state[key] = cast(b.dataset[Object.keys(b.dataset)[0]]);
    (after || render)();
  });
}
async function refresh(manual) {
  const btn = $('refreshBtn'); btn.classList.add('spin');
  try { await loadData(); if (state.live) await refreshLiveSpot(); if (manual) toast('Updated'); }
  catch (e) { toast('Offline — showing saved data'); }
  finally { setTimeout(() => btn.classList.remove('spin'), 500); }
}

let liveTimer;
function startLiveTimer() { stopLiveTimer(); liveTimer = setInterval(refreshLiveSpot, 60000); }
function stopLiveTimer() { clearInterval(liveTimer); }

function init() {
  buildCoin();
  bindSeg('unitSeg', 'unit', (v) => v);
  bindSeg('metalSeg', 'metal', (v) => v);
  bindSeg('rangeSeg', 'range', (v) => parseInt(v, 10));
  bindSeg('calcModeSeg', 'calcMode', (v) => v, () => { $('calcInput').value = state.calcMode === 'qty' ? 8 : 100000; renderCalc(); });
  bindSeg('calcKaratSeg', 'calcKarat', (v) => v, renderCalc);
  $('calcInput').addEventListener('input', renderCalc);

  $('refreshBtn').addEventListener('click', () => refresh(true));
  $('histToggle').addEventListener('click', () => { state.histExpanded = !state.histExpanded; renderHistory(); });

  $('liveToggle').addEventListener('change', (e) => {
    state.live = e.target.checked;
    localStorage.setItem('gold.live', state.live ? '1' : '0');
    if (state.live) { refreshLiveSpot(); startLiveTimer(); } else { stopLiveTimer(); }
    renderLive();
  });
  if (localStorage.getItem('gold.live') === '1') { state.live = true; $('liveToggle').checked = true; }

  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if (isiOS && !standalone && localStorage.getItem('gold.hint') !== 'off') setTimeout(() => { $('installHint').hidden = false; }, 1500);
  $('installClose').addEventListener('click', () => { $('installHint').hidden = true; localStorage.setItem('gold.hint', 'off'); });

  loadData().then(() => { if (state.live) { refreshLiveSpot(); startLiveTimer(); } }).catch(() => toast('Could not load rates'));
  setInterval(() => refresh(false), REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
document.addEventListener('DOMContentLoaded', init);
