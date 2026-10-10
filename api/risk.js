// Cek risiko token Solana: LP burn/lock, mint & freeze authority, top10, smart wallet.
// GET /api/risk?mint=<alamat token>&chain=solana
// Sumber: RugCheck (LP lock), GMGN OpenAPI (burn status, holder, smart wallet), Helius (authority on-chain).
// Env: HELIUS_API_KEYS (rotasi, sampai 20), GMGN_API_KEY(S), (opsional) GMGN_BASE_URL, GMGN_AUTH_HEADER, RUGCHECK_API_KEY

const crypto = require('crypto');
const { rotate, rotateError, statusToRotate } = require('./_keys');
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const cache = new Map(); // mint -> { t, body }
const TTL = 30000;

const T = (ms = 7000) => AbortSignal.timeout(ms);
async function getJson(url, opt = {}) {
  const r = await fetch(url, { signal: T(), ...opt });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch (e) {}
  if (!r.ok) throw new Error('HTTP ' + r.status + (j && (j.message || j.error) ? ' ' + (j.message || j.error) : ''));
  if (j == null) throw new Error('respons bukan JSON');
  return j;
}
const num = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);

async function rugcheck(mint) {
  const headers = { Accept: 'application/json' };
  if (process.env.RUGCHECK_API_KEY) headers['X-API-KEY'] = process.env.RUGCHECK_API_KEY;
  const j = await getJson('https://api.rugcheck.xyz/v1/tokens/' + mint + '/report/summary', { headers });
  return {
    lpLockedPct: num(j.lpLockedPct),
    score: num(j.score_normalised),
    risks: (j.risks || []).map((x) => ({ name: x.name, level: x.level, desc: x.description })),
  };
}

function gmgnUrl(path, params) {
  const base = process.env.GMGN_BASE_URL || 'https://openapi.gmgn.ai';
  const q = new URLSearchParams({ ...params, timestamp: String(Math.floor(Date.now() / 1000)), client_id: crypto.randomUUID() });
  return base + path + '?' + q.toString();
}
async function gmgn(path, params) {
  const headerName = process.env.GMGN_AUTH_HEADER || 'X-APIKEY';
  return rotate('GMGN', async (key) => {
    const r = await fetch(gmgnUrl(path, params), { signal: T(), headers: { [headerName]: key, Accept: 'application/json' } });
    const rot = r.status === 429 ? rotateError('GMGN HTTP 429 (limit)', 300000) : statusToRotate(r.status, 'GMGN');
    if (rot) throw rot;
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) {}
    if (!r.ok || j == null) throw new Error('GMGN HTTP ' + r.status + (j && (j.message || j.msg) ? ' ' + (j.message || j.msg) : ''));
    if (j.code != null && j.code !== 0 && j.code !== 200) throw new Error('GMGN code ' + j.code + ' ' + (j.message || j.msg || ''));
    return j.data !== undefined ? j.data : j;
  });
}

async function helius(mint) {
  const result = await rotate('HELIUS', async (key) => {
    const r = await fetch('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(key), {
      method: 'POST', signal: T(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'risk', method: 'getAsset', params: { id: mint } }),
    });
    const rot = statusToRotate(r.status, 'Helius');
    if (rot) throw rot;
    const j = await r.json();
    if (j.error) {
      const msg = j.error.message || 'error';
      if (/rate|limit|credit|quota/i.test(msg)) throw rotateError('Helius: ' + msg.slice(0, 80), 60000);
      throw new Error('Helius: ' + msg);
    }
    return j.result;
  });
  const ti = (result && result.token_info) || {};
  return {
    mintAuthority: ti.mint_authority || null,
    freezeAuthority: ti.freeze_authority || null,
    supply: ti.supply, decimals: ti.decimals, program: ti.token_program,
  };
}

function tagsOf(x) { return x.tags || x.maker_token_tags || (x.wallet_tag_v2 ? [x.wallet_tag_v2] : []) || []; }

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const mint = String(q.mint || '');
    const chain = String(q.chain || 'solana').toLowerCase();
    if (chain !== 'solana' && chain !== 'sol') return res.status(200).json({ supported: false, reason: 'cek risiko hanya untuk Solana' });
    if (!MINT_RE.test(mint)) return res.status(400).json({ error: 'mint tidak valid' });

    const hit = cache.get(mint);
    if (hit && Date.now() - hit.t < TTL) { res.setHeader('Cache-Control', 's-maxage=30'); return res.status(200).json(hit.body); }

    const [rc, sec, sm, hl] = await Promise.allSettled([
      rugcheck(mint),
      gmgn('/v1/token/security', { chain: 'sol', address: mint }),
      gmgn('/v1/market/token_top_holders', { chain: 'sol', address: mint, tag: 'smart_degen', limit: 100 }),
      helius(mint),
    ]);
    const src = {};
    [['rugcheck', rc], ['gmgn_security', sec], ['gmgn_smart', sm], ['helius', hl]].forEach(([k, v]) => { src[k] = v.status === 'fulfilled' ? 'ok' : String(v.reason && v.reason.message || v.reason); });

    const R = rc.status === 'fulfilled' ? rc.value : null;
    const G = sec.status === 'fulfilled' ? sec.value : null;
    const H = hl.status === 'fulfilled' ? hl.value : null;
    const list = sm.status === 'fulfilled' ? (Array.isArray(sm.value) ? sm.value : sm.value.list || []) : null;

    const burnStatus = G && G.burn_status != null ? String(G.burn_status) : null;
    const burnedGuess = burnStatus ? /burn/i.test(burnStatus) && !/not|none|no_|false/i.test(burnStatus) : null;
    const lockedPct = R ? R.lpLockedPct : null;

    let mintRenounced = null, freezeRenounced = null;
    if (H) { mintRenounced = !H.mintAuthority; freezeRenounced = !H.freezeAuthority; }
    else if (G) { mintRenounced = G.renounced_mint == null ? null : !!G.renounced_mint; freezeRenounced = G.renounced_freeze_account == null ? null : !!G.renounced_freeze_account; }

    const top10 = G && num(G.top_10_holder_rate) != null ? num(G.top_10_holder_rate) * 100 : null;
    const insider = G && num(G.suspected_insider_hold_rate) != null ? num(G.suspected_insider_hold_rate) * 100 : null;
    const rugRatio = G ? num(G.rug_ratio) : null;

    const hard = [], warn = [];
    if (mintRenounced === false) hard.push('MINT AUTHORITY AKTIF');
    if (freezeRenounced === false) hard.push('FREEZE AUTHORITY AKTIF');
    if (lockedPct != null && lockedPct < 50 && burnedGuess !== true) hard.push('LP HANYA ' + lockedPct.toFixed(0) + '% LOCK/BURN');
    if (rugRatio != null && rugRatio > 0.3) hard.push('RUG RATIO ' + rugRatio.toFixed(2));
    if (R && R.risks.some((x) => /danger/i.test(x.level || ''))) hard.push('RUGCHECK: ' + R.risks.filter((x) => /danger/i.test(x.level || '')).map((x) => x.name).join(', '));
    if (top10 != null && top10 > 50) warn.push('TOP10 ' + top10.toFixed(0) + '%');
    if (insider != null && insider > 20) warn.push('INSIDER ' + insider.toFixed(0) + '%');
    if (G && G.is_wash_trading) warn.push('WASH TRADING');
    if (G && num(G.sniper_count) > 20) warn.push('SNIPER ' + G.sniper_count);

    const body = {
      supported: true, mint, at: Date.now(), sources: src,
      lp: { lockedPct, burnStatus, burnedGuess },
      authority: { mintRenounced, freezeRenounced },
      holders: { top10Pct: top10, insiderPct: insider, snipers: G ? num(G.sniper_count) : null },
      smart: list ? { count: list.length, sample: list.slice(0, 6).map((x) => ({ addr: x.address || x.wallet_address || x.maker, tags: tagsOf(x), amountUsd: num(x.usd_value != null ? x.usd_value : x.amount_usd != null ? x.amount_usd : x.balance_usd), pnl: num(x.profit != null ? x.profit : x.realized_profit != null ? x.realized_profit : x.total_profit) })) } : null,
      rug: { ratio: rugRatio, rugcheckScore: R ? R.score : null, risks: R ? R.risks : [] },
      hard, warn,
    };
    cache.set(mint, { t: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    res.setHeader('Cache-Control', 's-maxage=30');
    return res.status(200).json(body);
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
