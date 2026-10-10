(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const START = 100;
const FEE = { futures: 0.0005, dex: 0.003, forex: 0.0001, gold: 0.0001 }; // per sisi, dari notional
const MODES = {
  futures: { name: 'CRYPTO FUTURES', long: false, vol: true, scan: 'Top volume Binance Futures (USDT)' },
  dex: { name: 'DEX MEME', long: true, vol: true, scan: 'Trending DexScreener (boost teratas)' },
  forex: { name: 'FOREX', long: false, vol: false, scan: 'Pair forex (TwelveData)' },
  gold: { name: 'GOLD', long: false, vol: false, scan: 'Emas & perak (TwelveData)' },
};
const TFS = ['1m', '5m', '15m', '1h'];
const FOREX = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'USD/CHF', 'NZD/USD', 'EUR/JPY', 'GBP/JPY', 'USD/IDR'].map((x) => [x, x]);
const GOLD = [['XAU/USD', 'Gold (XAU/USD)'], ['XAG/USD', 'Silver (XAG/USD)']];
const FX_POLL = 20000, FX_LIST = 300000; // hemat kredit TwelveData: 800 kredit/hari per key
const GECKO_NET = { solana: 'solana', ethereum: 'eth', bsc: 'bsc', base: 'base', arbitrum: 'arbitrum', polygon: 'polygon_pos', avalanche: 'avax', optimism: 'optimism' };

/* ---------- util ---------- */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const money = (v, d = 2) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fp(p, mode) {
  if (p == null || !isFinite(p)) return '—';
  mode = mode || S.mode;
  if (mode === 'forex') return p.toFixed(p >= 20 ? 3 : 5);
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 10) return p.toFixed(3);
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(5);
  if (p <= 0) return '0';
  return p.toFixed(Math.min(12, Math.ceil(-Math.log10(p)) + 3));
}
const pct = (v) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');
const kfmt = (v) => (v == null ? '—' : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + v.toFixed(0));
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };

/* ---------- state ---------- */
const S = {
  mode: 'futures', sym: null, tf: '5m', candles: [], price: null, sig: null, gen: 0, list: [], hover: -1,
  ws: null, poll: null, pricePoll: null, riskPoll: null, prevDir: null, dayChg: null, meta: '', loading: false, err: '',
};
const SRC = {}; // nama -> {ms, ok}
const SRC_NAMES = ['Binance Futures', 'DexScreener', 'GeckoTerminal', 'Forex/Gold API', 'Risk API', 'Groq AI'];

/* ---------- network ---------- */
async function jget(url, name, opt) {
  const t = performance.now();
  try {
    const r = await fetch(url, opt);
    if (!r.ok) throw new Error(name + ' HTTP ' + r.status);
    const j = await r.json();
    SRC[name] = { ms: Math.round(performance.now() - t), ok: true };
    renderSrc();
    return j;
  } catch (e) {
    SRC[name] = { ms: null, ok: false };
    renderSrc();
    throw e;
  }
}
function renderSrc() {
  setTimeout(setSrcOk, 0);
  $('src').innerHTML = SRC_NAMES.map((n) => {
    const s = SRC[n];
    const v = !s ? '<b style="color:var(--muted)">—</b>' : s.ok ? '<b class="up">' + s.ms + 'ms</b>' : '<b class="dn">ERROR</b>';
    return '<div class="kv"><span>' + n + '</span>' + v + '</div>';
  }).join('');
}
function setSrcOk() {
  const v = Object.values(SRC); const bad = v.filter((x) => !x.ok).length;
  const el = $('srcok'); el.textContent = !v.length ? '—' : bad ? 'ERROR ' + bad : 'ALL GREEN';
  el.style.color = bad ? 'var(--red)' : 'var(--green)';
}
function setConn(text, ok) {
  $('connt').textContent = text;
  $('conn').className = 'pill' + (ok ? '' : ' err');
}

/* ---------- indikator ---------- */
function ema(vals, n) {
  const k = 2 / (n + 1), out = [];
  let e = vals[0];
  for (let i = 0; i < vals.length; i++) { e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k); out.push(e); }
  return out;
}
function rsi(cl, n = 14) {
  if (cl.length <= n) return cl.map(() => null);
  const out = new Array(cl.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = cl[i] - cl[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function atr(cs, n = 14) {
  const tr = cs.map((c, i) => (i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c))));
  const out = [];
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = 0; i < tr.length; i++) { if (i < n) out.push(null); else { a = (a * (n - 1) + tr[i]) / n; out.push(a); } }
  if (tr.length >= n) out[n - 1] = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  return out;
}

/* Skor sinyal dari candle yang sudah close. Skor -4.5..+4.5, entry kalau |skor| >= 1.8 */
function analyze(cs, mode) {
  if (cs.length < 60) return null;
  const cl = cs.map((c) => c.c), n = cl.length - 1, last = cs[n];
  const e20 = ema(cl, 20), e50 = ema(cl, 50), r = rsi(cl, 14), a = atr(cs, 14);
  const R = r[n], A = a[n];
  if (R == null || A == null || !(A > 0)) return null;
  let s = 0; const why = [];
  const trendUp = e20[n] > e50[n];
  s += trendUp ? 1 : -1; why.push(trendUp ? 'EMA20 di atas EMA50' : 'EMA20 di bawah EMA50');
  s += last.c > e20[n] ? 0.5 : -0.5;
  s += last.c > e50[n] ? 0.5 : -0.5;
  if (R >= 75) { s -= 0.5; why.push('RSI overbought'); }
  else if (R > 55) { s += 0.5; why.push('RSI bullish'); }
  else if (R <= 25) { s += 0.5; why.push('RSI oversold'); }
  else if (R < 45) { s -= 0.5; why.push('RSI bearish'); }
  const roc = last.c / cl[n - 10] - 1;
  const z = clamp(roc / ((A / last.c) * 3), -1, 1);
  s += z;
  const prev = cs.slice(n - 20, n);
  const hh = Math.max(...prev.map((c) => c.h)), ll = Math.min(...prev.map((c) => c.l));
  let brk = 'tidak ada';
  if (last.c > hh) { s += 1; brk = 'break high 20c'; why.push('breakout high 20 candle'); }
  else if (last.c < ll) { s -= 1; brk = 'break low 20c'; why.push('breakdown low 20 candle'); }
  let volRatio = null;
  if (MODES[mode].vol) {
    const vs = cs.slice(n - 20, n).map((c) => c.v), avg = vs.reduce((x, y) => x + y, 0) / vs.length;
    if (avg > 0) {
      volRatio = last.v / avg;
      if (volRatio > 1.5) { s *= 1.2; why.push('volume ' + volRatio.toFixed(1) + 'x rata-rata'); }
      else if (volRatio < 0.6) s *= 0.8;
    }
  }
  let dir = Math.abs(s) >= 1.8 ? Math.sign(s) : 0;
  if (MODES[mode].long && dir < 0) dir = 0;
  const conf = Math.min(99, Math.round((Math.abs(s) / 4) * 100));
  return { dir, conf, score: s, rsi: R, ema20: e20[n], ema50: e50[n], atr: A, atrPct: (A / last.c) * 100, volRatio, brk, why, trendUp, closeT: last.t };
}
function levels(sig, entry, dir) {
  const d = dir || 1;
  return { sl: entry - d * 1.5 * sig.atr, tp1: entry + d * 2.25 * sig.atr, tp2: entry + d * 4.5 * sig.atr };
}

/* skor DEX 0-100 dari statistik DexScreener (tidak ada data wallet/LP) */
function dexScore(p) {
  const liq = p.liquidity && p.liquidity.usd || 0, v1 = p.volume && p.volume.h1 || 0;
  const tx = p.txns && p.txns.h1 || { buys: 0, sells: 0 };
  const ch1 = p.priceChange && p.priceChange.h1 || 0;
  const ageH = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 36e5 : null;
  let s = 0; const flags = [];
  s += liq >= 100e3 ? 25 : liq >= 50e3 ? 20 : liq >= 20e3 ? 12 : liq >= 5e3 ? 5 : 0;
  const vr = liq > 0 ? v1 / liq : 0;
  s += vr >= 0.2 && vr <= 3 ? 20 : vr > 3 ? 10 : vr > 0.05 ? 8 : 0;
  const tot = tx.buys + tx.sells, bp = tot ? tx.buys / tot : 0.5;
  s += Math.round(bp * 20);
  s += ch1 > 0 && ch1 <= 80 ? 15 : ch1 > 80 && ch1 <= 150 ? 8 : ch1 > 150 ? 3 : 0;
  s += ageH == null ? 0 : ageH > 6 ? 10 : ageH > 1 ? 6 : 2;
  s += tot >= 200 ? 10 : tot >= 50 ? 6 : tot >= 10 ? 2 : 0;
  if (liq < 20e3) flags.push('LIKUIDITAS TIPIS');
  if (ageH != null && ageH < 1) flags.push('PAIR <1 JAM');
  if (tot > 10 && bp < 0.44) flags.push('TEKANAN JUAL');
  if (ch1 > 150) flags.push('SUDAH PUMP >150%');
  return { score: clamp(Math.round(s), 0, 100), flags, ageH, liq, v1, tx, ch1 };
}
function dexSym(p) {
  const d = dexScore(p);
  return {
    id: p.pairAddress, chain: p.chainId, name: p.baseToken.symbol, quote: p.quoteToken.symbol, dex: p.dexId, token: p.baseToken.address,
    price: parseFloat(p.priceUsd), fdv: p.fdv, mc: p.marketCap, url: p.url, d, ch5: p.priceChange && p.priceChange.m5, ch24: p.priceChange && p.priceChange.h24,
  };
}

/* ---------- paper trading ---------- */
const P = load('grokbot_paper_v1', { bal: START, trades: [], pos: [], hist: [START] });
let logN = 0; const logs = [];
function addLog(k, txt, c) {
  logN++; logs.unshift('<li><b class="' + (c || '') + '">' + k + '</b><span>' + esc(txt) + '</span></li>');
  if (logs.length > 9) logs.pop();
  $('logs').innerHTML = logs.join(''); $('evn').textContent = logN;
}
let popT = 0;
function pop(label, v, sub) {
  const el = $('pop'); el.classList.toggle('loss', v < 0); el.classList.add('on');
  $('popl').textContent = label; $('popv').textContent = (v >= 0 ? '+' : '') + money(v); $('popv').style.color = v >= 0 ? 'var(--green)' : 'var(--red)'; $('pops').textContent = sub;
  clearTimeout(popT); popT = setTimeout(() => el.classList.remove('on'), 2200);
}
const keyOf = (mode, sym) => mode + ':' + sym.id;
function realize(pos, frac, exit, why) {
  const notional = pos.size * frac;
  const gross = notional * pos.dir * ((exit - pos.entry) / pos.entry);
  const fee = notional * FEE[pos.mode] * 2;
  const pnl = gross - fee;
  P.bal += pnl; pos.pnl += pnl; pos.left -= frac;
  P.hist.push(P.bal); if (P.hist.length > 400) P.hist.shift();
  return pnl;
}
function closeFull(pos, why) {
  P.pos = P.pos.filter((x) => x !== pos);
  P.trades.push({ name: pos.name, dir: pos.dir, pnl: pos.pnl, t: Date.now(), held: Date.now() - pos.t, why });
  if (P.trades.length > 200) P.trades.shift();
}
function manage(pos, p) {
  if (!(p > 0)) return;
  pos.last = p;
  const d = pos.dir;
  const hit = (lvl, above) => (above ? p >= lvl : p <= lvl);
  if (hit(pos.sl, d < 0)) {
    const pnl = realize(pos, pos.left, pos.sl);
    addLog(pos.tp1hit ? 'BE' : 'SL', pos.name + ' ditutup di ' + fp(pos.sl, pos.mode) + ' (' + money(pos.pnl) + ')', 'r');
    pop(pos.tp1hit ? 'BREAKEVEN' : 'STOP LOSS', pos.pnl, pos.name);
    closeFull(pos, 'sl'); save('grokbot_paper_v1', P); return;
  }
  if (!pos.tp1hit && hit(pos.tp1, d > 0)) {
    const pnl = realize(pos, 0.5, pos.tp1); pos.tp1hit = true; pos.sl = pos.entry;
    addLog('TP1', pos.name + ' 50% ditutup di ' + fp(pos.tp1, pos.mode) + ' (' + money(pnl) + '), SL ke entry');
    pop('TP1', pnl, pos.name + ' · 50% ditutup');
  }
  if (pos.tp1hit && hit(pos.tp2, d > 0)) {
    realize(pos, pos.left, pos.tp2);
    addLog('TP2', pos.name + ' selesai di ' + fp(pos.tp2, pos.mode) + ' (total ' + money(pos.pnl) + ')');
    pop('TP2', pos.pnl, pos.name + ' · selesai');
    closeFull(pos, 'tp2');
  }
  save('grokbot_paper_v1', P);
}
function maybeOpen(sig) {
  if (!autoOn || !sig || !sig.dir || sig.conf < 60) return;
  const key = keyOf(S.mode, S.sym);
  if (P.pos.some((x) => x.key === key) || P.pos.length >= 5) return;
  if (S.mode === 'dex') { const d = S.sym.d; if (!d || d.score < 50 || d.liq < 10000) { addLog('SKIP', S.sym.name + ': skor DEX/likuiditas belum lolos', 'a'); return; }
    const rk = S.sym.risk; if (rk && rk.hard && rk.hard.length) { addLog('SKIP', S.sym.name + ': ' + rk.hard.join(', '), 'a'); return; } }
  const entry = S.price; if (!(entry > 0)) return;
  const lv = levels(sig, entry, sig.dir);
  const size = Math.max(1, P.bal * 0.3);
  const pos = { key, mode: S.mode, name: S.sym.name, dir: sig.dir, entry, sl: lv.sl, tp1: lv.tp1, tp2: lv.tp2, size, left: 1, pnl: 0, tp1hit: false, t: Date.now(), last: entry };
  P.pos.push(pos); save('grokbot_paper_v1', P);
  addLog(sig.dir > 0 ? 'BUY' : 'SELL', S.sym.name + ' ' + money(size) + ' @ ' + fp(entry) + ' · skor ' + sig.conf);
}
let autoOn = load('grokbot_auto', true);

/* ---------- data: candle ---------- */
const lastT = () => (S.candles.length ? S.candles[S.candles.length - 1].t : 0);
function setCandles(arr, gen) {
  if (gen !== S.gen || !arr.length) return;
  const prevT = lastT();
  S.candles = arr;
  const isNew = prevT && lastT() > prevT;
  S.price = arr[arr.length - 1].c;
  if (!prevT) evaluate(false); else if (isNew) evaluate(true);
  tickPositions();
}
function applyLive(c, gen) {
  if (gen !== S.gen || !S.candles.length) return;
  const cs = S.candles, l = cs[cs.length - 1];
  if (c.t === l.t) cs[cs.length - 1] = c;
  else if (c.t > l.t) { cs.push(c); if (cs.length > 400) cs.shift(); evaluate(true); }
  S.price = c.c; tickPositions();
}
function applyPrice(p, gen) {
  if (gen !== S.gen || !(p > 0) || !S.candles.length) return;
  const l = S.candles[S.candles.length - 1];
  l.c = p; l.h = Math.max(l.h, p); l.l = Math.min(l.l, p);
  S.price = p; tickPositions();
}
function tickPositions() {
  const key = keyOf(S.mode, S.sym || { id: '' });
  P.pos.filter((x) => x.key === key).forEach((x) => manage(x, S.price));
}
function evaluate(allowEntry) {
  const closed = S.candles.slice(0, -1);
  const sig = analyze(closed, S.mode);
  S.sig = sig;
  if (sig && S.prevDir !== sig.dir) {
    if (S.prevDir !== null) addLog('SINYAL', S.sym.name + ' ' + S.tf + ': ' + (sig.dir > 0 ? 'BUY' : sig.dir < 0 ? 'SELL' : 'WAIT') + ' (skor ' + sig.conf + ')', 'w');
    S.prevDir = sig.dir;
  }
  if (allowEntry) maybeOpen(sig);
}

async function fetchCandles(sym, tf) {
  if (S.mode === 'futures') {
    const j = await jget('https://fapi.binance.com/fapi/v1/klines?symbol=' + sym.id + '&interval=' + tf + '&limit=300', 'Binance Futures');
    return j.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  }
  if (S.mode === 'dex') {
    const net = GECKO_NET[sym.chain] || sym.chain;
    const agg = { '1m': ['minute', 1], '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1] }[tf];
    const j = await jget('https://api.geckoterminal.com/api/v2/networks/' + net + '/pools/' + sym.id + '/ohlcv/' + agg[0] + '?aggregate=' + agg[1] + '&limit=300&currency=usd', 'GeckoTerminal', { headers: { Accept: 'application/json;version=20230302' } });
    const list = (j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
    return list.map((k) => ({ t: k[0] * 1000, o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).sort((a, b) => a.t - b.t);
  }
  const j = await jget('/api/market?symbol=' + encodeURIComponent(sym.id) + '&tf=' + tf, 'Forex/Gold API');
  S.dayChg = j.prevClose ? ((j.price - j.prevClose) / j.prevClose) * 100 : null;
  S.provider = j.provider;
  return j.candles;
}

async function loadRisk(sym, gen) {
  if (S.mode !== 'dex' || !sym.token) return;
  try {
    const r = await jget('/api/risk?chain=' + encodeURIComponent(sym.chain) + '&mint=' + encodeURIComponent(sym.token), 'Risk API');
    if (gen !== S.gen) return;
    const first = !sym.risk; sym.risk = r;
    if (first && r.supported !== false) addLog('RISK', sym.name + ': ' + (r.hard.length ? r.hard.join(' · ') : 'tidak ada flag berat') + (r.smart ? ' · smart ' + r.smart.count : ''), r.hard.length ? 'r' : 'w');
  } catch (e) { if (gen === S.gen) sym.risk = { error: e.message }; }
  renderDec(); renderCode();
}
function stopLive() {
  if (S.ws) { S.ws.onclose = S.ws.onerror = S.ws.onmessage = null; try { S.ws.close(); } catch (e) {} S.ws = null; }
  clearInterval(S.poll); clearInterval(S.pricePoll); clearInterval(S.riskPoll); S.poll = S.pricePoll = S.riskPoll = null;
}
function startPoll(ms, gen) {
  clearInterval(S.poll);
  S.poll = setInterval(async () => {
    if (gen !== S.gen || document.hidden) return;
    try { const c = await fetchCandles(S.sym, S.tf); setCandles(c, gen); setConn('LIVE · POLL', true); } catch (e) { setConn('GAGAL AMBIL DATA', false); }
  }, ms);
}
function startLive(gen) {
  stopLive();
  const sym = S.sym;
  if (S.mode === 'futures') {
    try {
      const ws = new WebSocket('wss://fstream.binance.com/ws/' + sym.id.toLowerCase() + '@kline_' + S.tf);
      S.ws = ws;
      ws.onopen = () => { if (gen === S.gen) setConn('LIVE · WS', true); };
      ws.onmessage = (ev) => { if (gen !== S.gen) return; const k = JSON.parse(ev.data).k; if (k) applyLive({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }, gen); };
      const fb = () => { if (gen === S.gen && !S.poll) { setConn('LIVE · POLL', true); startPoll(2500, gen); } };
      ws.onerror = fb; ws.onclose = fb;
    } catch (e) { startPoll(2500, gen); }
  } else if (S.mode === 'dex') {
    setConn('LIVE · POLL', true);
    startPoll(15000, gen);
    loadRisk(sym, gen); S.riskPoll = setInterval(() => { if (gen === S.gen && !document.hidden) loadRisk(sym, gen); }, 60000);
    S.pricePoll = setInterval(async () => {
      if (gen !== S.gen || document.hidden) return;
      try {
        const j = await jget('https://api.dexscreener.com/latest/dex/pairs/' + sym.chain + '/' + sym.id, 'DexScreener');
        const p = j.pairs && j.pairs[0];
        if (p) { applyPrice(parseFloat(p.priceUsd), gen); Object.assign(sym, dexSym(p)); sym.price = parseFloat(p.priceUsd); renderDec(); renderHead(); }
      } catch (e) {}
    }, 4000);
  } else {
    setConn('LIVE · POLL', true);
    startPoll(FX_POLL, gen);
  }
}

async function select(sym) {
  stopLive();
  const gen = ++S.gen;
  S.sym = sym; S.candles = []; S.sig = null; S.prevDir = null; S.price = null; S.dayChg = null; S.provider = ''; S.err = ''; S.loading = true;
  save('grokbot_sel', { mode: S.mode, tf: S.tf, sym: S.mode === 'dex' ? null : sym });
  renderAll();
  try {
    const c = await fetchCandles(sym, S.tf);
    if (gen !== S.gen) return;
    S.loading = false;
    if (c.length < 60) { S.err = 'Candle belum cukup (' + c.length + '). Token/pair ini terlalu baru atau sepi transaksi. Coba timeframe lebih kecil atau token lain.'; }
    setCandles(c, gen);
    setConn('LIVE', true);
    startLive(gen);
  } catch (e) {
    if (gen !== S.gen) return;
    S.loading = false; S.err = 'Gagal ambil data: ' + e.message; setConn('ERROR', false);
    startLive(gen);
  }
  renderAll();
}

/* ---------- scanner / daftar simbol ---------- */
let listTimer = null;
async function loadList() {
  clearInterval(listTimer);
  const mode = S.mode;
  const run = async () => {
    try {
      let list = [];
      if (mode === 'futures') {
        const j = await jget('https://fapi.binance.com/fapi/v1/ticker/24hr', 'Binance Futures');
        list = j.filter((x) => x.symbol.endsWith('USDT') && !/_/.test(x.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 16)
          .map((x) => ({ id: x.symbol, name: x.symbol, price: +x.lastPrice, ch: +x.priceChangePercent, sub: kfmt(+x.quoteVolume) + ' vol 24j' }));
      } else if (mode === 'dex') {
        list = await dexTrending();
      } else {
        const defs = mode === 'forex' ? FOREX : GOLD;
        list = defs.map((d) => ({ id: d[0], name: d[1], price: null, ch: null, sub: d[0] }));
        if (S.list.length && S.mode === mode) list = list.map((x) => Object.assign(x, (S.list.find((y) => y.id === x.id) || {})));
        S.list = list; if (mode === S.mode) renderList();
        const j = await jget('/api/market?symbols=' + defs.map((d) => encodeURIComponent(d[0])).join(','), 'Forex/Gold API');
        list = defs.map((d) => { const q = (j.quotes || []).find((x) => x.symbol === d[0]) || {}; return { id: d[0], name: d[1], price: q.price, ch: q.changePct, sub: d[0] }; });
      }
      if (mode !== S.mode) return;
      S.list = list; renderList(); renderTick();
      if (!S.sym && list.length) select(list[0]);
    } catch (e) {
      if (mode === S.mode && !S.list.length) $('list').innerHTML = '<div class="empty">Gagal memuat daftar: ' + esc(e.message) + '</div>';
    }
  };
  await run();
  listTimer = setInterval(() => { if (!document.hidden) run(); }, mode === 'dex' ? 45000 : mode === 'futures' ? 20000 : FX_LIST);
}
async function dexTrending() {
  const boosts = await jget('https://api.dexscreener.com/token-boosts/top/v1', 'DexScreener');
  const seen = new Set(), byChain = {};
  for (const b of boosts) { const k = b.chainId + b.tokenAddress; if (seen.has(k)) continue; seen.add(k); (byChain[b.chainId] = byChain[b.chainId] || []).push(b.tokenAddress); }
  const jobs = Object.entries(byChain).slice(0, 5).map(([chain, addrs]) => jget('https://api.dexscreener.com/tokens/v1/' + chain + '/' + addrs.slice(0, 30).join(','), 'DexScreener').catch(() => []));
  const pairs = (await Promise.all(jobs)).flat();
  return bestPairs(pairs);
}
function bestPairs(pairs) {
  const best = {};
  for (const p of pairs) {
    if (!p || !p.baseToken || !p.priceUsd) continue;
    const k = p.chainId + p.baseToken.address, liq = (p.liquidity && p.liquidity.usd) || 0;
    if (!best[k] || liq > ((best[k].liquidity && best[k].liquidity.usd) || 0)) best[k] = p;
  }
  return Object.values(best).filter((p) => ((p.liquidity && p.liquidity.usd) || 0) >= 3000).map(dexSym).sort((a, b) => b.d.score - a.d.score).slice(0, 18)
    .map((s) => Object.assign(s, { ch: s.d.ch1, sub: s.chain + ' · ' + kfmt(s.d.liq) + ' liq' }));
}
async function dexSearch(q) {
  $('list').innerHTML = '<div class="empty">Mencari…</div>';
  try {
    const j = await jget('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(q), 'DexScreener');
    const list = bestPairs(j.pairs || []);
    S.list = list; renderList();
    if (!list.length) $('list').innerHTML = '<div class="empty">Tidak ada hasil.</div>';
  } catch (e) { $('list').innerHTML = '<div class="empty">Gagal mencari: ' + esc(e.message) + '</div>'; }
}

/* ---------- render ---------- */
function renderList() {
  const cur = S.sym && S.sym.id;
  if (!S.list.length) { $('list').innerHTML = '<div class="empty">Memuat…</div>'; return; }
  $('list').innerHTML = S.list.map((x, i) => {
    const sc = x.d ? '<span class="sc ' + (x.d.score >= 60 ? '' : x.d.score >= 40 ? 'mid' : 'low') + '">' + x.d.score + '</span>' : '';
    return '<button type="button" class="row' + (x.id === cur ? ' on' : '') + '" data-i="' + i + '"><span class="n">' + esc(x.name) + '<small>' + esc(x.sub || '') + '</small></span>'
      + '<span style="text-align:right">' + (x.price != null ? fp(x.price) : '—') + '<small class="' + (x.ch >= 0 ? 'up' : 'dn') + '">' + pct(x.ch) + '</small></span>' + (sc || '<span></span>') + '</button>';
  }).join('');
}
function renderHead() {
  const s = S.sym;
  if (!s) { $('pair').textContent = '—'; return; }
  $('pair').innerHTML = esc(s.name) + ' <span>/ ' + (S.mode === 'dex' ? esc(s.quote || '') + ' · ' + esc(s.chain) : S.mode === 'futures' ? 'PERP' : S.mode === 'gold' ? 'SPOT' : 'FX') + ' · ' + S.tf + '</span>';
  let sub = MODES[S.mode].name + (S.provider ? ' · data ' + (S.provider === 'twelvedata' ? 'TwelveData' : 'Yahoo (cadangan)') : '');
  if (S.mode === 'dex') sub = esc(s.dex) + ' · liq ' + kfmt(s.d && s.d.liq) + ' · FDV ' + kfmt(s.fdv) + (s.d && s.d.ageH != null ? ' · umur ' + (s.d.ageH < 48 ? s.d.ageH.toFixed(1) + 'j' : (s.d.ageH / 24).toFixed(0) + 'h') : '') + (s.url ? ' · <a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">DexScreener ↗</a>' : '');
  $('psub').innerHTML = sub;
  const p = S.price;
  $('price').textContent = fp(p);
  let ch = null;
  if (S.mode === 'futures') ch = (S.list.find((x) => x.id === s.id) || {}).ch; else if (S.mode === 'dex') ch = s.d && s.d.ch1; else ch = S.dayChg;
  const lbl = S.mode === 'dex' ? '1j ' : '24j ';
  $('chg').innerHTML = '<span class="' + (ch >= 0 ? 'up' : 'dn') + '">' + lbl + pct(ch) + '</span>';
  $('price').classList.toggle('dn', ch < 0);
}
function renderDec() {
  const sg = S.sig, p = S.price;
  const set = (id, v) => { $(id).textContent = v; };
  $('dexrows').style.display = S.mode === 'dex' ? '' : 'none';
  if (S.mode === 'dex' && S.sym) {
    const rk = S.sym.risk;
    if (!S.sym.token || (S.sym.chain !== 'solana')) { ['d8', 'd9', 'd10', 'd11'].forEach((i) => set(i, 'n/a (non-Solana)')); }
    else if (!rk) { ['d8', 'd9', 'd10', 'd11'].forEach((i) => set(i, 'memuat…')); }
    else if (rk.error) { ['d8', 'd9', 'd10', 'd11'].forEach((i) => set(i, 'gagal')); }
    else {
      const ok = (v) => (v == null ? '?' : v ? 'ya' : 'TIDAK');
      set('d8', (rk.lp.lockedPct != null ? rk.lp.lockedPct.toFixed(0) + '% lock' : '?') + (rk.lp.burnStatus ? ' · ' + rk.lp.burnStatus : ''));
      set('d9', ok(rk.authority.mintRenounced) + ' / ' + ok(rk.authority.freezeRenounced));
      set('d10', (rk.holders.top10Pct != null ? rk.holders.top10Pct.toFixed(0) + '%' : '?') + ' / ' + (rk.holders.insiderPct != null ? rk.holders.insiderPct.toFixed(0) + '%' : '?'));
      set('d11', rk.smart ? rk.smart.count + ' holding' : '?');
    }
  }
  if (!S.sym) { set('dh', 'MENUNGGU'); $('dh').className = 'wait'; set('dc', ''); ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].forEach((i) => set(i, '—')); return; }
  $('d7r').style.display = S.mode === 'dex' ? '' : 'none';
  if (S.mode === 'dex' && S.sym && S.sym.d) set('d7', S.sym.d.score + '/100' + (S.sym.d.flags.length ? ' ⚠' : ''));
  if (!sg || !p) { set('dh', S.loading ? 'MEMUAT' : 'MENUNGGU'); $('dh').className = 'wait'; set('dc', ''); ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].forEach((i) => set(i, '—')); return; }
  const lv = levels(sg, p, sg.dir || 1);
  const t = sg.dir > 0 ? 'BUY' : sg.dir < 0 ? 'SELL' : 'WAIT';
  set('dh', t); $('dh').className = sg.dir > 0 ? 'buy' : sg.dir < 0 ? 'sell' : 'wait'; set('dc', 'skor ' + sg.conf);
  set('d1', fp(p));
  set('d2', sg.dir ? fp(lv.sl) : '—'); set('d3', sg.dir ? fp(lv.tp1) : '—'); set('d4', sg.dir ? fp(lv.tp2) : '—');
  set('d5', sg.rsi.toFixed(1)); set('d6', sg.trendUp ? 'BULL' : 'BEAR');
}
let codeShown = 0, codeHead = '', codeFull = '';
function setCode(t) { const head = t.split('\n')[0]; if (head !== codeHead) { codeHead = head; codeShown = 0; } codeFull = t; }
let tf_ = 0;
function typeStep() {
  if (++tf_ % 2) return;
  if (codeShown < codeFull.length) codeShown = Math.min(codeFull.length, codeShown + 4);
  const v = codeFull.slice(0, codeShown); const el = $('code'); if (el.textContent !== v) el.textContent = v;
}
function renderCode() {
  const sg = S.sig, s = S.sym;
  if (!sg || !s) { setCode(S.err || '# menunggu data candle…'); return; }
  const L = [
    '# signal engine · ' + s.name + ' ' + S.tf,
    'candle  = ' + (S.candles.length - 1) + ' close',
    'ema20   = ' + fp(sg.ema20) + '   ema50 = ' + fp(sg.ema50),
    'trend   = ' + (sg.trendUp ? 'BULL' : 'BEAR'),
    'rsi14   = ' + sg.rsi.toFixed(1),
    'atr14   = ' + fp(sg.atr) + ' (' + sg.atrPct.toFixed(2) + '%)',
    'volume  = ' + (sg.volRatio == null ? 'n/a' : sg.volRatio.toFixed(2) + 'x avg20'),
    'breakout= ' + sg.brk,
    'skor    = ' + (sg.score >= 0 ? '+' : '') + sg.score.toFixed(1) + ' → ' + (sg.dir > 0 ? 'BUY' : sg.dir < 0 ? 'SELL' : 'WAIT') + ' (' + sg.conf + ')',
    'auto    = entry jika skor ≥ 60, SL 1.5 ATR',
  ];
  if (s.d) L.push('dex     = ' + s.d.score + '/100 ' + (s.d.flags.join(', ') || 'tanpa flag'));
  if (S.mode === 'dex') {
    const rk = s.risk;
    if (!rk) L.push('risk    = memuat…');
    else if (rk.error) L.push('risk    = gagal: ' + rk.error);
    else if (rk.supported === false) L.push('risk    = ' + rk.reason);
    else { L.push('risk    = ' + (rk.hard.length ? 'BAHAYA: ' + rk.hard.join(', ') : 'tanpa flag berat') + (rk.warn.length ? ' | waspada: ' + rk.warn.join(', ') : '')); const bad = Object.entries(rk.sources).filter(([, v]) => v !== 'ok').map(([k, v]) => k + ': ' + v); if (bad.length) L.push('# sumber gagal → ' + bad.join(' ; ')); }
  }
  setCode(L.join('\n'));
}
function unreal() { return P.pos.reduce((a, x) => a + x.size * x.left * x.dir * ((x.last - x.entry) / x.entry), 0); }
function renderAcc() {
  const u = unreal(), eq = P.bal + u;
  $('bal').textContent = money(eq); $('tbal').textContent = money(eq); $('mult').textContent = 'x' + (eq / START).toFixed(2);
  const tr = P.trades, wins = tr.filter((x) => x.pnl > 0);
  $('s-pnl').textContent = money(P.bal - START); $('s-pnl').className = P.bal - START >= 0 ? 'up' : 'dn';
  $('s-n').textContent = tr.length; $('s-wr').textContent = tr.length ? Math.round((wins.length / tr.length) * 100) + '%' : '—';
  const hd = tr.filter((x) => x.held != null); const ah = hd.length ? hd.reduce((a, x) => a + x.held, 0) / hd.length : null;
  $('s-hold').textContent = ah == null ? '—' : ah < 60000 ? Math.round(ah / 1000) + 's' : Math.round(ah / 60000) + 'm';
  $('s-big').textContent = money(wins.length ? Math.max(...wins.map((x) => x.pnl)) : 0);
  $('pos').innerHTML = P.pos.map((x) => { const r = x.dir * ((x.last - x.entry) / x.entry) * 100; return '<div><span>' + (x.dir > 0 ? 'LONG ' : 'SHORT ') + esc(x.name) + '</span><span class="' + (r >= 0 ? 'up' : 'dn') + '">' + pct(r) + '</span></div>'; }).join('');
  const h = P.hist, mn = Math.min(...h), mx = Math.max(...h), rg = Math.max(1e-9, mx - mn);
  const pts = h.map((v, i) => (i / Math.max(1, h.length - 1) * 200).toFixed(1) + ',' + (31 - ((v - mn) / rg) * 28).toFixed(1)).join(' ');
  $('sparkL').setAttribute('points', pts); $('sparkA').setAttribute('points', '0,34 ' + pts + ' 200,34');
  $('strip').innerHTML = tr.slice(-8).reverse().map((x) => '<span><i>' + esc(x.name) + (x.dir > 0 ? ' L' : ' S') + '</i><b class="' + (x.pnl >= 0 ? 'up' : 'dn') + '">' + money(x.pnl) + '</b></span>').join('') || '<span style="color:var(--muted)">belum ada trade selesai</span>';
}
function renderMsg() {
  const m = $('msg');
  if (S.loading) { m.textContent = 'Memuat candle…'; m.classList.add('on'); }
  else if (S.err) { m.textContent = S.err; m.classList.add('on'); }
  else if (!S.sym) { m.textContent = S.mode === 'dex' ? 'Pilih token di daftar kiri.' : 'Memuat…'; m.classList.add('on'); }
  else m.classList.remove('on');
}
function renderTfs() {
  $('tfs').innerHTML = TFS.map((t) => '<button type="button" class="chip" data-tf="' + t + '" aria-pressed="' + (t === S.tf) + '">' + t + '</button>').join('');
}
function renderAll() { renderHead(); renderDec(); renderCode(); renderAcc(); renderMsg(); renderList(); renderTick(); renderHunter(); }


/* ---------- tampilan ala video: ticker, wallet hunter, orb, ringkasan ---------- */
const short = (a) => (a && a.length > 10 ? a.slice(0, 4) + '…' + a.slice(-4) : a || '—');
const TAGS = { smart_degen: ['SMART', ''], renowned: ['KOL', 'k'], sniper: ['SNIPER', 'd'], bundler: ['BUNDLER', 'd'], rat_trader: ['RAT', 'd'], fresh_wallet: ['FRESH', 'w'], dev: ['DEV', 'w'], bluechip_owner: ['BLUECHIP', 'k'] };
function renderTick() {
  $('tick').innerHTML = S.list.slice(0, 10).map((x) => '<span>' + esc(x.name) + '<b class="' + (x.ch >= 0 ? 'up' : 'dn') + '">' + pct(x.ch) + '</b></span>').join('');
}
function renderHunter() {
  const s = S.sym, rk = s && s.risk, set = (i, a, b) => { $('hl' + i).textContent = a; $('hv' + i).textContent = b; };
  const dexSol = S.mode === 'dex' && s && s.chain === 'solana';
  const lbl = (t, st) => { $('hlbl').innerHTML = t + ' <span class="run">' + st + '</span>'; };
  if (S.mode === 'dex') {
    lbl('On-chain · wallet hunter', rk && !rk.error ? 'SCANNING' : '…');
    $('cmd').textContent = '› wallet_hunt --chain ' + (s ? (s.chain === 'solana' ? 'sol' : s.chain) : '—') + ' --tag smart_degen --token $' + (s ? s.name : '');
    if (!dexSol) { $('wl').innerHTML = '<div class="empty">Cek wallet hanya untuk token Solana.</div>'; set(1, 'LP burn/lock', 'n/a'); set(2, 'mint / freeze', 'n/a'); set(3, 'top10', 'n/a'); return; }
    if (!rk) { $('wl').innerHTML = '<div class="empty">memuat data wallet…</div>'; set(1, 'LP burn/lock', '…'); set(2, 'mint / freeze', '…'); set(3, 'top10', '…'); return; }
    if (rk.error) { $('wl').innerHTML = '<div class="empty">gagal: ' + esc(rk.error) + '</div>'; return; }
    const smp = rk.smart && rk.smart.sample;
    $('wl').innerHTML = smp == null ? '<div class="empty">data GMGN tidak tersedia (cek key / sources)</div>'
      : smp.length ? smp.map((w) => { const t = TAGS[(w.tags && w.tags[0]) || 'smart_degen'] || ['SMART', '']; return '<div class="wr"><span>' + esc(short(w.addr)) + '</span><em class="' + t[1] + '">' + t[0] + '</em><span>' + (w.pnl != null ? 'PNL ' + kfmt(w.pnl) : w.amountUsd != null ? 'HOLD ' + kfmt(w.amountUsd) : 'HOLD') + '</span></div>'; }).join('')
      : '<div class="empty">belum ada smart wallet yang hold</div>';
    set(1, 'LP burn/lock', rk.lp.lockedPct != null ? rk.lp.lockedPct.toFixed(0) + '%' + (rk.lp.burnStatus ? ' · ' + rk.lp.burnStatus : '') : '?');
    set(2, 'smart hold', rk.smart ? rk.smart.count + ' wallet' : '?');
    set(3, 'top10', rk.holders.top10Pct != null ? rk.holders.top10Pct.toFixed(0) + '%' : '?');
    return;
  }
  lbl('Market · scanner', 'LIVE');
  $('cmd').textContent = '› scan --market ' + S.mode + ' --sort move';
  const mv = S.list.filter((x) => x.ch != null).slice().sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch)).slice(0, 5);
  $('wl').innerHTML = mv.length ? mv.map((x) => '<div class="wr"><span>' + esc(x.name) + '</span><em class="' + (x.ch >= 0 ? '' : 'd') + '">' + (x.ch >= 0 ? 'UP' : 'DOWN') + '</em><span class="' + (x.ch >= 0 ? 'up' : 'dn') + '">' + pct(x.ch) + '</span></div>').join('') : '<div class="empty">memuat…</div>';
  const sg = S.sig;
  set(1, 'RSI 14', sg ? sg.rsi.toFixed(1) : '—'); set(2, 'ATR', sg ? sg.atrPct.toFixed(2) + '%' : '—'); set(3, 'volume', sg && sg.volRatio != null ? sg.volRatio.toFixed(2) + 'x' : 'n/a');
}
const orb = $('orb'), ox = orb.getContext('2d'); let OW = 0, OH = 0;
function resizeOrb() { const r = orb.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); orb.width = Math.max(1, r.width * d); orb.height = Math.max(1, r.height * d); ox.setTransform(d, 0, 0, d, 0, 0); OW = r.width; OH = r.height; }
new ResizeObserver(resizeOrb).observe(orb); resizeOrb();
const dots = Array.from({ length: 28 }, () => ({ y: Math.random(), x: Math.random(), sp: 0.002 + Math.random() * 0.004, k: Math.random() }));
function drawOrb() {
  ox.clearRect(0, 0, OW, OH);
  const sg = S.sig, col = sg ? (sg.dir > 0 ? '61,255,138' : sg.dir < 0 ? '255,77,99' : '232,212,77') : '61,255,138';
  const smart = S.sym && S.sym.risk && S.sym.risk.smart ? S.sym.risk.smart.count : 0;
  const n = Math.min(dots.length, 10 + (sg ? Math.round(sg.conf / 8) : 0) + Math.min(6, smart));
  const cX = OW * 0.82, cY = OH / 2;
  for (let i = 0; i < n; i++) {
    const d = dots[i]; d.x += d.sp; if (d.x > 1) { d.x = 0; d.y = Math.random(); }
    const x = 8 + d.x * (cX - 8), y = d.y * OH + (cY - d.y * OH) * d.x * d.x;
    ox.fillStyle = 'rgba(' + (d.k > 0.5 ? col : '232,212,77') + ',' + (0.25 + d.x * 0.6) + ')'; ox.beginPath(); ox.arc(x, y, 1.6, 0, 6.3); ox.fill();
  }
  const g = ox.createRadialGradient(cX, cY, 2, cX, cY, 22); g.addColorStop(0, '#d8ffe8'); g.addColorStop(0.35, 'rgb(' + col + ')'); g.addColorStop(1, 'rgba(' + col + ',0)');
  ox.fillStyle = g; ox.beginPath(); ox.arc(cX, cY, 22, 0, 6.3); ox.fill();
}
function openSummary() {
  const eq = P.bal + unreal(), tr = P.trades, w = tr.filter((x) => x.pnl > 0).length;
  $('sm-eq').textContent = money(eq); $('sm-eq').style.color = eq >= START ? 'var(--green)' : 'var(--red)';
  $('sm-x').textContent = 'x' + (eq / START).toFixed(2); $('sm-n').textContent = tr.length; $('sm-wr').textContent = tr.length ? Math.round((w / tr.length) * 100) + '%' : '—';
  $('sm-p').textContent = (eq - START >= 0 ? '+' : '') + money(eq - START);
  $('done').classList.add('on');
}
const sessionStart = Date.now();

/* ---------- chart ---------- */
const cv = $('chart'), cx = cv.getContext('2d');
let W = 0, H = 0;
function resize() { const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d); cx.setTransform(d, 0, 0, d, 0, 0); W = r.width; H = r.height; }
new ResizeObserver(resize).observe(cv); resize();
const VIS = 110;
function draw() {
  cx.clearRect(0, 0, W, H);
  const all = S.candles; if (all.length < 2) return;
  const cs = all.slice(-VIS), off = all.length - cs.length;
  const padL = 12, padR = 76, top = H * 0.24, bot = H - 24, hasV = MODES[S.mode].vol, vh = hasV ? (bot - top) * 0.15 : 0, pb = bot - vh - (hasV ? 6 : 0);
  let lo = 1e30, hi = -1e30;
  cs.forEach((c) => { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
  const pos = P.pos.find((x) => x.key === keyOf(S.mode, S.sym));
  if (pos) [pos.entry, pos.sl, pos.tp1].forEach((v) => { if (v > lo - (hi - lo) * 0.6 && v < hi + (hi - lo) * 0.6) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  const pad = (hi - lo) * 0.1 || hi * 0.001; lo -= pad; hi += pad;
  const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * (pb - top);
  const slot = (W - padL - padR) / VIS, bw = Math.max(1.5, slot * 0.62), X = (i) => padL + slot * (i + (VIS - cs.length)) + slot / 2;
  cx.font = '9px JetBrains Mono, monospace'; cx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) { const y = top + (pb - top) * g / 4; cx.strokeStyle = '#0f2a1b'; cx.beginPath(); cx.moveTo(padL, y); cx.lineTo(W - padR + 4, y); cx.stroke(); cx.fillStyle = '#3d6a52'; cx.fillText(fp(hi - (hi - lo) * g / 4), W - padR + 8, y + 3); }
  const step = Math.ceil(cs.length / 6), tfm = S.tf === '1h';
  cx.fillStyle = '#3d6a52';
  for (let i = 0; i < cs.length; i += step) { const d = new Date(cs[i].t); cx.fillText(tfm ? d.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + d.getHours() + ':00' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), X(i) - 12, H - 8); }
  let vmax = 0; if (hasV) cs.forEach((c) => { vmax = Math.max(vmax, c.v); });
  cs.forEach((k, i) => {
    const x = X(i), up = k.c >= k.o, col = up ? '#3dff8a' : '#ff4d63';
    if (hasV && vmax > 0) { cx.fillStyle = up ? '#3dff8a44' : '#ff4d6344'; const h = (k.v / vmax) * vh; cx.fillRect(x - bw / 2, bot - h, bw, h); }
    cx.strokeStyle = col; cx.fillStyle = col; cx.beginPath(); cx.moveTo(x, Y(k.h)); cx.lineTo(x, Y(k.l)); cx.stroke();
    const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c)); cx.fillRect(x - bw / 2, y1, bw, Math.max(1.2, y2 - y1));
  });
  const full = all.map((c) => c.c), e20 = ema(full, 20), e50 = ema(full, 50);
  [[e20, '#e8d44d'], [e50, '#7fd0ff']].forEach(([arr, col]) => { cx.strokeStyle = col; cx.lineWidth = 1.2; cx.beginPath(); cs.forEach((_, i) => { const x = X(i), y = Y(arr[off + i]); i ? cx.lineTo(x, y) : cx.moveTo(x, y); }); cx.stroke(); }); cx.lineWidth = 1;
  const hl = (v, col, txt, dash) => { if (v < lo || v > hi) return; const y = Y(v); cx.setLineDash(dash || [4, 3]); cx.strokeStyle = col; cx.beginPath(); cx.moveTo(padL, y); cx.lineTo(W - padR + 4, y); cx.stroke(); cx.setLineDash([]); cx.fillStyle = col; cx.fillText(txt, padL + 4, y - 3); };
  if (pos) { hl(pos.entry, '#d3f2df', (pos.dir > 0 ? 'LONG ' : 'SHORT ') + 'entry'); hl(pos.sl, '#ff4d63', pos.tp1hit ? 'SL (BE)' : 'SL'); if (!pos.tp1hit) hl(pos.tp1, '#3dff8a', 'TP1'); hl(pos.tp2, '#3dff8a', 'TP2'); }
  const lastp = S.price, ly = Y(lastp), up = cs[cs.length - 1].c >= cs[cs.length - 1].o;
  cx.setLineDash([3, 3]); cx.strokeStyle = up ? '#3dff8a99' : '#ff4d6399'; cx.beginPath(); cx.moveTo(padL, ly); cx.lineTo(W - padR + 4, ly); cx.stroke(); cx.setLineDash([]);
  cx.fillStyle = up ? '#3dff8a' : '#ff4d63'; cx.fillRect(W - padR + 4, ly - 8, 70, 16); cx.fillStyle = '#02150a'; cx.font = '700 9px JetBrains Mono, monospace'; cx.fillText(fp(lastp), W - padR + 7, ly + 3);
  if (S.hover >= 0 && S.hover < cs.length) {
    const k = cs[S.hover], x = X(S.hover); cx.strokeStyle = '#3dff8a55'; cx.beginPath(); cx.moveTo(x, top); cx.lineTo(x, bot); cx.stroke();
    cx.fillStyle = '#9ac7ad'; cx.font = '500 9.5px JetBrains Mono, monospace';
    cx.fillText('O ' + fp(k.o) + '  H ' + fp(k.h) + '  L ' + fp(k.l) + '  C ' + fp(k.c) + (hasV ? '  V ' + k.v.toFixed(0) : ''), Math.max(padL, Math.min(x - 100, W - padR - 330)), top - 8);
  }
}
cv.addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(), slot = (r.width - 12 - 76) / VIS, n = Math.min(VIS, S.candles.length); S.hover = Math.floor((e.clientX - r.left - 12) / slot) - (VIS - n); });
cv.addEventListener('mouseleave', () => { S.hover = -1; });

/* ---------- events ---------- */
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) setMode(b.dataset.mode); });
$('tfs').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b || !S.sym) return; S.tf = b.dataset.tf; renderTfs(); select(S.sym); });
$('list').addEventListener('click', (e) => { const b = e.target.closest('.row'); if (!b) return; const s = S.list[+b.dataset.i]; if (s) { select(s); togglePick(false); } });
function togglePick(on) { const pk = $('picker'); on = on == null ? !pk.classList.contains('on') : on; pk.classList.toggle('on', on); $('pickbtn').setAttribute('aria-expanded', on); }
$('pickbtn').addEventListener('click', () => togglePick());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { togglePick(false); $('done').classList.remove('on'); } });
$('sumbtn').addEventListener('click', openSummary);
$('sumclose').addEventListener('click', () => $('done').classList.remove('on'));
$('search').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) dexSearch(e.target.value.trim()); });
$('auto').addEventListener('click', () => { autoOn = !autoOn; save('grokbot_auto', autoOn); $('auto').textContent = 'AUTO: ' + (autoOn ? 'ON' : 'OFF'); $('auto').setAttribute('aria-pressed', autoOn); $('auto').classList.toggle('off', !autoOn); });
$('reset').addEventListener('click', () => { if ($('reset').dataset.arm !== '1') { $('reset').dataset.arm = '1'; $('reset').textContent = 'YAKIN? KLIK LAGI'; setTimeout(() => { $('reset').dataset.arm = ''; $('reset').textContent = 'RESET'; }, 3000); return; } P.bal = START; P.trades = []; P.pos = []; P.hist = [START]; save('grokbot_paper_v1', P); $('reset').dataset.arm = ''; $('reset').textContent = 'RESET'; addLog('RESET', 'akun paper dikembalikan ke $100', 'a'); renderAcc(); });
$('aibtn').addEventListener('click', async () => {
  const sg = S.sig, s = S.sym; if (!sg || !s) { $('aitxt').textContent = 'Data belum siap.'; return; }
  const b = $('aibtn'); b.disabled = true; $('aitxt').className = 'm'; $('aitxt').textContent = 'Grok sedang menganalisis…';
  const lv = levels(sg, S.price, sg.dir || 1);
  const body = { pasar: MODES[S.mode].name, simbol: s.name, timeframe: S.tf, harga: S.price, sinyal: sg.dir > 0 ? 'BUY' : sg.dir < 0 ? 'SELL' : 'WAIT', skor: sg.conf, rsi: +sg.rsi.toFixed(1), tren_ema: sg.trendUp ? 'bull' : 'bear', atr_persen: +sg.atrPct.toFixed(3), volume_x: sg.volRatio && +sg.volRatio.toFixed(2), breakout: sg.brk, alasan: sg.why, sl: lv.sl, tp1: lv.tp1, tp2: lv.tp2 };
  if (s.risk && !s.risk.error) body.risk = { hard: s.risk.hard, warn: s.risk.warn, lp: s.risk.lp, authority: s.risk.authority, holders: s.risk.holders, smart_wallet_holding: s.risk.smart && s.risk.smart.count };
  if (s.d) body.dex = { skor: s.d.score, flags: s.d.flags, likuiditas_usd: s.d.liq, volume_1j: s.d.v1, tx_1j: s.d.tx, perubahan_1j: s.d.ch1, umur_jam: s.d.ageH, fdv: s.fdv };
  try { const j = await jget('/api/ai', 'Groq AI', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); $('aitxt').className = ''; $('aitxt').textContent = (j.text || '(kosong)') + (j.model ? '\n\n[' + j.model + ']' : ''); }
  catch (e) { $('aitxt').className = 'm'; $('aitxt').textContent = 'Gagal: ' + e.message + '. Pastikan GROQ_API_KEY sudah di-set di Vercel.'; }
  setTimeout(() => { b.disabled = false; }, 4000);
});

function setMode(m) {
  if (m === S.mode && S.sym) return;
  stopLive(); S.mode = m; S.sym = null; S.candles = []; S.sig = null; S.list = []; S.err = ''; S.loading = false; S.gen++;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.mode === m));
  $('scanlbl').textContent = MODES[m].scan; $('searchw').classList.toggle('on', m === 'dex');
  renderTfs(); renderAll(); setConn('MEMUAT', false);
  save('grokbot_sel', { mode: m, tf: S.tf, sym: null });
  if (m === 'futures') select({ id: 'BTCUSDT', name: 'BTCUSDT' });
  else if (m === 'forex') select({ id: FOREX[0][0], name: FOREX[0][1] });
  else if (m === 'gold') select({ id: GOLD[0][0], name: GOLD[0][1] });
  loadList();
}

/* ---------- loop ---------- */
function frame() {
  draw(); drawOrb(); typeStep(); requestAnimationFrame(frame);
}
setInterval(() => { const e = Math.floor((Date.now() - sessionStart) / 1000); $('clock').textContent = 'SESI ' + [Math.floor(e / 3600), Math.floor(e / 60) % 60, e % 60].map((n) => String(n).padStart(2, '0')).join(':'); renderHead(); renderDec(); renderAcc(); renderCode(); renderHunter(); renderTick(); }, 1000);
renderSrc(); renderTfs();
$('auto').textContent = 'AUTO: ' + (autoOn ? 'ON' : 'OFF'); $('auto').classList.toggle('off', !autoOn); $('auto').setAttribute('aria-pressed', autoOn);
const saved = load('grokbot_sel', null);
if (saved && MODES[saved.mode]) { S.tf = TFS.includes(saved.tf) ? saved.tf : '5m'; }
setMode(saved && MODES[saved.mode] ? saved.mode : 'futures');
requestAnimationFrame(frame);
window.__grok = { S, P, analyze, applyLive, applyPrice };
})();
