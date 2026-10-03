/* Candle Quest — a trading-education game.
   Everything runs in the browser: simulated markets, no network, no keys. */
'use strict';
(() => {

/* =========================================================================
   Utilities
   ========================================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt$ = v => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt$s = v => (v > 0 ? '+' : '') + fmt$(v);
const fmtP = p => p.toFixed(2);
const fmtR = r => r == null || !isFinite(r) ? '—' : (r >= 0 ? '+' : '') + r.toFixed(2) + 'R';
const fmtPct = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
const shuffle = (a, rng = Math.random) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const starSvg = on => `<svg class="star${on ? ' on' : ''}" aria-hidden="true"><use href="#i-star"/></svg>`;
const starsHtml = (n, of = 3) => `<span class="stars" aria-label="${n} of ${of} stars">${Array.from({ length: of }, (_, i) => starSvg(i < n)).join('')}</span>`;
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function gauss(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

/* =========================================================================
   Saved progress (localStorage, best-effort)
   ========================================================================= */
const SAVE_KEY = 'candlequest.v1';
const DEFAULT_STATE = () => ({
  v: 1, xp: 0, levels: {}, scen: {}, ach: {}, journal: [], daily: {}, endlessBest: null,
  sound: true, theme: 'system',
  counters: { smallLosses: 0, disciplineStreak: 0, winStreak: 0, trades: 0 },
});
let S = DEFAULT_STATE();
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) S = Object.assign(DEFAULT_STATE(), JSON.parse(raw));
  } catch (e) { /* storage unavailable: play without saving */ }
}
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

/* =========================================================================
   Sound (Web Audio, starts after the first click)
   ========================================================================= */
const Snd = {
  ctx: null,
  ensure() {
    if (!S.sound) return null;
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { return null; }
    return this.ctx;
  },
  tone(f, dur = .12, type = 'sine', vol = .08, delay = 0) {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .02);
  },
  play(name) {
    switch (name) {
      case 'click': this.tone(520, .05, 'triangle', .04); break;
      case 'fill': this.tone(740, .08, 'triangle', .07); this.tone(988, .1, 'triangle', .06, .06); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, .16, 'triangle', .07, i * .07)); break;
      case 'loss': this.tone(330, .18, 'sawtooth', .04); this.tone(220, .3, 'sawtooth', .04, .12); break;
      case 'right': this.tone(880, .1, 'triangle', .07); this.tone(1320, .14, 'triangle', .06, .08); break;
      case 'wrong': this.tone(200, .22, 'square', .04); break;
      case 'star': [784, 1175, 1568].forEach((f, i) => this.tone(f, .2, 'sine', .07, i * .1)); break;
      case 'alert': this.tone(660, .1, 'square', .05); this.tone(660, .1, 'square', .05, .16); break;
    }
  },
};

/* =========================================================================
   Theme
   ========================================================================= */
let T = {};
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = n => cs.getPropertyValue(n).trim();
  T = {
    bg: g('--chart-bg'), grid: g('--grid'), fg: g('--fg'), muted: g('--muted'), up: g('--up'), down: g('--down'),
    accent: g('--accent'), accentInk: g('--accent-ink'), info: g('--info'), panel: g('--panel'), panel2: g('--panel-2'), line: g('--line'),
    mono: '"JetBrains Mono", ui-monospace, Menlo, monospace', body: 'Figtree, system-ui, sans-serif', display: '"Chakra Petch", system-ui, sans-serif',
  };
}
function applyTheme() {
  const root = document.documentElement;
  if (S.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', S.theme);
  readTheme();
  redrawAll();
}
const themeNames = { system: 'Theme: follows system', dark: 'Theme: dark', light: 'Theme: light' };
function cycleTheme() {
  S.theme = { system: 'dark', dark: 'light', light: 'system' }[S.theme] || 'system';
  save(); applyTheme(); toast(themeNames[S.theme]);
}
function updateSoundIcons() {
  $$('.sound-toggle use').forEach(u => u.setAttribute('href', S.sound ? '#i-sound' : '#i-mute'));
}

/* =========================================================================
   Market simulation
   Prices follow waypoints (trend legs, ranges, crashes) joined by
   Brownian bridges, so every scenario is controllable but still noisy.
   ========================================================================= */
const TPC = 10; // ticks per candle

function buildWaypoints(rng, start, segs) {
  const wps = [{ t: 0, p: start }];
  const ranges = [];
  let t = 0, p = start;
  const rint = n => Math.floor(rng() * n);
  for (const s of segs) {
    const end = t + s.len;
    if (s.type === 'trend') {
      const dir = s.dir ?? (rng() < .5 ? 1 : -1), str = s.str ?? 1;
      while (t < end) {
        const imp = Math.min(end - t, 4 + rint(5));
        p *= 1 + dir * (.022 + rng() * .03) * str; t += imp; wps.push({ t, p });
        if (t >= end) break;
        const pb = Math.min(end - t, 3 + rint(4));
        p *= 1 - dir * (.01 + rng() * .014) * str; t += pb; wps.push({ t, p });
      }
    } else if (s.type === 'range') {
      const w = s.width ?? .06, mid = p;
      const lo = mid * (1 - w / 2), hi = mid * (1 + w / 2);
      ranges.push({ from: t, to: end, lo, hi });
      let up = rng() < .5;
      while (t < end) {
        const len = Math.min(end - t, 4 + rint(5));
        p = up ? hi * (1 - rng() * .005) : lo * (1 + rng() * .005);
        t += len; wps.push({ t, p, vol: s.vol ?? .0016 }); up = !up;
      }
    } else if (s.type === 'move') {
      p *= 1 + s.pct; t = end; wps.push({ t, p, vol: s.vol });
    } else if (s.type === 'parabola') {
      const t0 = t, steps = Math.max(2, Math.floor(s.len / 2)), total = Math.log(1 + s.pct);
      let sum = 0; for (let k = 1; k <= steps; k++) sum += k * k;
      for (let k = 1; k <= steps; k++) {
        p *= Math.exp(total * k * k / sum);
        wps.push({ t: t0 + Math.round(s.len * k / steps), p });
      }
      t = end;
    }
  }
  return { wps, ranges };
}

function bridgeTicks(rng, wps, vol) {
  const ticks = [];
  for (let w = 0; w < wps.length - 1; w++) {
    const a = wps[w], b = wps[w + 1];
    const n = (b.t - a.t) * TPC;
    if (n <= 0) continue;
    const s = b.vol ?? vol;
    const la = Math.log(a.p), lb = Math.log(b.p);
    const W = new Float64Array(n + 1);
    for (let i = 1; i <= n; i++) W[i] = W[i - 1] + gauss(rng) * s;
    for (let i = 0; i < n; i++) ticks.push(Math.exp(la + (lb - la) * i / n + (W[i] - W[n] * i / n)));
  }
  ticks.push(wps[wps.length - 1].p);
  return ticks;
}

function ticksToCandles(ticks) {
  const out = [], n = Math.floor((ticks.length - 1) / TPC);
  for (let k = 0; k < n; k++) out.push(candleFrom(ticks, k * TPC, TPC));
  return out;
}
function candleFrom(ticks, from, count) {
  let h = -Infinity, l = Infinity;
  for (let i = from; i < from + count; i++) { const p = ticks[i]; if (p > h) h = p; if (p < l) l = p; }
  return { o: ticks[from], h, l, c: ticks[from + count - 1] };
}

function makeMarket(seed, spec) {
  const rng = mulberry32(seed);
  const need = spec.hist + spec.live;
  const segs = spec.segs.slice();
  let len = segs.reduce((a, s) => a + s.len, 0);
  if (len < need) segs.push({ type: 'range', len: need - len + 2, width: .05 });
  const { wps, ranges } = buildWaypoints(rng, spec.start, segs);
  const ticks = bridgeTicks(rng, wps, spec.vol ?? .0024);
  const candles = ticksToCandles(ticks);
  const closes = candles.map(c => c.c);
  return { ticks, candles, ranges, ma20: sma(closes, 20), ma50: sma(closes, 50), rsi: rsiCalc(closes, 14), atr: atrCalc(candles, 14) };
}

function randomSegs(rng, total) {
  const segs = []; let t = 0;
  const rint = n => Math.floor(rng() * n);
  while (t < total) {
    const r = rng(); let s;
    if (r < .36) s = { type: 'trend', dir: 1, len: 15 + rint(22), str: .7 + rng() * .6 };
    else if (r < .66) s = { type: 'trend', dir: -1, len: 15 + rint(22), str: .7 + rng() * .6 };
    else if (r < .9) s = { type: 'range', len: 12 + rint(18), width: .04 + rng() * .05 };
    else if (r < .96) s = { type: 'move', pct: -(.07 + rng() * .08), len: 2 + rint(3), vol: .004 };
    else s = { type: 'move', pct: .07 + rng() * .08, len: 3 + rint(4), vol: .004 };
    segs.push(s); t += s.len;
  }
  return segs;
}

/* ---------- indicators ---------- */
function sma(v, n) {
  const out = new Array(v.length).fill(null); let sum = 0;
  for (let i = 0; i < v.length; i++) { sum += v[i]; if (i >= n) sum -= v[i - n]; if (i >= n - 1) out[i] = sum / n; }
  return out;
}
function rsiCalc(v, n) {
  const out = new Array(v.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); }
  }
  return out;
}
function atrCalc(c, n) {
  const out = new Array(c.length).fill(null); let a = 0;
  for (let i = 0; i < c.length; i++) {
    const tr = i ? Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)) : c[i].h - c[i].l;
    if (i < n) { a += tr; if (i === n - 1) { a /= n; out[i] = a; } } else { a = (a * (n - 1) + tr) / n; out[i] = a; }
  }
  for (let i = 0; i < n - 1 && i < c.length; i++) out[i] = out[n - 1] ?? (c[i].h - c[i].l);
  return out;
}

/* =========================================================================
   Chart renderer (canvas)
   ========================================================================= */
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

class Chart {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1; this.s = null; this.g = null;
    this.dragId = null; this.frozen = null; this.hoverIdx = -1; this.hoverLine = null;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('pointerleave', () => { if (this.dragId == null) { this.hoverIdx = -1; this.hoverLine = null; this.render(); } });
  }
  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(r.width * this.dpr); this.cv.height = Math.round(r.height * this.dpr);
    this.w = r.width; this.h = r.height; this.render();
  }
  set(s) { this.s = s; this.render(); }
  geom() {
    const s = this.s, axisW = 64;
    const rsiH = s.rsi ? Math.round(clamp(this.h * .2, 56, 120)) : 0;
    const plot = { x: 6, y: 10, w: this.w - axisW - 6, h: this.h - 22 - (rsiH ? rsiH + 10 : 0) };
    const n = s.candles.length;
    const maxSlots = clamp(Math.floor(plot.w / 9), 24, 140);
    const slots = s.fitAll ? n + 1 : Math.max(30, Math.min(maxSlots, n + 6));
    const start = s.fitAll ? 0 : Math.max(0, n - slots + 6);
    const slot = plot.w / slots;
    let lo, hi;
    if (this.dragId != null && this.frozen) ({ lo, hi } = this.frozen);
    else {
      lo = Infinity; hi = -Infinity;
      for (let i = start; i < n; i++) { const c = s.candles[i]; if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
      for (const ln of s.lines || []) if (ln.scale !== false && ln.price > 0) { lo = Math.min(lo, ln.price); hi = Math.max(hi, ln.price); }
      const pad = (hi - lo) * .08 || 1; lo -= pad; hi += pad;
      this.frozen = { lo, hi };
    }
    const rsiBox = rsiH ? { x: plot.x, y: plot.y + plot.h + 10, w: plot.w, h: rsiH } : null;
    const y = p => plot.y + (hi - p) / (hi - lo) * plot.h;
    const py = yy => hi - (yy - plot.y) / plot.h * (hi - lo);
    const x = i => plot.x + (i - start + .5) * slot;
    return { plot, axisW, slot, start, n, lo, hi, rsiBox, y, py, x };
  }
  render() {
    if (!this.s || !this.w) return;
    const ctx = this.ctx, s = this.s;
    const g = this.g = this.geom();
    const { plot, y, x, slot, start, n } = g;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, this.w, this.h);

    // horizontal grid + price axis
    const step = niceStep((g.hi - g.lo) / 6);
    ctx.font = `11px ${T.mono}`; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(g.lo / step) * step; v <= g.hi; v += step) {
      const yy = Math.round(y(v)) + .5;
      ctx.strokeStyle = T.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(plot.x, yy); ctx.lineTo(plot.x + plot.w, yy); ctx.stroke();
      ctx.fillStyle = T.muted; ctx.textAlign = 'left';
      ctx.fillText(v.toFixed(step < .1 ? 2 : step < 1 ? 1 : 0), plot.x + plot.w + 8, yy);
    }
    // vertical grid
    for (let i = start; i < n; i++) if (i % 10 === 0) {
      const xx = Math.round(x(i)) + .5;
      ctx.strokeStyle = T.grid; ctx.beginPath(); ctx.moveTo(xx, plot.y); ctx.lineTo(xx, plot.y + plot.h); ctx.stroke();
    }
    // range zones (used for the S/R reveal)
    for (const z of s.zones || []) {
      ctx.fillStyle = z.color; ctx.globalAlpha = .12;
      ctx.fillRect(plot.x, y(z.hi), plot.w, y(z.lo) - y(z.hi)); ctx.globalAlpha = 1;
    }
    // hover column
    if (s.onTap && this.hoverIdx >= start && this.hoverIdx < n) {
      ctx.fillStyle = T.accent; ctx.globalAlpha = .1;
      ctx.fillRect(x(this.hoverIdx) - slot / 2, plot.y, slot, plot.h); ctx.globalAlpha = 1;
    }
    // moving averages
    for (const m of s.mas || []) {
      ctx.strokeStyle = m.color; ctx.lineWidth = 1.6; ctx.beginPath(); let on = false;
      for (let i = start; i < Math.min(n, m.vals.length); i++) {
        const v = m.vals[i]; if (v == null) continue;
        if (!on) { ctx.moveTo(x(i), y(v)); on = true; } else ctx.lineTo(x(i), y(v));
      }
      ctx.stroke();
    }
    // candles
    const bw = Math.max(1, Math.min(slot * .64, 22));
    for (let i = start; i < n; i++) {
      const c = s.candles[i], xx = x(i), col = c.c >= c.o ? T.up : T.down;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(xx) - .5, y(c.h), 1.2, Math.max(1, y(c.l) - y(c.h)));
      const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
      ctx.fillRect(xx - bw / 2, top, bw, Math.max(1.2, bot - top));
    }
    // highlights (quiz)
    for (const [idx, color] of s.highlights || []) {
      if (idx < start || idx >= n) continue;
      const c = s.candles[idx];
      ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.strokeRect(x(idx) - slot / 2 + 1, y(c.h) - 6, slot - 2, y(c.l) - y(c.h) + 12);
    }
    // trade markers
    for (const m of s.markers || []) {
      if (m.idx < start || m.idx >= n) continue;
      const xx = x(m.idx), yy = y(m.price);
      ctx.fillStyle = m.color; ctx.beginPath();
      if (m.kind === 'entry') { const d = m.side > 0 ? 1 : -1; ctx.moveTo(xx, yy + d * 2); ctx.lineTo(xx - 6, yy + d * 12); ctx.lineTo(xx + 6, yy + d * 12); }
      else { ctx.arc(xx, yy, 4.5, 0, Math.PI * 2); }
      ctx.fill();
      if (m.kind !== 'entry') { ctx.strokeStyle = T.bg; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    // horizontal lines (stop, target, entry, user lines)
    for (const ln of s.lines || []) this.drawLine(ln, g);
    // last-price tag
    if (s.last != null) {
      const yy = Math.round(y(s.last)) + .5;
      ctx.setLineDash([2, 3]); ctx.strokeStyle = T.muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(plot.x, yy); ctx.lineTo(plot.x + plot.w, yy); ctx.stroke(); ctx.setLineDash([]);
      this.tag(yy, fmtP(s.last), T.fg, T.bg, g);
    }
    // RSI pane
    if (g.rsiBox && s.rsi) {
      const b = g.rsiBox, ry = v => b.y + (100 - v) / 100 * b.h;
      ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.strokeRect(b.x + .5, b.y + .5, b.w, b.h);
      ctx.fillStyle = T.accent; ctx.globalAlpha = .07; ctx.fillRect(b.x, ry(70), b.w, ry(30) - ry(70)); ctx.globalAlpha = 1;
      ctx.setLineDash([3, 3]); ctx.strokeStyle = T.muted;
      [70, 30].forEach(v => { ctx.beginPath(); ctx.moveTo(b.x, ry(v)); ctx.lineTo(b.x + b.w, ry(v)); ctx.stroke(); });
      ctx.setLineDash([]);
      ctx.fillStyle = T.muted; ctx.font = `10px ${T.mono}`; ctx.textAlign = 'left';
      ctx.fillText('70', b.x + b.w + 8, ry(70)); ctx.fillText('30', b.x + b.w + 8, ry(30));
      ctx.fillText('RSI 14', b.x + 6, b.y + 10);
      ctx.strokeStyle = T.info; ctx.lineWidth = 1.5; ctx.beginPath(); let on = false;
      for (let i = start; i < Math.min(n, s.rsi.length); i++) {
        const v = s.rsi[i]; if (v == null) continue;
        if (!on) { ctx.moveTo(x(i), ry(v)); on = true; } else ctx.lineTo(x(i), ry(v));
      }
      ctx.stroke();
    }
    // legend
    if (s.legend) {
      ctx.font = `600 11px ${T.body}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      let lx = plot.x + 8;
      const ly = plot.y + plot.h - 18;
      for (const l of s.legend) {
        ctx.fillStyle = l.color; ctx.fillRect(lx, ly + 5, 12, 3); lx += 16;
        ctx.fillStyle = T.muted; ctx.fillText(l.label, lx, ly); lx += ctx.measureText(l.label).width + 14;
      }
    }
  }
  drawLine(ln, g) {
    const ctx = this.ctx, { plot } = g;
    const yy = Math.round(g.y(ln.price)) + .5;
    if (yy < plot.y - 2 || yy > plot.y + plot.h + 2) return;
    const active = this.dragId === ln.id || this.hoverLine === ln.id;
    ctx.strokeStyle = ln.color; ctx.lineWidth = active ? 2.6 : 1.6;
    ctx.setLineDash(ln.dash ? [6, 4] : []);
    ctx.beginPath(); ctx.moveTo(plot.x, yy); ctx.lineTo(plot.x + plot.w, yy); ctx.stroke(); ctx.setLineDash([]);
    if (ln.label) {
      ctx.font = `600 11px ${T.body}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const tw = ctx.measureText(ln.label).width;
      ctx.fillStyle = T.bg; ctx.globalAlpha = .85; ctx.fillRect(plot.x + 6, yy - 9, tw + 10, 18); ctx.globalAlpha = 1;
      ctx.fillStyle = ln.color; ctx.fillText(ln.label, plot.x + 11, yy);
    }
    if (ln.draggable) {
      const gx = plot.x + plot.w - 22;
      ctx.fillStyle = ln.color; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(gx - 12, yy - 7, 24, 14, 4) : ctx.rect(gx - 12, yy - 7, 24, 14); ctx.fill();
      ctx.strokeStyle = ln.ink || '#fff'; ctx.lineWidth = 1.2;
      for (const d of [-4, 0, 4]) { ctx.beginPath(); ctx.moveTo(gx + d, yy - 3.5); ctx.lineTo(gx + d, yy + 3.5); ctx.stroke(); }
    }
    this.tag(yy, fmtP(ln.price), ln.color, ln.ink || '#fff', g);
  }
  tag(yy, text, bg, ink, g) {
    const ctx = this.ctx, x0 = g.plot.x + g.plot.w + 2;
    ctx.fillStyle = bg; ctx.fillRect(x0, yy - 9, g.axisW - 4, 18);
    ctx.fillStyle = ink; ctx.font = `600 11px ${T.mono}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x0 + 5, yy);
  }
  pos(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  hitLine(p) {
    if (!this.g || !this.s) return null;
    let best = null, bd = 14;
    for (const ln of this.s.lines || []) {
      if (!ln.draggable) continue;
      const d = Math.abs(this.g.y(ln.price) - p.y);
      if (d < bd) { bd = d; best = ln; }
    }
    return best;
  }
  idxAt(px) {
    const g = this.g; if (!g || px < g.plot.x || px > g.plot.x + g.plot.w) return -1;
    const i = g.start + Math.floor((px - g.plot.x) / g.slot);
    return i < g.n ? i : -1;
  }
  down(e) {
    const p = this.pos(e), ln = this.hitLine(p);
    if (ln) { this.dragId = ln.id; this.cv.setPointerCapture(e.pointerId); e.preventDefault(); this.render(); return; }
    if (this.s && this.s.onTap) { const i = this.idxAt(p.x); if (i >= 0 && p.y <= this.g.plot.y + this.g.plot.h) this.s.onTap(i); }
  }
  move(e) {
    const p = this.pos(e);
    if (this.dragId != null) {
      const ln = (this.s.lines || []).find(l => l.id === this.dragId);
      if (ln && ln.onDrag) ln.onDrag(clamp(this.g.py(p.y), this.g.lo, this.g.hi));
      this.render(); return;
    }
    const ln = this.hitLine(p);
    const hl = ln ? ln.id : null;
    let idx = -1;
    if (!ln && this.s && this.s.onTap) idx = this.idxAt(p.x);
    this.cv.style.cursor = ln ? 'ns-resize' : idx >= 0 ? 'pointer' : 'crosshair';
    if (hl !== this.hoverLine || idx !== this.hoverIdx) { this.hoverLine = hl; this.hoverIdx = idx; this.render(); }
  }
  up() {
    if (this.dragId != null) {
      const ln = (this.s.lines || []).find(l => l.id === this.dragId);
      this.dragId = null;
      if (ln && ln.onDragEnd) ln.onDragEnd();
      this.render();
    }
  }
}

/* =========================================================================
   Lesson illustrations
   ========================================================================= */
function setupCanvas(cv) {
  const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
  const ctx = cv.getContext('2d'); ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
function label(ctx, text, x, y, color, align = 'left', size = 12, weight = 600, font = T.body) {
  ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
function candleShape(ctx, x, o, h, l, c, bw, col) {
  ctx.fillStyle = col; ctx.fillRect(x - 1, h, 2, l - h);
  ctx.fillRect(x - bw / 2, Math.min(o, c), bw, Math.abs(c - o));
}
function arrowLine(ctx, x1, y1, x2, y2, col) {
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
}
const ILLUS = {
  anatomy(ctx, w, h) {
    const bw = 34;
    const xs = [w * .26, w * .7];
    // bullish
    let x = xs[0]; const b = { h: h * .12, c: h * .3, o: h * .62, l: h * .8 };
    candleShape(ctx, x, b.o, b.h, b.l, b.c, bw, T.up);
    [['High', b.h], ['Close', b.c], ['Open', b.o], ['Low', b.l]].forEach(([t, yy]) => { arrowLine(ctx, x + bw / 2 + 4, yy, x + 60, yy, T.muted); label(ctx, t, x + 64, yy, T.fg); });
    label(ctx, 'upper wick', x - bw / 2 - 8, (b.h + b.c) / 2, T.muted, 'right', 11, 500);
    label(ctx, 'body', x - bw / 2 - 8, (b.c + b.o) / 2, T.muted, 'right', 11, 500);
    label(ctx, 'lower wick', x - bw / 2 - 8, (b.o + b.l) / 2, T.muted, 'right', 11, 500);
    label(ctx, 'Bullish: closed higher', x, h * .92, T.up, 'center', 13, 700);
    // bearish
    x = xs[1]; const r = { h: h * .16, o: h * .3, c: h * .6, l: h * .82 };
    candleShape(ctx, x, r.o, r.h, r.l, r.c, bw, T.down);
    [['High', r.h], ['Open', r.o], ['Close', r.c], ['Low', r.l]].forEach(([t, yy]) => { arrowLine(ctx, x + bw / 2 + 4, yy, x + 60, yy, T.muted); label(ctx, t, x + 64, yy, T.fg); });
    label(ctx, 'Bearish: closed lower', x, h * .92, T.down, 'center', 13, 700);
  },
  trend(ctx, w, h) {
    const pts = [[.05, .8], [.13, .6], [.19, .7], [.27, .45], [.33, .55], [.42, .25]];
    ctx.strokeStyle = T.up; ctx.lineWidth = 2.5; ctx.beginPath();
    pts.forEach(([px, py], i) => i ? ctx.lineTo(px * w, py * h) : ctx.moveTo(px * w, py * h)); ctx.stroke();
    [[1, 'HH'], [3, 'HH'], [5, 'HH']].forEach(([i, t]) => label(ctx, t, pts[i][0] * w, pts[i][1] * h - 14, T.up, 'center', 11, 700, T.mono));
    [[2, 'HL'], [4, 'HL']].forEach(([i, t]) => label(ctx, t, pts[i][0] * w, pts[i][1] * h + 14, T.accent, 'center', 11, 700, T.mono));
    label(ctx, 'Uptrend: higher highs,', w * .24, h * .9, T.fg, 'center', 12, 600);
    label(ctx, 'higher lows', w * .24, h * .96, T.fg, 'center', 12, 600);
    // range
    const x0 = w * .55, x1 = w * .97, rt = h * .28, rb = h * .66;
    ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    ctx.strokeStyle = T.down; ctx.beginPath(); ctx.moveTo(x0, rt); ctx.lineTo(x1, rt); ctx.stroke();
    ctx.strokeStyle = T.up; ctx.beginPath(); ctx.moveTo(x0, rb); ctx.lineTo(x1, rb); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, 'Resistance: sellers step in', x0, rt - 14, T.down, 'left', 11, 700);
    label(ctx, 'Support: buyers step in', x0, rb + 14, T.up, 'left', 11, 700);
    ctx.strokeStyle = T.fg; ctx.lineWidth = 2; ctx.beginPath();
    const zz = [[0, .5], [.12, .3], [.27, .65], [.42, .29], [.57, .64], [.72, .3], [.86, .62], [1, .45]];
    zz.forEach(([px, py], i) => { const X = x0 + px * (x1 - x0), Y = py * h; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
    label(ctx, 'Range: price bounces between levels', (x0 + x1) / 2, h * .9, T.fg, 'center', 12, 600);
  },
  spread(ctx, w, h) {
    const rows = [['100.08', ''], ['100.06', ''], ['100.04', 'ASK'], ['', ''], ['99.96', 'BID'], ['99.94', ''], ['99.92', '']];
    const x = w * .14, rowH = h * .1, y0 = h * .14;
    rows.forEach(([p, t], i) => {
      const yy = y0 + i * rowH;
      if (!p) return;
      const col = t === 'ASK' ? T.down : t === 'BID' ? T.up : T.muted;
      ctx.fillStyle = t ? col : T.panel2; ctx.globalAlpha = t ? .18 : 1; ctx.fillRect(x, yy - rowH / 2 + 2, w * .3, rowH - 4); ctx.globalAlpha = 1;
      label(ctx, p, x + 12, yy, t ? col : T.muted, 'left', 13, 600, T.mono);
      if (t) label(ctx, t, x + w * .3 - 10, yy, col, 'right', 12, 700, T.mono);
    });
    const ya = y0 + 2 * rowH, yb = y0 + 4 * rowH;
    label(ctx, 'You BUY at the ask', x + w * .34, ya, T.fg, 'left', 13, 700);
    label(ctx, 'You SELL at the bid', x + w * .34, yb, T.fg, 'left', 13, 700);
    ctx.strokeStyle = T.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 8, ya); ctx.lineTo(x - 14, ya); ctx.lineTo(x - 14, yb); ctx.lineTo(x - 8, yb); ctx.stroke();
    label(ctx, 'spread', x - 18, (ya + yb) / 2, T.accent, 'right', 11, 700);
    label(ctx, 'Market order: fills now, at the ask or bid.', w * .5, h * .86, T.fg, 'center', 12, 600);
    label(ctx, 'Limit order: waits for your price. May never fill.', w * .5, h * .94, T.muted, 'center', 12, 600);
  },
  stops(ctx, w, h) {
    const n = 40, x = i => w * .08 + i / (n - 1) * w * .86;
    const base = i => h * .6 - i * h * .007 + Math.sin(i * 1.3) * h * .025;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = T.down; ctx.beginPath();
    for (let i = 0; i < n; i++) { const yy = i < 26 ? base(i) : base(25) + Math.min(1, (i - 25) / 3) * h * .32; i ? ctx.lineTo(x(i), yy) : ctx.moveTo(x(i), yy); } ctx.stroke();
    ctx.strokeStyle = T.up; ctx.beginPath();
    for (let i = 0; i < n; i++) { const yy = i < 26 ? base(i) - 2 : base(25) + h * .04 - (i - 27) * h * .004; i ? ctx.lineTo(x(i), yy) : ctx.moveTo(x(i), yy); } ctx.stroke();
    label(ctx, 'Account with stop-losses', x(29), base(25) - 4, T.up, 'left', 12, 700);
    label(ctx, 'No stops: one crash wipes', x(27), h * .86, T.down, 'left', 12, 700);
    label(ctx, 'out months of gains', x(27), h * .92, T.down, 'left', 12, 700);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = T.muted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(25), h * .1); ctx.lineTo(x(25), h * .95); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, 'crash', x(25), h * .07, T.muted, 'center', 11, 700, T.mono);
    label(ctx, 'Account value', w * .08, h * .07, T.muted, 'left', 11, 700);
  },
  sizing(ctx, w, h) {
    label(ctx, 'Shares =', w * .5, h * .17, T.muted, 'center', 15, 600);
    label(ctx, '(Account × Risk %) ÷ Stop distance', w * .5, h * .29, T.fg, 'center', Math.min(20, w / 22), 700, T.display);
    ctx.fillStyle = T.panel2; ctx.fillRect(w * .08, h * .42, w * .84, h * .24);
    label(ctx, 'Account $10,000 × 1% = $100 at risk', w * .5, h * .5, T.fg, 'center', 13, 600, T.mono);
    label(ctx, 'Stop $2.00 below entry → $100 ÷ $2 = 50 shares', w * .5, h * .59, T.accent, 'center', 13, 700, T.mono);
    // bar: 100 cells, 1 highlighted
    const cw = (w * .84) / 50, y = h * .76;
    for (let i = 0; i < 50; i++) { ctx.fillStyle = i === 0 ? T.down : T.up; ctx.globalAlpha = i === 0 ? 1 : .35; ctx.fillRect(w * .08 + i * cw + 1, y, cw - 2, 14); }
    ctx.globalAlpha = 1;
    label(ctx, 'Risk 2% per trade → you can be wrong 50 times', w * .5, y + 32, T.muted, 'center', 12, 600);
  },
  rr(ctx, w, h) {
    const rows = [['1 : 1', 50], ['1 : 2', 33.3], ['1 : 3', 25]];
    label(ctx, 'Win rate needed just to break even', w * .5, h * .1, T.fg, 'center', 14, 700);
    rows.forEach(([t, v], i) => {
      const y = h * (.26 + i * .2), x0 = w * .2, bw = w * .68;
      label(ctx, t, x0 - 12, y, T.fg, 'right', 14, 700, T.mono);
      ctx.fillStyle = T.panel2; ctx.fillRect(x0, y - 12, bw, 24);
      ctx.fillStyle = [T.down, T.accent, T.up][i]; ctx.fillRect(x0, y - 12, bw * v / 100, 24);
      label(ctx, v.toFixed(0) + '%', x0 + bw * v / 100 + 8, y, T.fg, 'left', 13, 700, T.mono);
    });
    label(ctx, 'Risk $1 to make $3 and you can lose 7 of 10 trades', w * .5, h * .86, T.muted, 'center', 12, 600);
    label(ctx, 'and still come out ahead.', w * .5, h * .93, T.muted, 'center', 12, 600);
  },
  indicators(ctx, w, h) {
    const n = 60, x = i => w * .05 + i / (n - 1) * w * .9;
    const price = []; for (let i = 0; i < n; i++) price.push(h * .35 + Math.cos(i / 9) * h * .12 + Math.sin(i * 1.7) * h * .02);
    const ma = (k) => price.map((_, i) => { const a = price.slice(Math.max(0, i - k + 1), i + 1); return a.reduce((s, v) => s + v, 0) / a.length; });
    const f = ma(5), sl = ma(14);
    const line = (arr, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); arr.forEach((v, i) => i ? ctx.lineTo(x(i), v) : ctx.moveTo(x(i), v)); ctx.stroke(); };
    line(price, T.muted, 1); line(sl, T.info, 2.2); line(f, T.accent, 2.2);
    for (let i = 15; i < n; i++) if ((f[i - 1] - sl[i - 1]) * (f[i] - sl[i]) < 0) {
      const bull = f[i] < sl[i];
      ctx.fillStyle = bull ? T.up : T.down; ctx.beginPath(); ctx.arc(x(i), f[i], 6, 0, Math.PI * 2); ctx.fill();
      label(ctx, bull ? 'bullish cross' : 'bearish cross', x(i), f[i] + (bull ? 18 : -18), bull ? T.up : T.down, 'center', 11, 700);
    }
    label(ctx, 'fast MA', w * .06, h * .06, T.accent, 'left', 11, 700); label(ctx, 'slow MA', w * .2, h * .06, T.info, 'left', 11, 700);
    // RSI
    const y0 = h * .64, rh = h * .3, ry = v => y0 + (100 - v) / 100 * rh;
    ctx.strokeStyle = T.line; ctx.strokeRect(w * .05, y0, w * .9, rh);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = T.muted; [70, 30].forEach(v => { ctx.beginPath(); ctx.moveTo(w * .05, ry(v)); ctx.lineTo(w * .95, ry(v)); ctx.stroke(); }); ctx.setLineDash([]);
    ctx.strokeStyle = T.info; ctx.lineWidth = 1.8; ctx.beginPath();
    for (let i = 0; i < n; i++) { const v = 50 - Math.sin(i / 9) * 32; i ? ctx.lineTo(x(i), ry(v)) : ctx.moveTo(x(i), ry(v)); } ctx.stroke();
    label(ctx, 'RSI > 70: stretched up', w * .94, ry(84), T.muted, 'right', 10, 600);
    label(ctx, 'RSI < 30: stretched down', w * .94, ry(16), T.muted, 'right', 10, 600);
  },
  psych(ctx, w, h) {
    const cx = w * .5, cy = h * .62, r = Math.min(w * .36, h * .48);
    const segs = [[T.up, 'Plan'], [T.accent, 'Doubt'], [T.down, 'Tilt']];
    segs.forEach(([col], i) => {
      ctx.strokeStyle = col; ctx.lineWidth = 22; ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI + i * Math.PI / 3 + .03, Math.PI + (i + 1) * Math.PI / 3 - .03); ctx.stroke();
    });
    segs.forEach(([col, t], i) => {
      const a = Math.PI + (i + .5) * Math.PI / 3;
      label(ctx, t, cx + Math.cos(a) * (r + 30), cy + Math.sin(a) * (r + 26), col, 'center', 13, 700, T.display);
    });
    const a = Math.PI + .5;
    ctx.strokeStyle = T.fg; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r * .8, cy + Math.sin(a) * r * .8); ctx.stroke();
    ctx.fillStyle = T.fg; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    label(ctx, 'Tilt = FOMO, revenge trades, moving your stop', cx, cy + 26, T.muted, 'center', 12, 600);
    label(ctx, 'Your job: keep the needle on the left', cx, cy + 46, T.fg, 'center', 12, 700);
  },
};

/* =========================================================================
   Curriculum
   ========================================================================= */
const RISK_OK = 2.05; // tolerance for the 2% rule
const allDisciplined = s => s.n > 0 && s.trades.every(t => t.hadStop && t.riskPct <= RISK_OK);

const LEVELS = [
  {
    id: 1, title: 'Reading Candles', sub: 'OHLC, bodies and wicks', type: 'quiz', quiz: 'candles', illus: 'anatomy',
    points: [
      'Each candle is one slice of time. It records four prices: <b>Open, High, Low, Close</b> (OHLC).',
      'The <b>body</b> runs from open to close. Teal means it closed higher than it opened (bullish). Red means it closed lower (bearish).',
      'The <b>wicks</b> are prices that traded but did not hold. A long lower wick means sellers pushed down and buyers pushed it back up.',
      'A candle with almost no body is a <b>doji</b>: buyers and sellers fought to a draw.',
    ],
    rule: 'The close matters most. It is where the fight for that candle ended.',
    stars: ['Get 3 of 6 right', 'Get 5 of 6 right', 'Perfect 6 of 6'],
    takeaway: 'Big bodies show conviction. Long wicks show rejection. Tiny bodies show indecision. You will read these signals in every level that follows.',
  },
  {
    id: 2, title: 'Trends & Levels', sub: 'Support, resistance, direction', type: 'quiz', quiz: 'levels', illus: 'trend',
    points: [
      'An <b>uptrend</b> makes higher highs and higher lows. A <b>downtrend</b> makes lower highs and lower lows. Anything else is <b>sideways</b>.',
      '<b>Support</b> is a price where buyers keep showing up, so drops stall there. <b>Resistance</b> is where sellers keep showing up.',
      'Draw levels where price turned more than once. One touch is a coincidence. Three touches is a level.',
      'Trading with the trend is like swimming with the current. You can fight it, but it costs you.',
    ],
    rule: 'Zoom out first. Know the trend before you look for a trade.',
    stars: ['Get 3 of 6 right', 'Get 5 of 6 right', 'Perfect 6 of 6'],
    takeaway: 'Levels are zones, not exact prices. You only need to be roughly right about where buyers and sellers are waiting.',
  },
  {
    id: 3, title: 'Your First Trade', sub: 'Market, limit and the spread', type: 'trade', illus: 'spread', sym: 'ACME',
    points: [
      'Going <b>long</b> means you buy and profit if the price rises. Going <b>short</b> means you sell first and profit if it falls.',
      'A <b>market order</b> fills right away. Buys fill at the <b>ask</b>, sells at the <b>bid</b>. The gap between them is the <b>spread</b>, and you pay it on every round trip.',
      'A <b>limit order</b> waits for a better price, like buying a pullback. It might never fill, and that is fine.',
      'Your P&amp;L is (exit − entry) × shares, minus fees. Every trade starts slightly negative because of the spread.',
    ],
    rule: 'Decide where you want in before you click. Limit orders force you to plan.',
    rules: { sizing: 'manual', qtys: [10, 25, 50], allowLimit: true, stop: 'off', target: 'off' },
    market: { start: 100, hist: 40, live: 60, segs: [{ type: 'trend', dir: 1, len: 40 }, { type: 'trend', dir: 1, len: 30 }, { type: 'range', len: 15, width: .05 }, { type: 'trend', dir: 1, len: 15 }] },
    intro: 'This market is trending up. Try a market buy, then place a limit buy below the price and wait for it to fill. Notice the spread: you buy at the ask and sell at the bid.',
    stars: [
      { label: 'Finish with a profit', check: s => s.net > 0, why: s => `Net P&L ${fmt$s(s.net)}.` },
      { label: 'Get a limit order filled', check: s => s.limitFills > 0, why: s => s.limitFills ? `${s.limitFills} limit fill${s.limitFills > 1 ? 's' : ''}.` : 'Place a limit buy below the price during a pullback and let the market come to you.' },
      { label: "Don't overtrade: 1 to 5 trades", check: s => s.n >= 1 && s.n <= 5, why: s => `${s.n} trade${s.n === 1 ? '' : 's'}. Every trade pays the spread, so more trades is not more profit.` },
    ],
    takeaway: 'Every click costs the spread. Patient traders let limit orders come to them.',
  },
  {
    id: 4, title: 'Stop-Losses', sub: 'Decide your exit before you enter', type: 'trade', illus: 'stops', sym: 'BOLT',
    points: [
      'A <b>stop-loss</b> is an order that closes your trade automatically if the price moves against you by a set amount.',
      'Put it where your idea is <b>proven wrong</b>, for example just below a recent swing low for a long trade.',
      'Without a stop, a single bad day can erase weeks of gains. Prices can fall faster than you can react.',
      'In a fast drop, a stop can fill a little worse than its price. That is <b>slippage</b>. It still beats having no exit.',
    ],
    rule: 'Every trade gets a stop-loss before you click buy. No exceptions.',
    rules: { sizing: 'manual', qtys: [25, 50, 100], allowLimit: true, stop: 'optional', target: 'off' },
    market: { start: 80, hist: 40, live: 70, segs: [{ type: 'trend', dir: 1, len: 40, str: .8 }, { type: 'trend', dir: 1, len: 35, str: .8 }, { type: 'move', pct: -.13, len: 3, vol: .005 }, { type: 'move', pct: .03, len: 4 }, { type: 'range', len: 28, width: .05 }] },
    intro: 'Your stop-loss is the red dashed line. Drag it to where your trade is proven wrong. Markets do not warn you before they drop.',
    stars: [
      { label: 'Finish with a profit', check: s => s.net > 0, why: s => `Net P&L ${fmt$s(s.net)}.` },
      { label: 'Every trade has a stop-loss', check: s => s.n > 0 && s.trades.every(t => t.hadStop), why: s => s.n ? `${s.trades.filter(t => t.hadStop).length} of ${s.n} trades had a stop.` : 'You need at least one trade.' },
      { label: 'Keep max drawdown under 3%', check: s => s.n > 0 && s.maxDD < 3, why: s => `Your deepest drop from peak was ${s.maxDD.toFixed(2)}%.` },
    ],
    takeaway: 'A stop turns an unknown loss into a known, small one. The crash in this round would have taken 13% from anyone holding 100 shares without one.',
  },
  {
    id: 5, title: 'Position Sizing', sub: 'The 1–2% rule', type: 'trade', illus: 'sizing', sym: 'NOVA', preQuiz: true,
    points: [
      'Pro traders decide <b>how much they can lose</b> first, then work out the share count. Not the other way round.',
      'The common rule: risk <b>1–2% of your account</b> per trade. With 2%, ten losses in a row still leave you about 82% of your account.',
      'Risk 10% per trade and five losses in a row leave you about 59%. Then you need a 69% gain just to get back to even.',
      'A wider stop means fewer shares. A tighter stop means more shares. The dollar risk stays the same.',
    ],
    rule: 'Size every trade so that being wrong costs 2% or less.',
    rules: { sizing: 'risk', defaultRisk: 5, allowLimit: true, stop: 'required', target: 'off' },
    market: { start: 60, hist: 40, live: 80, segs: [{ type: 'range', len: 40, width: .06 }, { type: 'trend', dir: 1, len: 20 }, { type: 'range', len: 20, width: .05 }, { type: 'trend', dir: -1, len: 20 }, { type: 'trend', dir: 1, len: 20 }] },
    intro: 'The risk slider starts at 5%. That is too much. Bring it down to 2% or less; the readout turns red above 2%. Share count is calculated from your stop distance.',
    stars: [
      { label: 'Finish with a profit', check: s => s.net > 0, why: s => `Net P&L ${fmt$s(s.net)}.` },
      { label: 'Risk 2% or less on every trade', check: allDisciplined, why: s => s.n ? `${s.trades.filter(t => t.hadStop && t.riskPct <= RISK_OK).length} of ${s.n} trades within 2%.` : 'You need at least one trade.' },
      { label: 'Ace the sizing quiz (3 of 3)', check: s => s.quizScore === 3, why: s => `You scored ${s.quizScore ?? 0} of 3.` },
    ],
    takeaway: 'Small risk per trade is what keeps you in the game long enough for your edge to show up.',
  },
  {
    id: 6, title: 'Risk / Reward', sub: 'Why a 40% win rate can win', type: 'trade', illus: 'rr', sym: 'KITE',
    points: [
      '<b>R</b> is the amount you risk on a trade. Lose $100 with a $100 risk and that is −1R. Make $250 and that is +2.5R.',
      'If your winners are <b>2R</b> and your losers are <b>1R</b>, you only need to win more than 1 in 3 trades to make money.',
      'Set a <b>take-profit</b> where the market is likely to stall, such as the next resistance level.',
      'Once a trade is up 1R, moving your stop to <b>breakeven</b> turns it into a free trade.',
    ],
    rule: 'Only take trades where the potential reward is at least 2× the risk.',
    rules: { sizing: 'risk', defaultRisk: 1, allowLimit: true, stop: 'required', target: 'optional', defaultTarget: 2 },
    market: { start: 140, hist: 40, live: 80, segs: [{ type: 'trend', dir: -1, len: 40 }, { type: 'trend', dir: 1, len: 30, str: 1.2 }, { type: 'range', len: 10, width: .04 }, { type: 'trend', dir: -1, len: 25, str: 1.2 }, { type: 'range', len: 15, width: .05 }] },
    intro: 'Take-profit is the green dashed line. Plan every trade at 2R or better: the preview shows your R:R before you click.',
    stars: [
      { label: 'Finish with a profit', check: s => s.net > 0, why: s => `Net P&L ${fmt$s(s.net)}.` },
      { label: 'Plan every trade at 1:2 or better', check: s => allDisciplined(s) && s.trades.every(t => t.plannedRR >= 1.95), why: s => s.n ? `${s.trades.filter(t => t.hadStop && t.plannedRR >= 1.95 && t.riskPct <= RISK_OK).length} of ${s.n} trades had a stop, ≤2% risk and a target at least 2R away.` : 'You need at least one trade.' },
      { label: 'Bank a winner of +2R or more', check: s => s.bestR >= 2, why: s => `Your best trade was ${fmtR(s.bestR)}.` },
    ],
    takeaway: 'Your win rate matters less than the size of your wins compared with your losses.',
  },
  {
    id: 7, title: 'Indicators', sub: 'Moving averages and RSI', type: 'trade', illus: 'indicators', sym: 'ZETA',
    points: [
      'A <b>moving average</b> (MA) is the average close over the last N candles. It smooths out noise so the trend is easier to see.',
      'When the fast MA (20) crosses <b>above</b> the slow MA (50), momentum is turning up. A cross <b>below</b> suggests it is turning down.',
      '<b>RSI</b> measures how stretched a move is, from 0 to 100. Above 70 is overbought and below 30 is oversold. In strong trends it can stay there for a long time.',
      'Indicators are calculated from past prices, so they lag. Use them to confirm what price is showing you, not to predict.',
    ],
    rule: 'Indicators confirm. Price decides. Your stop still protects.',
    rules: { sizing: 'risk', defaultRisk: 1, allowLimit: true, stop: 'required', target: 'optional', defaultTarget: 2, ma: true, rsi: true },
    market: { start: 50, hist: 70, live: 90, segs: [{ type: 'trend', dir: -1, len: 45 }, { type: 'range', len: 25, width: .05 }, { type: 'trend', dir: 1, len: 35, str: 1.1 }, { type: 'range', len: 15, width: .04 }, { type: 'trend', dir: -1, len: 30, str: 1.1 }, { type: 'range', len: 10, width: .04 }] },
    intro: 'MA20 is amber, MA50 is blue and RSI is below the chart. I will call out every crossover. Enter in its direction within 3 candles.',
    stars: [
      { label: 'Finish with a profit', check: s => s.net > 0, why: s => `Net P&L ${fmt$s(s.net)}.` },
      { label: 'Stop on every trade, risk 2% or less', check: allDisciplined, why: s => s.n ? `${s.trades.filter(t => t.hadStop && t.riskPct <= RISK_OK).length} of ${s.n} trades followed the rules.` : 'You need at least one trade.' },
      { label: 'Trade a moving-average crossover', check: s => s.crossTrades > 0, why: s => s.crossTrades ? `${s.crossTrades} trade${s.crossTrades > 1 ? 's' : ''} taken within 3 candles of a cross, in its direction.` : 'Enter within 3 candles after the coach calls a crossover, in the same direction.' },
    ],
    takeaway: 'Crossovers help you join a trend. They give false signals in sideways markets, which is why the stop stays on.',
  },
  {
    id: 8, title: 'Mind Games', sub: 'Boss level: discipline under pressure', type: 'trade', illus: 'psych', sym: 'HYPE',
    points: [
      '<b>FOMO</b> (fear of missing out) makes you chase a move that has already happened, usually right at the top.',
      '<b>Revenge trading</b> means jumping straight back in after a loss to win it back. It is emotion, not a setup.',
      '<b>Moving your stop further away</b> when price gets close turns a planned small loss into an unplanned big one.',
      'News and hype are loud. Your plan should be louder: stop on, risk 2% or less, and only trade setups you planned.',
    ],
    rule: 'Trade your plan, not your feelings. Boring is profitable.',
    rules: { sizing: 'risk', defaultRisk: 1, allowLimit: true, stop: 'required', target: 'optional', defaultTarget: 2, ma: true, rsi: true },
    market: { start: 30, hist: 50, live: 80, vol: .0028, segs: [{ type: 'range', len: 50, width: .06 }, { type: 'move', pct: .045, len: 3 }, { type: 'move', pct: -.07, len: 4, vol: .0035 }, { type: 'range', len: 15, width: .05 }, { type: 'trend', dir: 1, len: 15, str: 1.2 }, { type: 'parabola', pct: .14, len: 6 }, { type: 'move', pct: -.15, len: 4, vol: .005 }, { type: 'range', len: 15, width: .05 }, { type: 'trend', dir: 1, len: 18 }] },
    events: [
      { at: 1, kind: 'news', text: 'HYPE is "in talks" about a merger, anonymous sources say.' },
      { at: 8, kind: 'news', text: 'HYPE denies the merger rumours. "No talks are taking place."' },
      { at: 43, kind: 'fomo' },
      { at: 48, kind: 'news', text: 'Analysts downgrade HYPE after a guidance cut.' },
      { at: 66, kind: 'news', text: 'Quiet session. Volume dries up as traders step back.' },
    ],
    intro: 'This round plays with your head: news, hype and fake breakouts. Your plan: stop on, risk 2% or less, no chasing, no revenge trades.',
    stars: [
      { label: 'Finish with a profit', check: s => s.net > 0, why: s => `Net P&L ${fmt$s(s.net)}.` },
      { label: 'Stay disciplined the whole round', check: s => allDisciplined(s) && !s.widened && !s.revenge && !s.fomoTaken, why: s => disciplineSummary(s) },
      { label: 'Max drawdown under 5%, at least 2 trades', check: s => s.n >= 2 && s.maxDD < 5, why: s => `${s.n} trade${s.n === 1 ? '' : 's'}, deepest drop ${s.maxDD.toFixed(2)}%.` },
    ],
    takeaway: 'Markets are built to trigger your emotions. Your edge is a plan you follow when it is uncomfortable.',
  },
];

function disciplineSummary(s) {
  const issues = [];
  const noStop = s.trades.filter(t => !t.hadStop).length, over = s.trades.filter(t => t.riskPct > RISK_OK).length;
  if (!s.n) issues.push('no trades taken');
  if (noStop) issues.push(`${noStop} trade${noStop > 1 ? 's' : ''} without a stop`);
  if (over) issues.push(`${over} over 2% risk`);
  if (s.widened) issues.push(`stop widened ${s.widened}×`);
  if (s.revenge) issues.push(`${s.revenge} revenge trade${s.revenge > 1 ? 's' : ''}`);
  if (s.fomoTaken) issues.push('took the FOMO bait');
  return issues.length ? 'Slip-ups: ' + issues.join(', ') + '.' : 'Clean: stops on, risk ≤2%, no FOMO, no revenge, no widened stops.';
}

const SCENARIOS = [
  {
    key: 'flash', title: 'Flash Crash', sub: 'A calm market drops 16% in two candles', sym: 'GRND', unlock: 4,
    market: { start: 120, hist: 50, live: 80, segs: [{ type: 'trend', dir: 1, len: 50, str: .6 }, { type: 'trend', dir: 1, len: 25, str: .6 }, { type: 'move', pct: -.16, len: 2, vol: .006 }, { type: 'move', pct: .11, len: 6, vol: .004 }, { type: 'range', len: 25, width: .05 }, { type: 'trend', dir: 1, len: 22, str: .7 }] },
    intro: 'A slow, calm uptrend. Too calm. Trade it with stops and see what happens when liquidity disappears.',
    stars: [
      { label: 'Finish with a profit', check: s => s.net > 0, why: s => `Net P&L ${fmt$s(s.net)}.` },
      { label: 'Stop on every trade, risk 2% or less', check: allDisciplined, why: s => disciplineSummary(s) },
      { label: 'Max drawdown under 3%', check: s => s.n > 0 && s.maxDD < 3, why: s => `Deepest drop ${s.maxDD.toFixed(2)}%.` },
    ],
    takeaway: 'In a flash crash, stops can slip, but they still get you out. Traders without one are the ones you read about.',
  },
  {
    key: 'pump', title: 'Pump & Dump', sub: '+55% on hype, then the floor gives way', sym: 'MOON', unlock: 6,
    market: { start: 12, hist: 50, live: 80, vol: .003, segs: [{ type: 'range', len: 50, width: .04 }, { type: 'range', len: 10, width: .04 }, { type: 'parabola', pct: .55, len: 22 }, { type: 'move', pct: -.35, len: 5, vol: .007 }, { type: 'move', pct: .08, len: 5 }, { type: 'trend', dir: -1, len: 25 }, { type: 'range', len: 13, width: .05 }] },
    events: [{ at: 14, kind: 'news', text: 'MOON trends on social media: "This is the next big one."' }, { at: 28, kind: 'fomo' }, { at: 34, kind: 'news', text: 'Early holders are selling. Volume spikes on the way down.' }],
    intro: 'A sleepy stock is about to get famous. Ride it if you can, but keep your stop close when everyone is euphoric.',
    stars: [
      { label: 'Finish with a profit', check: s => s.net > 0, why: s => `Net P&L ${fmt$s(s.net)}.` },
      { label: 'Stay disciplined the whole round', check: s => allDisciplined(s) && !s.fomoTaken && !s.revenge, why: s => disciplineSummary(s) },
      { label: 'Max drawdown under 4%', check: s => s.n > 0 && s.maxDD < 4, why: s => `Deepest drop ${s.maxDD.toFixed(2)}%.` },
    ],
    takeaway: 'Parabolic moves end abruptly. Trailing your stop up locks in the ride; chasing at the top pays for someone else\'s exit.',
  },
  {
    key: 'chop', title: 'Chop Zone', sub: 'Sideways with false breakouts', sym: 'FLAT', unlock: 7,
    market: { start: 75, hist: 50, live: 80, segs: [{ type: 'range', len: 50, width: .05 }, { type: 'range', len: 20, width: .05 }, { type: 'move', pct: .03, len: 2 }, { type: 'move', pct: -.04, len: 3 }, { type: 'range', len: 20, width: .05 }, { type: 'move', pct: -.03, len: 2 }, { type: 'move', pct: .04, len: 3 }, { type: 'range', len: 32, width: .05 }] },
    intro: 'No trend, just noise and breakouts that fail. The best traders here trade less, or buy support and sell resistance.',
    stars: [
      { label: 'Finish with a profit', check: s => s.net > 0, why: s => `Net P&L ${fmt$s(s.net)}.` },
      { label: 'Stop on every trade, risk 2% or less', check: allDisciplined, why: s => disciplineSummary(s) },
      { label: 'Trade sparingly: 1 to 4 trades', check: s => s.n >= 1 && s.n <= 4, why: s => `${s.n} trades. Choppy markets punish overtrading.` },
    ],
    takeaway: 'When there is no trend, sitting on your hands is a position too.',
  },
];
const ALL_TOOLS = { sizing: 'risk', defaultRisk: 1, allowLimit: true, stop: 'required', target: 'optional', defaultTarget: 2, ma: true, rsi: true };

const RANKS = [
  [0, 'Intern'], [300, 'Junior Analyst'], [800, 'Analyst'], [1600, 'Trader'], [2800, 'Senior Trader'], [4500, 'Portfolio Manager'], [7000, 'Legend'],
];
function rankOf(xp) {
  let i = 0; while (i + 1 < RANKS.length && xp >= RANKS[i + 1][0]) i++;
  const cur = RANKS[i], next = RANKS[i + 1];
  return { name: cur[1], from: cur[0], to: next ? next[0] : null, nextName: next ? next[1] : null };
}

const ACH = [
  { id: 'first', name: 'First Fill', d: 'Place your first trade.', g: '1st' },
  { id: 'seatbelt', name: 'Seatbelt On', d: 'Have a stop-loss close a trade for you.', g: 'SL' },
  { id: 'cut', name: 'Cut It Short', d: 'Take 5 losses of 1R or less.', g: '−1R' },
  { id: 'ride', name: 'Let It Ride', d: 'Win a trade of +3R or more.', g: '3R' },
  { id: 'sniper', name: 'Limit Sniper', d: 'Get a limit order filled.', g: 'LMT' },
  { id: 'bear', name: 'Bear Hunter', d: 'Profit on a short trade.', g: 'SH' },
  { id: 'hot', name: 'Hot Hand', d: 'Win 3 trades in a row.', g: '×3' },
  { id: 'iron', name: 'Iron Rules', d: '10 trades in a row with a stop and 2% risk or less.', g: '10' },
  { id: 'reader', name: 'Chart Reader', d: 'Perfect score on Level 1 or Level 2.', g: 'Q' },
  { id: 'flawless', name: 'Flawless', d: 'Earn 3 stars on a trading level.', g: '★★★' },
  { id: 'boss', name: 'Cool Head', d: 'Pass Level 8 with the discipline star.', g: 'L8' },
  { id: 'grad', name: 'Graduate', d: 'Pass all 8 levels.', g: 'GR' },
  { id: 'daily', name: 'Daily Grinder', d: 'Finish a daily challenge.', g: 'D' },
  { id: 'survivor', name: 'Survivor', d: 'Finish the Flash Crash with drawdown under 3%.', g: 'FC' },
];

/* =========================================================================
   Generic UI helpers
   ========================================================================= */
const screens = ['map', 'lesson', 'play', 'debrief', 'profile'];
let current = 'map';
function show(name) {
  if (current === 'play' && name !== 'play') stopRound();
  current = name;
  screens.forEach(s => { $('#screen-' + s).hidden = s !== name; });
  window.scrollTo(0, 0);
  if (name === 'map') renderMap();
  if (name === 'profile') renderProfile();
}
function toast(html, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = (opts.medal ? `<span class="medal">${esc(opts.medal)}</span>` : '') + `<span>${html}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), opts.ms || 2600);
}
function modal({ title, html, actions, cls: extra = '' }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-back"><div class="modal ${extra}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <h3 id="modal-title">${title}</h3>${html}<div class="actions"></div></div></div>`;
  const box = $('.actions', root);
  actions.forEach(a => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls || ''); b.textContent = a.label;
    b.addEventListener('click', () => { root.innerHTML = ''; a.onClick && a.onClick(); });
    box.appendChild(b);
  });
  setTimeout(() => { const b = $('.actions .btn', root); b && b.focus(); }, 30);
}
const modalOpen = () => !!$('#modal-root').firstChild;

/* ---------- confetti ---------- */
const Confetti = {
  parts: [], running: false,
  burst(n = 140) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = $('#confetti'); cv.width = innerWidth; cv.height = innerHeight;
    const cols = [T.up, T.accent, T.info, T.down];
    for (let i = 0; i < n; i++) this.parts.push({
      x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35,
      vx: (Math.random() - .5) * 14, vy: -Math.random() * 13 - 3, r: Math.random() * Math.PI,
      vr: (Math.random() - .5) * .3, c: cols[i % cols.length], life: 120 + Math.random() * 60, w: 6 + Math.random() * 6,
    });
    if (!this.running) { this.running = true; requestAnimationFrame(() => this.step()); }
  },
  step() {
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    this.parts = this.parts.filter(p => --p.life > 0 && p.y < cv.height + 20);
    for (const p of this.parts) {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -3, p.w, 6); ctx.restore();
    }
    if (this.parts.length) requestAnimationFrame(() => this.step()); else { this.running = false; ctx.clearRect(0, 0, cv.width, cv.height); }
  },
};

/* =========================================================================
   XP, achievements, journal
   ========================================================================= */
function addXP(n) {
  if (n <= 0) return 0;
  const before = rankOf(S.xp).name;
  S.xp += n;
  const after = rankOf(S.xp).name;
  if (after !== before) setTimeout(() => { toast(`Promoted to <b>${esc(after)}</b>`, { medal: '↑', ms: 3500 }); Snd.play('star'); Confetti.burst(80); }, 900);
  return n;
}
let roundAch = [];
function unlock(id) {
  if (S.ach[id]) return;
  const a = ACH.find(x => x.id === id); if (!a) return;
  S.ach[id] = Date.now();
  addXP(150);
  roundAch.push(a);
  toast(`Badge unlocked: <b>${esc(a.name)}</b> (+150 XP)`, { medal: a.g, ms: 3200 });
  Snd.play('star');
  save();
}
function onTradeClosed(t) {
  const c = S.counters;
  c.trades++;
  unlock('first');
  if (t.reason === 'stop') unlock('seatbelt');
  if (t.limitEntry) unlock('sniper');
  if (t.r != null && t.r >= 3) unlock('ride');
  if (t.side < 0 && t.pnl > 0) unlock('bear');
  if (t.pnl < 0 && t.r != null && t.r >= -1.15) { c.smallLosses++; if (c.smallLosses >= 5) unlock('cut'); }
  c.winStreak = t.pnl > 0 ? c.winStreak + 1 : 0; if (c.winStreak >= 3) unlock('hot');
  c.disciplineStreak = t.hadStop && t.riskPct <= RISK_OK ? c.disciplineStreak + 1 : 0; if (c.disciplineStreak >= 10) unlock('iron');
  S.journal.unshift(t); if (S.journal.length > 300) S.journal.length = 300;
  save();
}

/* =========================================================================
   Map screen
   ========================================================================= */
const levelDone = id => !!(S.levels[id] && S.levels[id].done);
const levelUnlocked = id => id === 1 || levelDone(id - 1);

function renderPlayerChip() {
  const r = rankOf(S.xp);
  $('#map-rank').textContent = r.name;
  const pct = r.to ? (S.xp - r.from) / (r.to - r.from) * 100 : 100;
  $('#map-xpfill').style.width = pct + '%';
  $('#map-xptext').textContent = r.to ? `${S.xp} / ${r.to} XP to ${r.nextName}` : `${S.xp} XP · max rank`;
}

function renderMap() {
  renderPlayerChip();
  const path = $('#level-path');
  const firstOpen = LEVELS.find(l => !levelDone(l.id) && levelUnlocked(l.id));
  path.innerHTML = '<svg class="connector" aria-hidden="true"><path/></svg>' + LEVELS.map((l, i) => {
    const st = S.levels[l.id] || {}, unlocked = levelUnlocked(l.id);
    const state = st.done ? 'done' : !unlocked ? 'locked' : (firstOpen && firstOpen.id === l.id ? 'current' : '');
    return `<button class="node ${state} ${i % 2 ? 'right' : ''}" data-level="${l.id}" ${unlocked ? '' : 'aria-disabled="true"'}>
      <span class="num">${l.id}</span>
      <span class="meta"><span class="title">${esc(l.title)}</span><br><span class="sub">${unlocked ? esc(l.sub) : 'Pass Level ' + (l.id - 1) + ' to unlock'}</span></span>
      ${starsHtml(st.stars || 0)}
    </button>`;
  }).join('');
  $$('.node', path).forEach(n => n.addEventListener('click', () => {
    const id = +n.dataset.level;
    if (!levelUnlocked(id)) { toast(`Pass Level ${id - 1} with 2 stars to unlock this.`); Snd.play('wrong'); return; }
    Snd.play('click'); openLesson(LEVELS[id - 1]);
  }));
  requestAnimationFrame(drawConnector);

  // modes
  const modesOpen = levelDone(3);
  $('#btn-daily').hidden = !modesOpen; $('#daily-lock').hidden = modesOpen;
  $('#btn-endless').hidden = !modesOpen; $('#endless-lock').hidden = modesOpen;
  $('#card-daily').classList.toggle('locked', !modesOpen); $('#card-endless').classList.toggle('locked', !modesOpen);
  const d = S.daily[todayKey()];
  $('#daily-title').textContent = 'Market of ' + new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  $('#daily-score').textContent = d ? `Today's best: ${fmt$s(d.net)} (${fmtPct(d.netPct)}) · discipline ${d.disc}%` : 'No attempt yet today';
  $('#endless-best').textContent = S.endlessBest ? `Best run: ${fmt$s(S.endlessBest.net)} (${fmtPct(S.endlessBest.netPct)})` : 'Best run: none yet';

  $('#scenario-list').innerHTML = SCENARIOS.map(sc => {
    const open = levelDone(sc.unlock), st = S.scen[sc.key] || {};
    return `<button class="scenario-btn" data-scen="${sc.key}" ${open ? '' : 'disabled'}>
      <span><b>${esc(sc.title)}</b><small>${open ? esc(sc.sub) : 'Pass Level ' + sc.unlock + ' to unlock'}</small></span>${starsHtml(st.stars || 0)}</button>`;
  }).join('');
  $$('.scenario-btn').forEach(b => b.addEventListener('click', () => {
    const sc = SCENARIOS.find(s => s.key === b.dataset.scen);
    Snd.play('click'); startTrade({ mode: 'scenario', scen: sc });
  }));
}
function drawConnector() {
  const path = $('#level-path'); if (!path || path.offsetParent === null) return;
  const svg = $('svg.connector', path), pr = path.getBoundingClientRect();
  const pts = $$('.node .num', path).map(n => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2 - pr.left, r.top + r.height / 2 - pr.top]; });
  if (pts.length < 2) return;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], my = (y0 + y1) / 2;
    d += ` C${x0},${my} ${x1},${my} ${x1},${y1}`;
  }
  const p = $('path', svg);
  p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.style.stroke = 'var(--line)';
  p.setAttribute('stroke-width', '3'); p.setAttribute('stroke-dasharray', '2 8'); p.setAttribute('stroke-linecap', 'round');
}
function buildTicker() {
  const syms = [['ACME', 102.44, 1.2], ['BOLT', 81.07, -0.8], ['NOVA', 60.31, 0.4], ['KITE', 139.9, 2.1], ['ZETA', 49.62, -1.6], ['HYPE', 31.18, 6.3], ['GRND', 118.5, 0.1], ['MOON', 12.04, -12.4], ['FLAT', 75.0, 0.0]];
  const tips = ['Plan the trade, trade the plan', 'Risk 1–2% per trade', 'Cut losers, let winners run', 'No stop, no trade'];
  const items = syms.map(([s, p, c]) => `<span>${s} <b>${p.toFixed(2)}</b> <span class="${cls(c)}">${c > 0 ? '▲' : c < 0 ? '▼' : '■'} ${Math.abs(c).toFixed(1)}%</span></span>`);
  tips.forEach((t, i) => items.splice(2 + i * 3, 0, `<span style="color:var(--accent)">${t}</span>`));
  $('#ticker').innerHTML = items.join('') + items.join('');
}

/* =========================================================================
   Lesson screen
   ========================================================================= */
let lessonLevel = null;
function openLesson(l) {
  lessonLevel = l;
  show('lesson');
  $('#lesson-eyebrow').textContent = `LEVEL ${l.id} OF ${LEVELS.length}`;
  $('#lesson-title').textContent = l.title;
  $('#lesson-points').innerHTML = l.points.map(p => `<li>${p}</li>`).join('');
  $('#lesson-rule').textContent = l.rule;
  const labels = l.stars.map(s => typeof s === 'string' ? s : s.label);
  const best = (S.levels[l.id] || {}).stars || 0;
  $('#lesson-goals').innerHTML = `<span class="label">Stars this round ${best ? `· your best ${best}/3` : ''}</span>` +
    labels.map(t => `<div class="goal">${starSvg(true)}<span>${esc(t)}</span></div>`).join('') +
    `<div class="goal muted" style="font-size:13px">Earn 2 stars to unlock the next level.</div>`;
  drawLesson();
}
function drawLesson() {
  if (!lessonLevel || current !== 'lesson') return;
  const cv = $('#lesson-canvas');
  const { ctx, w, h } = setupCanvas(cv);
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h);
  ILLUS[lessonLevel.illus](ctx, w, h);
}

/* =========================================================================
   Round lifecycle (shared)
   ========================================================================= */
let R = null;        // current round
let chart = null;
let rafId = 0;
function stopRound() { cancelAnimationFrame(rafId); rafId = 0; if (R) R.playing = false; $('#modal-root').innerHTML = ''; }
function setObjectives(items) {
  $('#objectives').innerHTML = items.map((t, i) => `<span class="obj" data-i="${i}">${starSvg(false)}<span>${esc(t)}</span></span>`).join('');
}
function markObjectives(states) {
  $$('#objectives .obj').forEach((el, i) => { el.classList.toggle('ok', states[i] === true); el.classList.toggle('bad', states[i] === 'bad'); });
}
function coach(text, tone = '') {
  const box = $('#coach'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'coach-msg ' + tone;
  el.innerHTML = `<span class="av">C</span><span class="txt">${text}</span>`;
  box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
}

/* =========================================================================
   Quiz rounds (Level 1 candles, Level 2 trends & levels)
   ========================================================================= */
function quizCandles(rng) {
  const out = []; let p = 40 + rng() * 40;
  const n = 24;
  const kinds = new Array(n).fill('n');
  const slots = shuffle([...Array(n - 4).keys()].map(i => i + 2), rng).slice(0, 5);
  ['bull', 'bear', 'doji', 'hammer', 'star'].forEach((k, i) => kinds[slots[i]] = k);
  for (let i = 0; i < n; i++) {
    const o = p * (1 + (rng() - .5) * .002);
    let body, up, lw, dir;
    const k = kinds[i];
    if (k === 'bull') { body = .028; dir = 1; up = .003; lw = .003; }
    else if (k === 'bear') { body = .028; dir = -1; up = .003; lw = .003; }
    else if (k === 'doji') { body = .0004; dir = rng() < .5 ? 1 : -1; up = .007; lw = .007; }
    else if (k === 'hammer') { body = .004; dir = rng() < .5 ? 1 : -1; up = .0006; lw = .018; }
    else if (k === 'star') { body = .004; dir = rng() < .5 ? 1 : -1; up = .018; lw = .0006; }
    else { body = .004 + rng() * .009; dir = rng() < .5 ? 1 : -1; up = body * (.1 + rng() * .5); lw = body * (.1 + rng() * .5); }
    const c = o * (1 + dir * body);
    const h = Math.max(o, c) * (1 + up), l = Math.min(o, c) * (1 - lw);
    out.push({ o, h, l, c, kind: k });
    p = c;
  }
  return out;
}
const anat = c => { const body = Math.abs(c.c - c.o), range = c.h - c.l; return { body, range, upper: c.h - Math.max(c.o, c.c), lower: Math.min(c.o, c.c) - c.l }; };

function buildCandleQuestions(rng, candles) {
  const idxOf = k => candles.findIndex(c => c.kind === k);
  const argBest = (pred, score) => { let best = -1, bs = -Infinity; candles.forEach((c, i) => { if (pred(c) && score(c) > bs) { bs = score(c); best = i; } }); return best; };
  const normals = candles.map((c, i) => c.kind === 'n' ? i : -1).filter(i => i >= 0);
  const pick = normals[Math.floor(rng() * normals.length)];
  const pc = candles[pick];
  const opts = shuffle([['close', pc.c], ['open', pc.o], ['high', pc.h], ['low', pc.l]], rng);
  return [
    { kind: 'tap', q: 'Tap the strongest <b>bullish</b> candle: the biggest teal body.', answer: [argBest(c => c.c > c.o, c => c.c - c.o)], explain: 'A big bullish body means buyers were in control from open to close.' },
    { kind: 'choice', q: 'What was the <b>close</b> of the highlighted candle? Use the price axis on the right.', mark: pick, options: opts.map(([k, v]) => ({ label: fmtP(v), correct: k === 'close' })), explain: `This candle opened at ${fmtP(pc.o)}, reached a high of ${fmtP(pc.h)} and a low of ${fmtP(pc.l)}, then closed at ${fmtP(pc.c)}. ${pc.c >= pc.o ? 'Teal: the close is the top of the body.' : 'Red: the close is the bottom of the body.'}` },
    { kind: 'tap', q: 'Tap the <b>doji</b>: almost no body, wicks on both sides.', answer: [idxOf('doji')], explain: 'Open and close were nearly equal. Neither side won that candle, so it signals indecision.' },
    { kind: 'tap', q: 'Tap the <b>hammer</b>: small body near the top, long lower wick.', answer: [idxOf('hammer')], explain: 'Sellers pushed the price down, then buyers pushed it all the way back. After a decline, that rejection can mark a bottom.' },
    { kind: 'tap', q: 'Tap the strongest <b>bearish</b> candle.', answer: [argBest(c => c.c < c.o, c => c.o - c.c)], explain: 'A big red body means sellers controlled the whole candle.' },
    { kind: 'tap', q: 'Tap the <b>shooting star</b>: small body near the bottom, long upper wick.', answer: [idxOf('star')], explain: 'Buyers tried to push higher and got rejected hard. After a rally, that can mark a top.' },
  ];
}

function buildLevelQuestions(rng) {
  const qs = [];
  const trends = shuffle(['up', 'down', 'side'], rng);
  for (const t of trends) {
    const segs = t === 'side' ? [{ type: 'range', len: 62, width: .08 }] : [{ type: 'trend', dir: t === 'up' ? 1 : -1, len: 62, str: 1.1 }];
    const m = makeMarket(newSeed(), { start: 50 + rng() * 100, hist: 60, live: 0, segs });
    qs.push({
      kind: 'choice', q: 'Which way is this market trending?', candles: m.candles.slice(0, 60),
      options: [{ label: 'Uptrend', correct: t === 'up' }, { label: 'Downtrend', correct: t === 'down' }, { label: 'Sideways (range)', correct: t === 'side' }],
      explain: t === 'up' ? 'Higher highs and higher lows: each pullback stops above the last one.' : t === 'down' ? 'Lower highs and lower lows: each bounce fails below the last one.' : 'Price keeps bouncing between the same zones. No higher highs, no lower lows.',
    });
  }
  for (let k = 0; k < 3; k++) {
    const m = makeMarket(newSeed(), { start: 40 + rng() * 120, hist: 64, live: 0, segs: [{ type: 'trend', dir: rng() < .5 ? 1 : -1, len: 12 }, { type: 'range', len: 54, width: .07 + rng() * .03 }] });
    const rg = m.ranges[0];
    qs.push({ kind: 'levels', q: 'Drag the two lines onto <b>support</b> (where drops stall) and <b>resistance</b> (where rallies stall), then lock them in.', candles: m.candles.slice(0, 64), lo: rg.lo, hi: rg.hi });
  }
  return qs;
}

function startQuiz(level) {
  const rng = mulberry32(newSeed());
  let base = null, qs;
  if (level.quiz === 'candles') { base = quizCandles(rng); qs = buildCandleQuestions(rng, base); }
  else qs = buildLevelQuestions(rng);
  R = { kind: 'quiz', level, qs, qi: 0, results: [], base, answered: false, lines: null };
  roundAch = [];
  show('play');
  $('#play-title').textContent = `${level.id} · ${level.title}`;
  setObjectives(level.stars);
  $('#chart-head').hidden = true; $('#chart-foot').hidden = true; $('#overlay-play').hidden = true; $('#news').hidden = true;
  ensureChart();
  renderQuizQ();
}

function renderQuizQ() {
  const q = R.qs[R.qi];
  R.answered = false; R.lines = null;
  const panel = $('#side-panel');
  panel.innerHTML = `<div class="panel-sec">
      <div class="field-row"><span class="label">Question ${R.qi + 1} of ${R.qs.length}</span><span class="mono muted">${R.results.filter(Boolean).length} correct</span></div>
      <div class="quiz-progress">${R.qs.map((_, i) => `<i class="${i < R.results.length ? (R.results[i] ? 'ok' : 'no') : i === R.qi ? 'cur' : ''}"></i>`).join('')}</div>
      <div class="quiz-q">${q.q}</div>
      <div class="choices" id="choices"></div>
      <div id="explain"></div>
      <button class="btn primary" id="quiz-next" hidden>Next question</button>
    </div>
    <div class="panel-sec"><h4>Coach</h4><div class="coach" id="coach"></div></div>`;
  const candles = q.candles || R.base;
  const state = { candles, fitAll: true, highlights: [], lines: [], onTap: null };
  if (q.kind === 'tap') {
    state.onTap = idx => answerTap(idx);
    coach('Tap a candle on the chart.');
  } else if (q.kind === 'choice') {
    if (q.mark != null) state.highlights = [[q.mark, T.accent]];
    $('#choices').innerHTML = q.options.map((o, i) => `<button class="btn" data-i="${i}">${esc(o.label)}</button>`).join('');
    $$('#choices .btn').forEach(b => b.addEventListener('click', () => answerChoice(+b.dataset.i)));
  } else if (q.kind === 'levels') {
    let lo = Infinity, hi = -Infinity; candles.forEach(c => { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
    const mid = (lo + hi) / 2, span = hi - lo;
    R.lines = { sup: mid - span * .08, res: mid + span * .08 };
    $('#choices').innerHTML = `<button class="btn primary" id="lock-levels">Lock in my levels</button>`;
    $('#lock-levels').addEventListener('click', answerLevels);
    coach('Grab a line by its handle on the right and drag it. Look for prices where the market turned more than once.');
  }
  R.chartState = state;
  refreshQuizLines();
  $('#quiz-next').addEventListener('click', () => {
    Snd.play('click');
    if (R.qi + 1 < R.qs.length) { R.qi++; renderQuizQ(); } else finishQuiz();
  });
}
function refreshQuizLines() {
  const st = R.chartState;
  if (R.lines && !R.answered) {
    st.lines = [
      { id: 'res', price: R.lines.res, color: T.down, dash: true, label: 'Resistance', draggable: true, scale: false, onDrag: p => { R.lines.res = p; refreshQuizLines(); } },
      { id: 'sup', price: R.lines.sup, color: T.up, dash: true, label: 'Support', draggable: true, scale: false, onDrag: p => { R.lines.sup = p; refreshQuizLines(); } },
    ];
  }
  chart.set(st);
}
function quizFeedback(ok, explain) {
  R.answered = true; R.results.push(ok);
  Snd.play(ok ? 'right' : 'wrong');
  $('#explain').innerHTML = `<div class="explain ${ok ? 'ok' : 'no'}"><b>${ok ? 'Correct.' : 'Not quite.'}</b> ${explain}</div>`;
  $('#quiz-next').hidden = false; $('#quiz-next').focus();
  $('#quiz-next').textContent = R.qi + 1 < R.qs.length ? 'Next question' : 'See results';
  const n = R.results.filter(Boolean).length;
  markObjectives([n >= 3, n >= 5, n >= 6]);
  $$('.quiz-progress i')[R.qi].className = ok ? 'ok' : 'no';
}
function answerTap(idx) {
  if (R.answered) return;
  const q = R.qs[R.qi];
  const ok = q.answer.includes(idx);
  const hl = q.answer.map(i => [i, T.up]);
  if (!ok) hl.push([idx, T.down]);
  R.chartState.highlights = hl; R.chartState.onTap = null;
  chart.set(R.chartState);
  quizFeedback(ok, q.explain + (ok ? '' : ' The correct candle is outlined in teal.'));
}
function answerChoice(i) {
  if (R.answered) return;
  const q = R.qs[R.qi], ok = q.options[i].correct;
  $$('#choices .btn').forEach((b, j) => { b.disabled = true; if (q.options[j].correct) b.classList.add('correct'); else if (j === i) b.classList.add('wrong'); });
  quizFeedback(ok, q.explain);
}
function answerLevels() {
  if (R.answered) return;
  const q = R.qs[R.qi];
  let { sup, res } = R.lines; if (sup > res) [sup, res] = [res, sup];
  const w = q.hi - q.lo, es = Math.abs(sup - q.lo) / w, er = Math.abs(res - q.hi) / w;
  const ok = es <= .2 && er <= .2;
  R.chartState.lines = [
    { id: 'tr', price: q.hi, color: T.down, label: 'True resistance', scale: false },
    { id: 'ts', price: q.lo, color: T.up, label: 'True support', scale: false },
    { id: 'ur', price: res, color: T.muted, dash: true, label: 'Your resistance', scale: false },
    { id: 'us', price: sup, color: T.muted, dash: true, label: 'Your support', scale: false },
  ];
  R.chartState.zones = [{ lo: q.lo, hi: q.hi, color: T.accent }];
  chart.set(R.chartState);
  $('#lock-levels').disabled = true;
  const pct = v => Math.round((1 - Math.min(1, v)) * 100);
  quizFeedback(ok, `Support accuracy ${pct(es)}%, resistance accuracy ${pct(er)}% (you need 80%+ on both). ${ok ? 'Price turned at those zones again and again.' : 'Look for the prices where several candles turned around, not single spikes.'}`);
}
function finishQuiz() {
  const correct = R.results.filter(Boolean).length;
  const stars = correct >= 6 ? 3 : correct >= 5 ? 2 : correct >= 3 ? 1 : 0;
  if (correct === 6) unlock('reader');
  const checks = R.level.stars.map((label, i) => ({ label, ok: stars > i, why: `You got ${correct} of 6.` }));
  completeLevel(R.level, stars, { checks, quizCorrect: correct });
}

/* =========================================================================
   Trading rounds
   ========================================================================= */
const START_CASH = 10000, FEE = 1;

function ensureChart() {
  if (!chart) chart = new Chart($('#chart'));
  requestAnimationFrame(() => chart.resize());
}

function startTrade(opts) {
  // opts: {mode:'level'|'scenario'|'endless'|'daily', level?, scen?}
  let cfg, rules, marketSpec, seed = newSeed(), title, sym, stars = null, events = [];
  if (opts.mode === 'level') {
    cfg = opts.level; rules = cfg.rules; marketSpec = cfg.market; title = `${cfg.id} · ${cfg.title}`; sym = cfg.sym; stars = cfg.stars; events = cfg.events || [];
  } else if (opts.mode === 'scenario') {
    cfg = opts.scen; rules = ALL_TOOLS; marketSpec = cfg.market; title = `Scenario · ${cfg.title}`; sym = cfg.sym; stars = cfg.stars; events = cfg.events || [];
  } else {
    const daily = opts.mode === 'daily';
    if (daily) seed = hashStr('cq-daily-' + todayKey());
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const live = daily ? 100 : 150, hist = 60;
    marketSpec = { start: 20 + rng() * 180, hist, live, segs: randomSegs(rng, hist + live) };
    rules = ALL_TOOLS; title = daily ? 'Daily challenge · ' + todayKey() : 'Endless Market';
    sym = daily ? 'DAY' : ['ORCA', 'PIKE', 'LYNX', 'MESA', 'VOLT', 'RUNE'][Math.floor(rng() * 6)];
    cfg = { intro: daily ? 'Same market for every player today. Trade it once with your full toolkit.' : 'A fresh random market. Every tool is on. Make your process boring.' };
  }
  const m = makeMarket(seed, marketSpec);
  const atr0 = m.atr[marketSpec.hist - 1];
  R = {
    kind: 'trade', mode: opts.mode, opts, cfg, rules, sym, stars, events: events.map(e => ({ ...e, done: false })),
    m, hist: marketSpec.hist, live: marketSpec.live, total: marketSpec.hist + marketSpec.live,
    ci: marketSpec.hist, ti: 0, playing: false, started: false, speed: 1, acc: 0, last: 0,
    cash: START_CASH, equity: START_CASH, peak: START_CASH, maxDD: 0, eqCurve: [START_CASH],
    pos: null, pending: null, trades: [], markers: [],
    flags: { widened: 0, revenge: 0, fomoTaken: 0, fomoDeclined: 0 },
    stat: { limitFills: 0, stopHits: 0, targetHits: 0, crossTrades: 0 },
    lastCross: null, newsUntil: -1, beHinted: false, quizScore: null, ended: false,
    tk: {
      side: 1, type: 'market', qty: rules.qtys ? rules.qtys[1] : 0, riskPct: rules.defaultRisk ?? 1,
      useStop: rules.stop !== 'off', stopDist: atr0 * 1.5, useTarget: rules.target === 'optional', targetR: rules.defaultTarget ?? 2,
      limit: null,
    },
  };
  roundAch = [];
  show('play');
  $('#play-title').textContent = title;
  $('#sym').textContent = sym;
  $('#chart-head').hidden = false; $('#chart-foot').hidden = false; $('#news').hidden = true;
  setObjectives(stars ? stars.map(s => s.label) : ['Grow the account', 'Stops on every trade', 'Risk 2% or less']);
  ensureChart();
  buildTradePanel();
  setSpeed(1);
  $('#overlay-play').hidden = false;
  $('#overlay-text').textContent = cfg.intro || 'Set up your order ticket, then start the clock.';
  coach(cfg.intro || 'Start the market when you are ready.');
  if (opts.mode === 'level' && cfg.preQuiz) runSizingQuiz(0, 0);
  updateObjectivesLive();
  R.last = performance.now();
  rafId = requestAnimationFrame(loop);
}

/* ---------- prices ---------- */
const tickIndex = () => R.ci * TPC + R.ti;
const price = () => R.m.ticks[Math.min(tickIndex(), R.m.ticks.length - 1)];
const spreadOf = p => Math.max(.01, p * .0005);
const bid = () => price() - spreadOf(price()) / 2;
const ask = () => price() + spreadOf(price()) / 2;
const atrNow = () => R.m.atr[Math.max(0, R.ci - 1)] || price() * .01;

function visibleCandles() {
  const done = R.m.candles.slice(0, R.ci);
  if (R.ci < R.total && R.ti > 0) done.push(candleFrom(R.m.ticks, R.ci * TPC, R.ti + 1));
  else if (R.ci < R.total) { const p = price(); done.push({ o: p, h: p, l: p, c: p }); }
  return done;
}

/* ---------- ticket math ---------- */
function ticketEntry() {
  const t = R.tk;
  if (t.type === 'limit') {
    if (t.limit == null) t.limit = t.side > 0 ? bid() - atrNow() * .8 : ask() + atrNow() * .8;
    return t.limit;
  }
  return t.side > 0 ? ask() : bid();
}
function ticketQty() {
  const t = R.tk, entry = ticketEntry();
  const maxQty = Math.floor(R.equity * 2 / entry);
  if (R.rules.sizing === 'manual') return { qty: Math.min(t.qty, maxQty), capped: t.qty > maxQty };
  const want = Math.floor(R.equity * t.riskPct / 100 / t.stopDist);
  return { qty: Math.max(0, Math.min(want, maxQty)), capped: want > maxQty };
}
function ticketPlan() {
  const t = R.tk, entry = ticketEntry(), { qty, capped } = ticketQty();
  const stop = t.useStop ? entry - t.side * t.stopDist : null;
  const target = t.useStop && t.useTarget ? entry + t.side * t.stopDist * t.targetR : null;
  const risk$ = stop != null ? qty * t.stopDist : null;
  const riskPct = risk$ != null ? risk$ / R.equity * 100 : null;
  return { entry, qty, capped, stop, target, risk$, riskPct, rr: target != null ? t.targetR : null };
}

/* ---------- order execution ---------- */
function placeOrder() {
  if (!R || R.kind !== 'trade' || R.ended) return;
  if (R.pos || R.pending) return;
  const plan = ticketPlan();
  if (plan.qty < 1) { toast('Position size is 0 shares. Widen your risk or tighten your stop.'); Snd.play('wrong'); return; }
  if (R.rules.stop === 'required' && !R.tk.useStop) return;
  if (!R.started) startPlaying();
  if (R.tk.type === 'limit') {
    const t = R.tk;
    const marketable = t.side > 0 ? t.limit >= ask() : t.limit <= bid();
    if (marketable) { toast('That limit price is already through the market, so it fills now like a market order.'); }
    R.pending = { side: t.side, qty: plan.qty, limit: t.limit, stopDist: t.useStop ? t.stopDist : null, targetR: t.useStop && t.useTarget ? t.targetR : null, placedIdx: R.ci };
    Snd.play('click');
    coach(`Limit ${t.side > 0 ? 'buy' : 'sell'} ${plan.qty} @ ${fmtP(t.limit)} is waiting. It fills only if price ${t.side > 0 ? 'drops' : 'rises'} to your level.`);
    if (marketable) checkPending();
    renderPanelMode();
    return;
  }
  openPosition(R.tk.side, plan.qty, plan.entry, plan.stop, plan.target, false);
}

function openPosition(side, qty, entry, stop, target, limitEntry, extra = {}) {
  const last = R.trades[R.trades.length - 1];
  const revenge = !!(last && last.pnl < 0 && R.ci - last.closeIdx <= 1);
  const risk$ = stop != null ? Math.abs(entry - stop) * qty : null;
  R.pos = {
    side, qty, entry, stop, target, origStop: stop, openIdx: R.ci, limitEntry,
    risk$, riskPct: risk$ != null ? risk$ / R.equity * 100 : Infinity,
    plannedRR: stop != null && target != null ? Math.abs(target - entry) / Math.abs(entry - stop) : 0,
    revenge, fomo: !!extra.fomo, widened: false, withCross: false, beHinted: false,
  };
  R.cash -= FEE;
  if (revenge) { R.flags.revenge++; coach('You jumped back in right after a loss. Is this a setup you planned, or are you trying to win it back?', 'warn'); }
  const lc = R.lastCross;
  if (lc && !extra.fomo && R.ci - lc.idx <= 3 && lc.dir === side) { R.pos.withCross = true; R.stat.crossTrades++; coach(`Good timing: you entered ${side > 0 ? 'long' : 'short'} right after the ${side > 0 ? 'bullish' : 'bearish'} crossover.`, 'good'); }
  R.markers.push({ idx: R.ci, price: entry, kind: 'entry', side, color: side > 0 ? T.up : T.down });
  Snd.play('fill');
  if (!S.counters.trades && !R.trades.length) coach(`Filled at ${fmtP(entry)}. You ${side > 0 ? 'bought at the ask' : 'sold at the bid'}, so you start a few cents down. That gap is the spread.`);
  else if (stop == null && R.rules.stop !== 'off' && !extra.fomo) coach('No stop-loss on this one. Your loss is now unlimited.', 'warn');
  if (R.pos.riskPct > RISK_OK && isFinite(R.pos.riskPct) && R.rules.sizing === 'risk') coach(`This trade risks ${R.pos.riskPct.toFixed(1)}% of your account. Five losses like it would cost you about ${(100 - 100 * Math.pow(1 - R.pos.riskPct / 100, 5)).toFixed(0)}%.`, 'warn');
  renderPanelMode();
  updateObjectivesLive();
}

function closePosition(exit, reason) {
  const p = R.pos; if (!p) return;
  const gross = p.side * (exit - p.entry) * p.qty;
  const pnl = gross - FEE * 2;
  R.cash += gross - FEE; // entry fee already deducted
  const r = p.risk$ ? gross / p.risk$ : null; // R is price-based: fees are not counted
  const t = {
    when: Date.now(), where: whereLabel(), side: p.side, qty: p.qty, entry: p.entry, exit, pnl, r, reason,
    hadStop: p.origStop != null, riskPct: p.riskPct, plannedRR: p.plannedRR, revenge: p.revenge, fomo: p.fomo, widened: p.widened,
    limitEntry: p.limitEntry, withCross: p.withCross, openIdx: p.openIdx, closeIdx: R.ci,
  };
  R.trades.push(t); R.pos = null;
  if (reason === 'stop') R.stat.stopHits++;
  if (reason === 'target') R.stat.targetHits++;
  R.markers.push({ idx: R.ci, price: exit, kind: 'exit', side: t.side, color: pnl >= 0 ? T.up : T.down });
  if (pnl > 0) {
    Snd.play('win');
    if (r != null && r >= 2) Confetti.burst(90);
    coach(`${reason === 'target' ? 'Target hit' : 'Closed'} for ${fmt$s(pnl)}${r != null ? ` (${fmtR(r)})` : ''}. ${r != null && r >= 2 ? 'That is how a big winner pays for several small losers.' : ''}`, 'good');
  } else {
    Snd.play('loss');
    if (reason === 'stop') coach(`Stopped out for ${fmt$s(pnl)} (${fmtR(r)}). That is the plan working: a small loss you defined in advance.`);
    else if (r == null && pnl < -R.equity * .03) { coach(`That loss was ${fmt$s(pnl)}, ${(Math.abs(pnl) / START_CASH * 100).toFixed(1)}% of your starting account. A stop would have capped it.`, 'warn'); shake(); }
    else coach(`Closed for ${fmt$s(pnl)}${r != null ? ` (${fmtR(r)})` : ''}.`);
    if (pnl < -START_CASH * .025) shake();
  }
  onTradeClosed(t);
  renderPanelMode();
  updateObjectivesLive();
}
function whereLabel() {
  if (R.mode === 'level') return `L${R.cfg.id} ${R.cfg.title}`;
  if (R.mode === 'scenario') return R.cfg.title;
  return R.mode === 'daily' ? 'Daily ' + todayKey() : 'Endless';
}
function shake() { const w = $('#chart-wrap'); w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake'); }

function checkPending() {
  const o = R.pending; if (!o) return;
  const hit = o.side > 0 ? ask() <= o.limit : bid() >= o.limit;
  if (!hit) return;
  const fill = o.side > 0 ? Math.min(o.limit, ask()) : Math.max(o.limit, bid());
  R.pending = null;
  R.stat.limitFills++;
  const stop = o.stopDist != null ? fill - o.side * o.stopDist : null;
  const target = o.targetR != null ? fill + o.side * o.stopDist * o.targetR : null;
  coach(`Limit order filled at ${fmtP(fill)}. You got the price you planned.`, 'good');
  openPosition(o.side, o.qty, fill, stop, target, true);
}
function checkExits() {
  const p = R.pos; if (!p) return;
  if (p.side > 0) {
    const b = bid();
    if (p.stop != null && b <= p.stop) return closePosition(b, 'stop');
    if (p.target != null && b >= p.target) return closePosition(p.target, 'target');
  } else {
    const a = ask();
    if (p.stop != null && a >= p.stop) return closePosition(a, 'stop');
    if (p.target != null && a <= p.target) return closePosition(p.target, 'target');
  }
}
function markEquity() {
  const p = R.pos;
  const unreal = p ? p.side * ((p.side > 0 ? bid() : ask()) - p.entry) * p.qty : 0;
  R.equity = R.cash + unreal;
  if (R.equity > R.peak) R.peak = R.equity;
  const dd = (R.peak - R.equity) / R.peak * 100;
  if (dd > R.maxDD) R.maxDD = dd;
  return unreal;
}

/* ---------- clock ---------- */
function startPlaying() {
  R.started = true; R.playing = true;
  $('#overlay-play').hidden = true;
  setPlayIcon();
}
function togglePlay() {
  if (!R || R.kind !== 'trade' || R.ended || modalOpen()) return;
  if (!R.started) { startPlaying(); return; }
  R.playing = !R.playing; setPlayIcon();
}
function setPlayIcon() { $('#btn-playpause use').setAttribute('href', R && R.playing ? '#i-pause' : '#i-play'); }
function setSpeed(v) {
  if (R) R.speed = v;
  $$('#speed-seg button').forEach(b => b.classList.toggle('on', +b.dataset.v === v));
}

function step() {
  R.ti++;
  if (R.ti >= TPC) { R.ti = 0; R.ci++; if (onCandle()) return; }
  checkPending();
  checkExits();
  markEquity();
}
function onCandle() {
  R.eqCurve.push(R.equity);
  const k = R.ci - 1, m = R.m;
  if (R.rules.ma && m.ma20[k] != null && m.ma50[k] != null && m.ma20[k - 1] != null && m.ma50[k - 1] != null) {
    const a = m.ma20[k - 1] - m.ma50[k - 1], b = m.ma20[k] - m.ma50[k];
    if (a <= 0 && b > 0) { R.lastCross = { idx: R.ci, dir: 1 }; coach('<b>Bullish crossover:</b> MA20 just crossed above MA50. Trend followers look for longs in the next few candles.', 'good'); Snd.play('alert'); }
    if (a >= 0 && b < 0) { R.lastCross = { idx: R.ci, dir: -1 }; coach('<b>Bearish crossover:</b> MA20 just crossed below MA50. Momentum is turning down.', 'warn'); Snd.play('alert'); }
  }
  const liveIdx = R.ci - R.hist;
  for (const e of R.events) {
    if (e.done || e.at !== liveIdx) continue;
    e.done = true;
    if (e.kind === 'news') { showNews(e.text); }
    else if (e.kind === 'fomo') { if (!R.pos) { fomoPrompt(); return false; } else showNews(`${R.sym} is ripping higher. Everyone online is posting gains.`); }
  }
  if (R.newsUntil >= 0 && R.ci >= R.newsUntil) { $('#news').hidden = true; R.newsUntil = -1; }
  if (R.ci >= R.total) { endTradeRound(); return true; }
  // coach: breakeven hint
  const p = R.pos;
  if (p && p.risk$ && !p.beHinted && R.rules.stop !== 'off') {
    const r = p.side * ((p.side > 0 ? bid() : ask()) - p.entry) * p.qty / p.risk$;
    if (r >= 1) { p.beHinted = true; coach('You are up 1R. Consider moving your stop to breakeven: then the worst case is a scratch.', 'good'); }
  }
  return false;
}
function showNews(text) {
  $('#news-text').textContent = text; $('#news').hidden = false; R.newsUntil = R.ci + 7; Snd.play('alert');
}
function fomoPrompt() {
  R.playing = false; setPlayIcon();
  Snd.play('alert');
  const chg = (price() / R.m.candles[Math.max(0, R.ci - 8)].c - 1) * 100;
  modal({
    cls: 'fomo', title: 'Your group chat is going wild',
    html: `<p>"${esc(R.sym)} is up ${chg.toFixed(1)}% in the last few candles! Last chance before it doubles. I'm all in!"</p><p>Buy now at market, risking 10% of your account with no stop?</p>`,
    actions: [
      { label: 'Stick to my plan', cls: 'primary', onClick: () => { R.flags.fomoDeclined++; coach('Good call. Chasing a vertical move after it already happened is how retail traders become exit liquidity.', 'good'); Snd.play('right'); R.playing = true; setPlayIcon(); } },
      { label: 'Buy now!', cls: 'sell', onClick: () => {
        R.flags.fomoTaken++;
        const e = ask(), qty = Math.max(1, Math.min(Math.floor(R.equity * .1 / (atrNow() * 2)), Math.floor(R.equity / e)));
        openPosition(1, qty, e, null, null, false, { fomo: true });
        R.pos.riskPct = 10;
        coach('You just bet big with no stop on a tip from a group chat. Watch what happens next.', 'warn');
        R.playing = true; setPlayIcon();
      } },
    ],
  });
}

function loop(now) {
  if (!R || R.kind !== 'trade') return;
  const dt = Math.min(250, now - R.last); R.last = now;
  if (R.playing && !R.ended) {
    const interval = 1000 / TPC / R.speed;
    R.acc += dt;
    let n = 0;
    while (R.acc >= interval && n < 60 && R.playing && !R.ended) { R.acc -= interval; step(); n++; }
  }
  if (!R.ended) { drawTrade(); updatePanelLive(); }
  if (!R.ended) rafId = requestAnimationFrame(loop);
}

/* ---------- chart state per frame ---------- */
function drawTrade() {
  const candles = visibleCandles();
  const lines = [];
  const p = R.pos, t = R.tk;
  if (p) {
    lines.push({ id: 'entry', price: p.entry, color: T.muted, label: `Entry ${p.side > 0 ? 'long' : 'short'} ${p.qty}` });
    if (p.stop != null) lines.push({
      id: 'stop', price: p.stop, color: T.down, dash: true, draggable: true,
      label: `Stop ${fmt$s(p.side * (p.stop - p.entry) * p.qty)}`,
      onDrag: v => moveStop(v),
    });
    if (p.target != null) lines.push({
      id: 'target', price: p.target, color: T.up, dash: true, draggable: true,
      label: `Target ${fmt$s(p.side * (p.target - p.entry) * p.qty)}`,
      onDrag: v => { p.target = p.side > 0 ? Math.max(v, bid() + .01) : Math.min(v, ask() - .01); },
    });
  } else if (R.pending) {
    const o = R.pending;
    lines.push({ id: 'pend', price: o.limit, color: T.accent, ink: T.accentInk, dash: true, draggable: true, label: `Limit ${o.side > 0 ? 'buy' : 'sell'} ${o.qty}`, onDrag: v => { o.limit = v; } });
    if (o.stopDist != null) lines.push({ id: 'pstop', price: o.limit - o.side * o.stopDist, color: T.down, dash: true, label: 'Stop (on fill)', scale: true });
    if (o.targetR != null) lines.push({ id: 'ptgt', price: o.limit + o.side * o.stopDist * o.targetR, color: T.up, dash: true, label: 'Target (on fill)' });
  } else if (!R.ended) {
    const plan = ticketPlan();
    if (t.type === 'limit') lines.push({ id: 'lim', price: plan.entry, color: T.accent, ink: T.accentInk, dash: true, draggable: true, label: 'Limit price', onDrag: v => { t.limit = v; } });
    if (plan.stop != null) lines.push({
      id: 'pstop', price: plan.stop, color: T.down, dash: true, draggable: true, label: plan.risk$ != null ? `Stop −${fmt$(plan.risk$)}` : 'Stop',
      onDrag: v => { const d = (plan.entry - v) * t.side; t.stopDist = Math.max(atrNow() * .2, d); },
    });
    if (plan.target != null) lines.push({
      id: 'ptgt', price: plan.target, color: T.up, dash: true, draggable: true, label: `Target ${t.targetR.toFixed(1)}R`,
      onDrag: v => { const d = (v - plan.entry) * t.side; t.targetR = clamp(Math.round(d / t.stopDist * 10) / 10, .5, 10); },
    });
  }
  const mas = R.rules.ma ? [{ vals: R.m.ma20.slice(0, R.ci), color: T.accent }, { vals: R.m.ma50.slice(0, R.ci), color: T.info }] : null;
  chart.set({
    candles, lines, markers: R.markers, mas, last: price(),
    rsi: R.rules.rsi ? R.m.rsi.slice(0, R.ci) : null,
    legend: R.rules.ma ? [{ label: 'MA20', color: T.accent }, { label: 'MA50', color: T.info }] : null,
  });
}
function moveStop(v) {
  const p = R.pos;
  const mk = p.side > 0 ? bid() : ask();
  let ns = p.side > 0 ? Math.min(v, mk - .01) : Math.max(v, mk + .01);
  const wider = p.side > 0 ? ns < p.stop - 1e-9 : ns > p.stop + 1e-9;
  const ref = p.origStop ?? p.stop;
  const beyondOrig = p.side > 0 ? ns < ref - 1e-9 : ns > ref + 1e-9;
  if (wider && beyondOrig && !p.widened) {
    p.widened = true; R.flags.widened++;
    coach('You moved your stop further away. That is how a planned small loss becomes an unplanned big one.', 'warn'); Snd.play('wrong');
  }
  p.stop = ns;
}

/* ---------- side panel ---------- */
function buildTradePanel() {
  const r = R.rules;
  const panel = $('#side-panel');
  panel.innerHTML = `
  <div class="panel-sec" id="tk">
    <h4>Order ticket <span class="mono muted" style="font-size:12px" id="tk-ba"></span></h4>
    <div class="field-row">
      <div class="seg side" id="tk-side"><button data-v="1" class="on">Long (buy)</button><button data-v="-1">Short (sell)</button></div>
      ${r.allowLimit ? `<div class="seg" id="tk-type"><button data-v="market" class="on">Market</button><button data-v="limit">Limit</button></div>` : ''}
    </div>
    ${r.sizing === 'manual' ? `<div class="field"><span class="label">Quantity (shares)</span><div class="chips" id="tk-qty">${r.qtys.map(q => `<button class="chip${q === R.tk.qty ? ' on' : ''}" data-v="${q}">${q}</button>`).join('')}</div></div>`
      : `<div class="field"><div class="field-row"><label class="label" for="tk-risk">Risk per trade</label><span class="mono" id="tk-risk-v"></span></div><input type="range" id="tk-risk" min="0.25" max="10" step="0.25" value="${R.tk.riskPct}"></div>`}
    ${r.stop === 'off' ? `<div class="locked-note">Stop-losses unlock in Level 4. For now you close trades yourself.</div>` : `
    <div class="field-row">
      ${r.stop === 'optional' ? `<label class="toggle"><input type="checkbox" id="tk-usestop" checked> Stop-loss</label>` : `<span class="label">Stop-loss (required)</span>`}
      <div class="seg"><button id="tk-tighter" title="Move stop closer">Tighter</button><button id="tk-wider" title="Move stop further">Wider</button></div>
    </div>`}
    ${r.target === 'optional' ? `<div class="field-row">
      <label class="toggle"><input type="checkbox" id="tk-usetgt" ${R.tk.useTarget ? 'checked' : ''}> Take-profit</label>
      <div class="chips" id="tk-tgt">${[1, 1.5, 2, 3].map(v => `<button class="chip" data-v="${v}">${v}R</button>`).join('')}</div>
    </div>` : ''}
    <div class="preview" id="tk-prev"></div>
    <button class="btn place-btn buy" id="tk-place">Buy</button>
    ${r.stop !== 'off' || r.allowLimit ? `<div class="locked-note">Drag the dashed lines on the chart to set your ${[r.stop !== 'off' ? 'stop' : '', r.target === 'optional' ? 'target' : '', r.allowLimit ? 'limit price' : ''].filter(Boolean).join(', ')}.</div>` : ''}
  </div>
  <div class="panel-sec" id="pend-sec" hidden>
    <h4>Pending order</h4>
    <div class="preview" id="pend-info"></div>
    <button class="btn" id="pend-cancel">Cancel order</button>
  </div>
  <div class="panel-sec" id="pos-sec" hidden>
    <h4>Open position <span id="pos-side" class="mono"></span></h4>
    <div class="pnl-big" id="pos-pnl">$0.00</div>
    <div class="pos-grid">
      <span class="muted">Entry</span><span class="mono" id="pos-entry"></span>
      <span class="muted">Shares</span><span class="mono" id="pos-qty"></span>
      <span class="muted">Stop</span><span class="mono" id="pos-stop"></span>
      <span class="muted">Target</span><span class="mono" id="pos-tgt"></span>
      <span class="muted">Open R</span><span class="mono" id="pos-r"></span>
    </div>
    <div class="pos-actions">
      ${r.stop !== 'off' ? '<button class="btn small" id="pos-be">Stop to breakeven</button>' : ''}
      <button class="btn small primary" id="pos-close">Close position</button>
    </div>
  </div>
  <div class="panel-sec"><h4>Coach</h4><div class="coach" id="coach"></div></div>`;

  $$('#tk-side button').forEach(b => b.addEventListener('click', () => { R.tk.side = +b.dataset.v; R.tk.limit = null; $$('#tk-side button').forEach(x => x.classList.toggle('on', x === b)); Snd.play('click'); }));
  $$('#tk-type button').forEach(b => b.addEventListener('click', () => { R.tk.type = b.dataset.v; R.tk.limit = null; $$('#tk-type button').forEach(x => x.classList.toggle('on', x === b)); Snd.play('click'); }));
  $$('#tk-qty .chip').forEach(b => b.addEventListener('click', () => { R.tk.qty = +b.dataset.v; $$('#tk-qty .chip').forEach(x => x.classList.toggle('on', x === b)); Snd.play('click'); }));
  const rk = $('#tk-risk'); if (rk) rk.addEventListener('input', () => { R.tk.riskPct = +rk.value; });
  const us = $('#tk-usestop'); if (us) us.addEventListener('change', () => { R.tk.useStop = us.checked; if (!us.checked) coach('Stop-loss off. If this trade goes wrong, nothing will get you out.', 'warn'); });
  const ut = $('#tk-usetgt'); if (ut) ut.addEventListener('change', () => { R.tk.useTarget = ut.checked; });
  $$('#tk-tgt .chip').forEach(b => b.addEventListener('click', () => { R.tk.targetR = +b.dataset.v; R.tk.useTarget = true; if (ut) ut.checked = true; Snd.play('click'); }));
  const ti = $('#tk-tighter'), wi = $('#tk-wider');
  if (ti) ti.addEventListener('click', () => { R.tk.stopDist = Math.max(atrNow() * .25, R.tk.stopDist - atrNow() * .25); });
  if (wi) wi.addEventListener('click', () => { R.tk.stopDist += atrNow() * .25; });
  $('#tk-place').addEventListener('click', placeOrder);
  $('#pend-cancel').addEventListener('click', () => { R.pending = null; coach('Order cancelled.'); renderPanelMode(); });
  $('#pos-close').addEventListener('click', () => { if (R.pos) closePosition(R.pos.side > 0 ? bid() : ask(), 'manual'); });
  const be = $('#pos-be');
  if (be) be.addEventListener('click', () => {
    const p = R.pos; if (!p) return;
    const mk = p.side > 0 ? bid() : ask();
    if (p.stop == null) {
      const inProfit = (mk - p.entry) * p.side > 0;
      p.stop = inProfit ? p.entry : mk - p.side * atrNow();
      coach(inProfit ? 'Stop added at breakeven.' : 'Stop added one ATR away. Late, but better than none.');
      return;
    }
    if ((mk - p.entry) * p.side <= 0) { toast('Price has to be beyond your entry to move the stop to breakeven.'); return; }
    p.stop = p.entry; coach('Stop moved to breakeven. Worst case now is a scratch trade.', 'good'); Snd.play('click');
  });
  renderPanelMode();
}
function renderPanelMode() {
  $('#tk').hidden = !!(R.pos || R.pending);
  $('#pend-sec').hidden = !R.pending;
  $('#pos-sec').hidden = !R.pos;
  $$('#tk-tgt .chip').forEach(b => b.classList.toggle('on', R.tk.useTarget && +b.dataset.v === R.tk.targetR));
}
function updatePanelLive() {
  const p = price(), unreal = markEquity();
  $('#px').textContent = fmtP(p);
  $('#px').className = 'px ' + cls(p - R.m.candles[R.hist - 1].c);
  $('#h-equity').textContent = fmt$(R.equity);
  const net = R.equity - START_CASH;
  $('#h-net').textContent = fmt$s(net); $('#h-net').className = 'mono ' + cls(net);
  $('#h-trades').textContent = R.trades.length;
  const done = R.ci - R.hist;
  $('#progress').style.width = clamp(done / R.live * 100, 0, 100) + '%';
  $('#candle-count').textContent = `${Math.min(done, R.live)}/${R.live}`;

  if (!$('#tk').hidden) {
    const t = R.tk, plan = ticketPlan();
    $('#tk-ba').textContent = `bid ${fmtP(bid())} · ask ${fmtP(ask())}`;
    const rv = $('#tk-risk-v'); if (rv) { rv.textContent = t.riskPct.toFixed(2) + '%'; rv.className = 'mono ' + (t.riskPct > 2 ? 'down' : ''); }
    const rows = [];
    rows.push(['Entry', `${t.type === 'limit' ? 'limit ' : '≈ '}${fmtP(plan.entry)}`]);
    rows.push(['Size', `${plan.qty} sh · ${fmt$(plan.qty * plan.entry)}${plan.capped ? ' (max)' : ''}`]);
    if (R.rules.stop !== 'off') {
      if (plan.stop != null) rows.push(['Stop', `${fmtP(plan.stop)} · −${fmt$(plan.risk$)}`]);
      if (plan.riskPct != null) rows.push(['Risk', `<span class="${plan.riskPct > 2 ? 'warn' : ''}">${plan.riskPct.toFixed(2)}% of account${plan.riskPct > 2 ? ' · over 2%' : ''}</span>`]);
      else rows.push(['Risk', '<span class="warn">No stop: unlimited</span>']);
    }
    if (plan.target != null) rows.push(['Target', `${fmtP(plan.target)} · +${fmt$(plan.qty * t.stopDist * t.targetR)} · 1:${t.targetR.toFixed(1)}`]);
    else if (R.rules.target === 'optional') rows.push(['R:R', '<span class="muted">no target set</span>']);
    $('#tk-prev').innerHTML = rows.map(([a, b]) => `<div class="row"><span class="muted">${a}</span><span>${b}</span></div>`).join('');
    const btn = $('#tk-place');
    const blocked = R.rules.stop === 'required' && !t.useStop;
    btn.disabled = blocked || plan.qty < 1;
    btn.className = 'btn place-btn ' + (t.side > 0 ? 'buy' : 'sell');
    btn.textContent = `${t.side > 0 ? 'Buy' : 'Short'} ${plan.qty} @ ${t.type === 'limit' ? 'limit ' + fmtP(plan.entry) : 'market'}`;
  }
  if (R.pending) {
    const o = R.pending;
    $('#pend-info').innerHTML = `<div class="row"><span class="muted">${o.side > 0 ? 'Buy' : 'Sell'} limit</span><span>${o.qty} @ ${fmtP(o.limit)}</span></div><div class="row"><span class="muted">Distance</span><span>${fmtP(Math.abs(p - o.limit))} away</span></div>`;
  }
  if (R.pos) {
    const q = R.pos;
    $('#pos-side').textContent = q.side > 0 ? 'LONG' : 'SHORT';
    $('#pos-side').className = 'mono ' + (q.side > 0 ? 'up' : 'down');
    $('#pos-pnl').textContent = fmt$s(unreal - FEE); $('#pos-pnl').className = 'pnl-big ' + cls(unreal);
    $('#pos-entry').textContent = fmtP(q.entry);
    $('#pos-qty').textContent = q.qty;
    $('#pos-stop').textContent = q.stop != null ? fmtP(q.stop) : 'none';
    $('#pos-stop').className = 'mono ' + (q.stop == null ? 'down' : '');
    $('#pos-tgt').textContent = q.target != null ? fmtP(q.target) : 'none';
    $('#pos-r').textContent = q.risk$ ? fmtR(unreal / q.risk$) : '—';
  }
}

function roundStats() {
  const tr = R.trades, n = tr.length;
  const wins = tr.filter(t => t.pnl > 0).length;
  const rs = tr.filter(t => t.r != null).map(t => t.r);
  return {
    trades: tr, n, wins, winRate: n ? wins / n * 100 : 0,
    net: R.equity - START_CASH, netPct: (R.equity - START_CASH) / START_CASH * 100,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    bestR: rs.length ? Math.max(...rs) : -Infinity,
    maxDD: R.maxDD, ...R.stat, widened: R.flags.widened, revenge: R.flags.revenge, fomoTaken: R.flags.fomoTaken, fomoDeclined: R.flags.fomoDeclined,
    quizScore: R.quizScore,
  };
}
function updateObjectivesLive() {
  if (!R || R.kind !== 'trade') return;
  const s = roundStats();
  if (R.stars) markObjectives(R.stars.map(st => st.check(s)));
  else markObjectives([s.net > 0, s.n > 0 && s.trades.every(t => t.hadStop), allDisciplined(s)]);
}

/* ---------- sizing quiz (Level 5) ---------- */
function runSizingQuiz(i, score) {
  const acct = [10000, 25000, 8000][i], risk = [1, 2, 1.5][i], dist = [2, 1.25, .8][i];
  const qs = [
    () => { const ans = Math.round(acct * risk / 100 / dist); return { q: `Account <b>${fmt$(acct)}</b>. You risk <b>${risk}%</b>. Your stop is <b>${fmt$(dist)}</b> below entry. How many shares?`, opts: shuffle([ans, Math.round(acct * risk / 100), Math.round(acct / dist / 10), Math.round(ans * 2.5)].map(String)), ans: String(ans), why: `${fmt$(acct)} × ${risk}% = ${fmt$(acct * risk / 100)} at risk. ÷ ${fmt$(dist)} per share = ${ans} shares.` }; },
    () => { const sh = 400, d = 1.25, ans = fmt$(sh * d); return { q: `You hold <b>${sh} shares</b> with a stop <b>${fmt$(d)}</b> below entry. On a ${fmt$(acct)} account, how much do you lose if the stop is hit?`, opts: shuffle([ans, fmt$(sh * d * 2), fmt$(d * 100), fmt$(sh)]), ans, why: `${sh} × ${fmt$(d)} = ${ans}, which is ${(sh * d / acct * 100).toFixed(1)}% of the account.` }; },
    () => ({ q: 'You lose <b>5 trades in a row</b>, risking <b>2%</b> each time. About how much of your account is left?', opts: shuffle(['About 90%', 'About 59%', 'About 75%', 'About 98%']), ans: 'About 90%', why: '0.98⁵ ≈ 0.904, so about 90% is left. Risking 10% per trade would leave about 59% (0.9⁵).' }),
  ];
  const q = qs[i]();
  modal({
    title: `Sizing check ${i + 1} of 3`,
    html: `<p style="color:var(--fg)">${q.q}</p><div class="choices" id="szq">${q.opts.map(o => `<button class="btn" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div><div id="szq-why"></div>`,
    actions: [],
  });
  $$('#szq .btn').forEach(b => b.addEventListener('click', () => {
    const ok = b.dataset.v === q.ans;
    $$('#szq .btn').forEach(x => { x.disabled = true; if (x.dataset.v === q.ans) x.classList.add('correct'); else if (x === b) x.classList.add('wrong'); });
    Snd.play(ok ? 'right' : 'wrong');
    const sc = score + (ok ? 1 : 0);
    $('#szq-why').innerHTML = `<div class="explain ${ok ? 'ok' : 'no'}"><b>${ok ? 'Correct.' : 'Not quite.'}</b> ${q.why}</div>`;
    const act = $('.modal .actions');
    const nb = document.createElement('button'); nb.className = 'btn primary'; nb.textContent = i < 2 ? 'Next' : 'Start trading';
    nb.addEventListener('click', () => {
      $('#modal-root').innerHTML = '';
      if (i < 2) runSizingQuiz(i + 1, sc);
      else { R.quizScore = sc; coach(`Sizing quiz: ${sc}/3. Now use the slider to size real trades.`, sc === 3 ? 'good' : ''); updateObjectivesLive(); }
    });
    act.appendChild(nb); nb.focus();
  }));
}

/* ---------- end of round ---------- */
function endTradeRound() {
  if (R.ended) return;
  R.ci = Math.min(R.ci, R.total - 1); R.ti = TPC - 1;
  if (R.pos) closePosition(R.pos.side > 0 ? bid() : ask(), 'end');
  R.pending = null;
  markEquity();
  R.ended = true; R.playing = false;
  const s = roundStats();
  if (R.mode === 'level' || R.mode === 'scenario') {
    const checks = R.stars.map(st => ({ label: st.label, ok: !!st.check(s), why: st.why(s) }));
    const stars = checks.filter(c => c.ok).length;
    if (R.mode === 'level') completeLevel(R.cfg, stars, { checks, stats: s });
    else completeScenario(R.cfg, stars, { checks, stats: s });
  } else completeFree(s);
}

/* =========================================================================
   Debrief + progression
   ========================================================================= */
function completeLevel(level, stars, info) {
  const prev = S.levels[level.id] || { stars: 0, done: false };
  const passed = stars >= 2;
  let xp = 0;
  const newStars = Math.max(0, stars - prev.stars);
  xp += newStars * 100;
  if (passed && !prev.done) xp += 100;
  if (!newStars) xp += 20;
  S.levels[level.id] = { stars: Math.max(prev.stars, stars), done: prev.done || passed };
  addXP(xp);
  save();
  if (level.type === 'trade' && stars === 3) unlock('flawless');
  if (level.id === 8 && passed && info.checks[1].ok) unlock('boss');
  if (LEVELS.every(l => levelDone(l.id))) unlock('grad');
  showDebrief({
    title: passed ? (stars === 3 ? 'Flawless round' : 'Level passed') : 'Not this time',
    stars, xp, checks: info.checks, stats: info.stats, quizCorrect: info.quizCorrect,
    verdict: passed ? (prev.done ? 'Replays sharpen the habit.' : (level.id < LEVELS.length ? `Level ${level.id + 1} is unlocked.` : 'You finished the course. The Endless Market and daily challenge are where habits are built.')) : 'You need 2 stars to pass. Read the checklist below, then try again: each round is a new market.',
    takeaway: level.takeaway,
    next: passed && level.id < LEVELS.length ? () => openLesson(LEVELS[level.id]) : null,
    retry: () => level.type === 'quiz' ? startQuiz(level) : startTrade({ mode: 'level', level }),
  });
}
function completeScenario(sc, stars, info) {
  const prev = S.scen[sc.key] || { stars: 0 };
  const newStars = Math.max(0, stars - prev.stars);
  const xp = newStars * 80 + 30;
  S.scen[sc.key] = { stars: Math.max(prev.stars, stars) };
  addXP(xp);
  if (sc.key === 'flash' && info.stats.n > 0 && info.stats.maxDD < 3) unlock('survivor');
  save();
  showDebrief({
    title: stars >= 2 ? 'Scenario survived' : 'The market won this one', stars, xp, checks: info.checks, stats: info.stats,
    verdict: `${sc.title}: ${sc.sub}.`, takeaway: sc.takeaway,
    retry: () => startTrade({ mode: 'scenario', scen: sc }),
  });
}
function completeFree(s) {
  const disc = s.n ? Math.round(s.trades.filter(t => t.hadStop && t.riskPct <= RISK_OK).length / s.n * 100) : 0;
  const goodTrades = s.trades.filter(t => t.hadStop && t.riskPct <= RISK_OK).length;
  let xp = 30 + Math.min(10, goodTrades) * 10 + (s.net > 0 ? 50 : 0);
  const daily = R.mode === 'daily';
  let note = '';
  if (daily) {
    const k = todayKey(), prev = S.daily[k];
    if (!prev) xp += 100;
    if (!prev || s.net > prev.net) S.daily[k] = { net: s.net, netPct: s.netPct, disc };
    note = prev ? `Today's best: ${fmt$s(Math.max(prev.net, s.net))}.` : 'First run today: +100 XP bonus.';
    unlock('daily');
  } else {
    if (!S.endlessBest || s.net > S.endlessBest.net) { S.endlessBest = { net: s.net, netPct: s.netPct }; note = 'New personal best.'; }
  }
  addXP(xp); save();
  const checks = [
    { label: 'Grow the account', ok: s.net > 0, why: `Net ${fmt$s(s.net)} (${fmtPct(s.netPct)}).` },
    { label: 'Stops on every trade', ok: s.n > 0 && s.trades.every(t => t.hadStop), why: `${s.trades.filter(t => t.hadStop).length} of ${s.n} trades.` },
    { label: 'Risk 2% or less on every trade', ok: allDisciplined(s), why: `Discipline score ${disc}%.` },
  ];
  showDebrief({
    title: daily ? 'Daily challenge complete' : 'Run complete', stars: checks.filter(c => c.ok).length, xp, checks, stats: s,
    verdict: note || 'Every run is a new market. Your rules are the only thing that stays the same.',
    takeaway: s.avgR != null && s.avgR > 0 ? `Your average trade made ${fmtR(s.avgR)}. Over 100 trades, that adds up to ${(s.avgR * 100).toFixed(0)}R.` : 'Track your average R per trade. If it is positive and your risk is fixed, time is on your side.',
    retry: daily ? null : () => startTrade({ mode: 'endless' }),
    retryLabel: 'New run',
  });
}

function showDebrief(d) {
  show('debrief');
  const s = d.stats;
  const rows = s ? s.trades.map((t, i) => `<tr>
    <td>${i + 1}</td><td class="${t.side > 0 ? 'up' : 'down'}">${t.side > 0 ? 'Long' : 'Short'}</td>
    <td class="num">${t.qty}</td><td class="num">${fmtP(t.entry)}</td><td class="num">${fmtP(t.exit)}</td>
    <td class="num ${cls(t.pnl)}">${fmt$s(t.pnl)}</td><td class="num ${cls(t.r || 0)}">${fmtR(t.r)}</td>
    <td>${t.reason}</td><td>${flagsHtml(t)}</td></tr>`).join('') : '';
  $('#debrief').innerHTML = `
    <div class="debrief-head">
      <span class="label"></span>
      <h2>${esc(d.title)}</h2>
      <div class="big-stars">${[0, 1, 2].map(i => `<svg class="star${i < d.stars ? ' on' : ''}"><use href="#i-star"/></svg>`).join('')}</div>
      <div class="xp-gain">+${d.xp} XP</div>
      <div class="verdict">${esc(d.verdict)}</div>
    </div>
    <div class="card">
      <span class="label">Scorecard</span>
      <div class="checklist" style="margin-top:8px">${d.checks.map(c => `<div class="check ${c.ok ? 'ok' : ''}"><span class="mark">${c.ok ? '✓' : '✗'}</span><div><b>${esc(c.label)}</b><div class="why">${esc(c.why)}</div></div></div>`).join('')}</div>
    </div>
    ${s ? `<div class="stat-grid">
      ${tile('Net P&L', fmt$s(s.net), cls(s.net))}${tile('Return', fmtPct(s.netPct), cls(s.net))}${tile('Trades', s.n)}
      ${tile('Win rate', s.n ? s.winRate.toFixed(0) + '%' : '—')}${tile('Avg R', fmtR(s.avgR), cls(s.avgR || 0))}${tile('Max drawdown', s.maxDD.toFixed(2) + '%', s.maxDD > 5 ? 'down' : '')}
    </div>
    <div class="card"><span class="label">Equity curve</span><canvas class="eq-canvas" id="eq-canvas"></canvas></div>
    ${s.n ? `<div class="card"><span class="label">Your trades</span><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Side</th><th class="num">Qty</th><th class="num">Entry</th><th class="num">Exit</th><th class="num">P&amp;L</th><th class="num">R</th><th>Exit</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>` : ''}` : ''}
    <div class="card takeaway"><span class="label">Takeaway</span><div>${esc(d.takeaway)}</div></div>
    ${roundAch.length ? `<div class="badge-unlock">${roundAch.map(a => `<div class="badge got"><span class="medal">${esc(a.g)}</span><div><b>${esc(a.name)}</b><small>${esc(a.d)}</small></div></div>`).join('')}</div>` : ''}
    <div class="debrief-actions">
      ${d.next ? '<button class="btn primary big" id="db-next">Next level</button>' : ''}
      ${d.retry ? `<button class="btn ${d.next ? '' : 'primary'} big" id="db-retry">${esc(d.retryLabel || 'Try again')}</button>` : ''}
      <button class="btn ghost big" data-go="map">Back to map</button>
    </div>`;
  $('.debrief-head .label').textContent = R && R.mode === 'level' ? `Level ${R.cfg.id} · ${R.cfg.title}` : R && R.kind === 'quiz' ? `Level ${R.level.id} · ${R.level.title}` : '';
  if (d.next) $('#db-next').addEventListener('click', d.next);
  if (d.retry) $('#db-retry').addEventListener('click', d.retry);
  bindGo($('#debrief'));
  if (s) drawEquity(s);
  if (d.stars >= 2) { setTimeout(() => { Snd.play('star'); Confetti.burst(d.stars === 3 ? 200 : 120); }, 400); }
  else Snd.play('loss');
  R && (R.lastStats = s);
}
const tile = (k, v, c = '') => `<div class="stat-tile"><span class="label">${k}</span><div class="v ${c}">${v}</div></div>`;
function flagsHtml(t) {
  const f = [];
  if (!t.hadStop) f.push('<span class="flag bad">no stop</span>');
  if (t.hadStop && t.riskPct > RISK_OK) f.push(`<span class="flag bad">${t.riskPct.toFixed(1)}% risk</span>`);
  if (t.revenge) f.push('<span class="flag bad">revenge</span>');
  if (t.fomo) f.push('<span class="flag bad">FOMO</span>');
  if (t.widened) f.push('<span class="flag bad">widened stop</span>');
  if (t.limitEntry) f.push('<span class="flag">limit</span>');
  if (t.withCross) f.push('<span class="flag">MA cross</span>');
  if (t.plannedRR >= 1.95) f.push(`<span class="flag">1:${t.plannedRR.toFixed(1)}</span>`);
  return f.join('') || '<span class="flag">clean</span>';
}
function drawEquity(s) {
  const cv = $('#eq-canvas'); if (!cv) return;
  const { ctx, w, h } = setupCanvas(cv);
  const v = R.eqCurve.concat([R.equity]);
  let lo = Math.min(...v, START_CASH), hi = Math.max(...v, START_CASH); const pad = (hi - lo) * .1 || 50; lo -= pad; hi += pad;
  const x = i => 8 + i / Math.max(1, v.length - 1) * (w - 70), y = p => 8 + (hi - p) / (hi - lo) * (h - 16);
  ctx.fillStyle = T.panel; ctx.fillRect(0, 0, w, h);
  ctx.setLineDash([3, 3]); ctx.strokeStyle = T.muted; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(8, y(START_CASH)); ctx.lineTo(w - 62, y(START_CASH)); ctx.stroke(); ctx.setLineDash([]);
  label(ctx, '$10k start', w - 58, y(START_CASH), T.muted, 'left', 10, 600, T.mono);
  const col = R.equity >= START_CASH ? T.up : T.down;
  ctx.beginPath(); v.forEach((p, i) => i ? ctx.lineTo(x(i), y(p)) : ctx.moveTo(x(i), y(p)));
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(x(v.length - 1), h); ctx.lineTo(x(0), h); ctx.closePath(); ctx.fillStyle = col; ctx.globalAlpha = .1; ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x(v.length - 1), y(R.equity), 4, 0, Math.PI * 2); ctx.fill();
  label(ctx, fmt$(R.equity), x(v.length - 1), y(R.equity) + (y(R.equity) > h / 2 ? -14 : 14), col, 'right', 11, 700, T.mono);
}

/* =========================================================================
   Profile & journal
   ========================================================================= */
let resetArmed = 0;
function renderProfile() {
  const j = S.journal, n = j.length;
  const rs = j.filter(t => t.r != null).map(t => t.r);
  const wins = j.filter(t => t.pnl > 0).length;
  const net = j.reduce((a, t) => a + t.pnl, 0);
  const disc = n ? Math.round(j.filter(t => t.hadStop && t.riskPct <= RISK_OK).length / n * 100) : 0;
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  const r = rankOf(S.xp);
  const totalStars = LEVELS.reduce((a, l) => a + ((S.levels[l.id] || {}).stars || 0), 0);
  $('#profile').innerHTML = `
    <div>
      <span class="label">${esc(r.name)} · ${S.xp} XP${r.to ? ` · ${r.to - S.xp} XP to ${esc(r.nextName)}` : ''}</span>
      <h2>Your trading desk</h2>
    </div>
    <div class="stat-grid">
      ${tile('Trades logged', n)}${tile('Win rate', n ? (wins / n * 100).toFixed(0) + '%' : '—')}${tile('Avg R / trade', fmtR(avgR), cls(avgR || 0))}
      ${tile('Net P&L, all rounds', fmt$s(net), cls(net))}${tile('Discipline', n ? disc + '%' : '—', disc >= 80 ? 'up' : n ? 'down' : '')}${tile('Level stars', totalStars + ' / 24')}
    </div>
    <div class="card"><span class="label">What the numbers mean</span>
      <p style="margin:6px 0 0">Avg R per trade is your <b>expectancy</b>. If it is above zero and you keep risk fixed, more trades means more profit. Discipline is the share of trades with a stop and no more than 2% risk. Pros aim for 100%.</p></div>
    <div>
      <span class="label">Badges · ${Object.keys(S.ach).length} of ${ACH.length}</span>
      <div class="badges" style="margin-top:8px">${ACH.map(a => `<div class="badge ${S.ach[a.id] ? 'got' : ''}"><span class="medal">${esc(a.g)}</span><div><b>${esc(a.name)}</b><small>${esc(a.d)}</small></div></div>`).join('')}</div>
    </div>
    <div class="card">
      <span class="label">Trade journal · last ${Math.min(n, 60)} trades</span>
      ${n ? `<div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Round</th><th>Side</th><th class="num">Qty</th><th class="num">Entry</th><th class="num">Exit</th><th class="num">P&amp;L</th><th class="num">R</th><th>Exit</th><th>Notes</th></tr></thead>
        <tbody>${j.slice(0, 60).map(t => `<tr><td>${new Date(t.when).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td>${esc(t.where)}</td>
          <td class="${t.side > 0 ? 'up' : 'down'}">${t.side > 0 ? 'Long' : 'Short'}</td><td class="num">${t.qty}</td><td class="num">${fmtP(t.entry)}</td><td class="num">${fmtP(t.exit)}</td>
          <td class="num ${cls(t.pnl)}">${fmt$s(t.pnl)}</td><td class="num ${cls(t.r || 0)}">${fmtR(t.r)}</td><td>${t.reason}</td><td>${flagsHtml(t)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p style="margin:8px 0 0">No trades yet. Your trades from every round are logged here automatically.</p>'}
    </div>
    <div class="danger-zone"><button class="btn small" id="btn-reset">Reset all progress</button><span class="muted" style="font-size:13px">Clears XP, stars, badges and the journal on this device.</span></div>`;
  $('#btn-reset').addEventListener('click', e => {
    if (Date.now() - resetArmed < 4000) {
      const keep = { sound: S.sound, theme: S.theme };
      S = Object.assign(DEFAULT_STATE(), keep); save(); toast('Progress reset.'); renderProfile(); resetArmed = 0;
    } else { resetArmed = Date.now(); e.target.textContent = 'Click again to erase everything'; e.target.classList.add('sell'); }
  });
}

/* =========================================================================
   Wiring
   ========================================================================= */
function bindGo(root = document) {
  $$('[data-go]', root).forEach(b => { if (b._bound) return; b._bound = true; b.addEventListener('click', () => { Snd.play('click'); show(b.dataset.go); }); });
}
function redrawAll() {
  if (current === 'map') drawConnector();
  if (current === 'lesson') drawLesson();
  if (chart && current === 'play') {
    if (R && R.kind === 'quiz') {
      // re-colour quiz lines and highlights for the new theme
      if (R.chartState) {
        R.chartState.highlights = (R.chartState.highlights || []).map(([i]) => [i, R.answered ? T.up : T.accent]);
        refreshQuizLines();
      }
    }
    chart.render();
  }
  if (current === 'debrief' && R && R.lastStats) drawEquity(R.lastStats);
}

function startLevel(l) { Snd.play('click'); if (l.type === 'quiz') startQuiz(l); else startTrade({ mode: 'level', level: l }); }

function init() {
  load();
  applyTheme();
  updateSoundIcons();
  buildTicker();
  bindGo();
  $$('.theme-toggle').forEach(b => b.addEventListener('click', cycleTheme));
  $$('.sound-toggle').forEach(b => b.addEventListener('click', () => { S.sound = !S.sound; save(); updateSoundIcons(); if (S.sound) Snd.play('click'); toast(S.sound ? 'Sound on' : 'Sound off'); }));
  $('#btn-profile').addEventListener('click', () => { Snd.play('click'); show('profile'); });
  $('#btn-start-level').addEventListener('click', () => lessonLevel && startLevel(lessonLevel));
  $('#btn-daily').addEventListener('click', () => { Snd.play('click'); startTrade({ mode: 'daily' }); });
  $('#btn-endless').addEventListener('click', () => { Snd.play('click'); startTrade({ mode: 'endless' }); });
  $('#btn-overlay-play').addEventListener('click', () => { Snd.play('click'); startPlaying(); });
  $('#btn-playpause').addEventListener('click', togglePlay);
  $$('#speed-seg button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.v)));
  $('#btn-finish').addEventListener('click', () => {
    if (!R || R.kind !== 'trade' || R.ended) return;
    const was = R.playing; R.playing = false; setPlayIcon();
    modal({ title: 'Finish this round now?', html: '<p>Any open position is closed at market and you go to the scorecard.</p>', actions: [
      { label: 'Finish now', cls: 'primary', onClick: () => endTradeRound() },
      { label: 'Keep trading', onClick: () => { R.playing = was; setPlayIcon(); } },
    ] });
  });
  $('#btn-quit').addEventListener('click', () => {
    if (R && R.kind === 'trade' && !R.ended) {
      const was = R.playing; R.playing = false; setPlayIcon();
      modal({ title: 'Leave this round?', html: '<p>The round will not be scored. Trades you already closed stay in your journal.</p>', actions: [
        { label: 'Leave', cls: 'sell', onClick: () => show('map') },
        { label: 'Stay', onClick: () => { R.playing = was; setPlayIcon(); } },
      ] });
    } else show('map');
  });
  document.addEventListener('keydown', e => {
    if (current !== 'play' || !R || R.kind !== 'trade' || R.ended || modalOpen()) return;
    if (e.target.matches('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'Enter' && !e.target.matches('button')) { e.preventDefault(); placeOrder(); }
    else if (e.key === 'x' || e.key === 'X') { if (R.pos) closePosition(R.pos.side > 0 ? bid() : ask(), 'manual'); }
  });
  window.addEventListener('resize', () => { if (current === 'map') drawConnector(); if (current === 'lesson') drawLesson(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); redrawAll(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redrawAll());
  show('map');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
