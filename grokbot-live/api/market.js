// Forex & emas. Utama: TwelveData (rotasi banyak key). Cadangan: Yahoo Finance bila semua key gagal / belum di-set.
// GET /api/market?symbol=EUR/USD&tf=5m        -> candle
// GET /api/market?symbols=EUR/USD,XAU/USD     -> harga + perubahan harian

const { rotate, rotateError, statusToRotate, keyInfo } = require('./_keys');

const UA = 'Mozilla/5.0 (compatible; GrokBotDashboard/1.0)';
const OK_SYM = /^[A-Za-z0-9=\-.^/]{1,15}$/;
const TD_INTERVAL = { '1m': '1min', '5m': '5min', '15m': '15min', '1h': '1h' };
const Y_TF = { '1m': ['1m', '1d'], '5m': ['5m', '5d'], '15m': ['15m', '5d'], '1h': ['60m', '1mo'] };
const Y_SYMBOL = {
  'EUR/USD': 'EURUSD=X', 'GBP/USD': 'GBPUSD=X', 'USD/JPY': 'USDJPY=X', 'AUD/USD': 'AUDUSD=X', 'USD/CAD': 'USDCAD=X',
  'USD/CHF': 'USDCHF=X', 'NZD/USD': 'NZDUSD=X', 'EUR/JPY': 'EURJPY=X', 'GBP/JPY': 'GBPJPY=X', 'USD/IDR': 'USDIDR=X',
  'XAU/USD': 'GC=F', 'XAG/USD': 'SI=F',
};
const yahooSym = (s) => Y_SYMBOL[s] || s;

/* ---------- TwelveData ---------- */
async function tdGet(path, params) {
  return rotate('TWELVEDATA', async (key) => {
    const q = new URLSearchParams({ ...params, apikey: key });
    const r = await fetch('https://api.twelvedata.com/' + path + '?' + q.toString(), { signal: AbortSignal.timeout(8000) });
    const rot = statusToRotate(r.status, 'TwelveData');
    if (rot) throw rot;
    const j = await r.json();
    // TwelveData sering membalas HTTP 200 dengan body {status:"error", code:429}
    if (j && j.status === 'error') {
      const msg = String(j.message || '');
      if (j.code === 429) throw rotateError('TwelveData limit: ' + msg.slice(0, 80), /day/i.test(msg) ? 3600000 : 65000);
      if (j.code === 401 || j.code === 403) throw rotateError('TwelveData key ditolak', 3600000);
      throw new Error('TwelveData ' + j.code + ': ' + msg.slice(0, 120));
    }
    return j;
  });
}

async function tdCandles(symbol, tf) {
  const j = await tdGet('time_series', { symbol, interval: TD_INTERVAL[tf] || '5min', outputsize: 300, order: 'ASC', timezone: 'UTC' });
  const candles = (j.values || [])
    .map((v) => ({ t: new Date(v.datetime.replace(' ', 'T') + 'Z').getTime(), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0) }))
    .filter((c) => isFinite(c.t) && isFinite(c.c))
    .sort((a, b) => a.t - b.t);
  if (!candles.length) throw new Error('TwelveData: candle kosong untuk ' + symbol);
  const last = candles[candles.length - 1];
  const dayAgo = last.t - 24 * 3600e3;
  let ref = candles[0];
  for (const c of candles) { if (c.t <= dayAgo) ref = c; else break; }
  return { provider: 'twelvedata', symbol, name: (j.meta && j.meta.symbol) || symbol, price: last.c, prevClose: ref.c, candles };
}

async function tdQuotes(symbols) {
  const out = {};
  // free plan: 8 kredit/menit/key -> maksimal 5 simbol per panggilan, tiap panggilan boleh pakai key berbeda
  for (let i = 0; i < symbols.length; i += 5) {
    const chunk = symbols.slice(i, i + 5);
    const j = await tdGet('quote', { symbol: chunk.join(',') });
    const items = chunk.length === 1 ? { [chunk[0]]: j } : j;
    for (const s of chunk) {
      const x = items[s];
      if (!x || x.status === 'error' || x.code) { out[s] = { symbol: s, error: true }; continue; }
      const price = +x.close, prev = +x.previous_close;
      out[s] = { symbol: s, price, prev, changePct: x.percent_change != null ? +x.percent_change : prev ? ((price - prev) / prev) * 100 : null };
    }
  }
  return symbols.map((s) => out[s] || { symbol: s, error: true });
}

/* ---------- Yahoo (cadangan) ---------- */
async function yahooChart(symbol, interval, range) {
  let lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('yahoo ' + r.status);
      const j = await r.json();
      const res = j.chart && j.chart.result && j.chart.result[0];
      if (!res) throw new Error('yahoo: data kosong untuk ' + symbol);
      return res;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
async function yahooCandles(symbol, tf) {
  const [interval, range] = Y_TF[tf] || Y_TF['5m'];
  const d = await yahooChart(yahooSym(symbol), interval, range);
  const ts = d.timestamp || [], qt = (d.indicators && d.indicators.quote && d.indicators.quote[0]) || {};
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const o = qt.open && qt.open[i], h = qt.high && qt.high[i], l = qt.low && qt.low[i], c = qt.close && qt.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ t: ts[i] * 1000, o, h, l, c, v: (qt.volume && qt.volume[i]) || 0 });
  }
  const m = d.meta || {};
  return { provider: 'yahoo', symbol, name: m.shortName || symbol, price: m.regularMarketPrice, prevClose: m.chartPreviousClose, candles };
}
async function yahooQuotes(symbols) {
  const out = await Promise.allSettled(symbols.map((s) => yahooChart(yahooSym(s), '1d', '5d')));
  return out.map((o, i) => {
    if (o.status !== 'fulfilled') return { symbol: symbols[i], error: true };
    const m = o.value.meta || {}, price = m.regularMarketPrice, prev = m.chartPreviousClose || m.previousClose;
    return { symbol: symbols[i], price, prev, changePct: prev ? ((price - prev) / prev) * 100 : null };
  });
}

/* ---------- handler ---------- */
module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const warnings = [];

    if (q.symbols) {
      const syms = String(q.symbols).split(',').slice(0, 12);
      if (!syms.every((s) => OK_SYM.test(s))) return res.status(400).json({ error: 'symbol tidak valid' });
      let quotes, provider = 'twelvedata';
      try { quotes = await tdQuotes(syms); }
      catch (e) { warnings.push(e.message); provider = 'yahoo'; quotes = await yahooQuotes(syms); }
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
      return res.status(200).json({ provider, quotes, warnings, keys: keyInfo('TWELVEDATA') });
    }

    const symbol = String(q.symbol || ''), tf = TD_INTERVAL[q.tf] ? q.tf : '5m';
    if (!OK_SYM.test(symbol)) return res.status(400).json({ error: 'symbol tidak valid' });
    let data;
    try { data = await tdCandles(symbol, tf); }
    catch (e) { warnings.push(e.message); data = await yahooCandles(symbol, tf); }
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    return res.status(200).json({ ...data, warnings, keys: keyInfo('TWELVEDATA') });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
