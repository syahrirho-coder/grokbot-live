// Rotasi API key dengan failover. File berawalan "_" tidak dijadikan endpoint oleh Vercel.
//
// Cara mengisi key di Environment Variables Vercel (pilih salah satu, boleh digabung):
//   TWELVEDATA_API_KEYS = key1,key2,key3,...        (dipisah koma / spasi / titik koma)
//   TWELVEDATA_API_KEY_1 ... TWELVEDATA_API_KEY_20  (satu variabel per key)
//   TWELVEDATA_API_KEY                              (satu key)
// Prefix yang dipakai: HELIUS, GROQ, TWELVEDATA, GMGN

const state = {};

function loadKeys(name) {
  const out = [];
  const add = (v) => {
    if (!v) return;
    String(v).split(/[\s,;]+/).forEach((x) => { x = x.trim(); if (x && !out.includes(x)) out.push(x); });
  };
  add(process.env[name + '_API_KEYS']);
  add(process.env[name + '_API_KEY']);
  for (let i = 1; i <= 20; i++) add(process.env[name + '_API_KEY_' + i]);
  return out;
}

// Error yang meminta pindah ke key berikutnya. cool = lama key diistirahatkan (ms).
function rotateError(message, cool) {
  const e = new Error(message);
  e.rotate = true;
  e.cool = cool || 60000;
  return e;
}

// HTTP status -> apakah perlu rotasi
function statusToRotate(status, label) {
  if (status === 429) return rotateError(label + ' HTTP 429 (limit)', 60000);
  if (status === 401 || status === 403) return rotateError(label + ' HTTP ' + status + ' (key ditolak)', 3600000);
  if (status === 402) return rotateError(label + ' HTTP 402 (kuota habis)', 3600000);
  return null;
}

async function rotate(name, fn) {
  const keys = loadKeys(name);
  if (!keys.length) throw new Error(name + '_API_KEY(S) belum di-set');
  const st = state[name] || (state[name] = { i: Math.floor(Math.random() * keys.length), cool: {} });
  const now = Date.now();
  let lastErr = null, tried = 0;
  for (let n = 0; n < keys.length; n++) {
    const idx = (st.i + n) % keys.length, key = keys[idx];
    if ((st.cool[key] || 0) > now) continue;
    tried++;
    try {
      const r = await fn(key);
      st.i = (idx + 1) % keys.length; // round-robin: panggilan berikutnya mulai dari key sesudahnya
      return r;
    } catch (e) {
      lastErr = e;
      if (e && e.rotate) { st.cool[key] = now + (e.cool || 60000); continue; }
      throw e;
    }
  }
  if (!tried) throw new Error('semua ' + keys.length + ' key ' + name + ' sedang cooldown');
  throw lastErr || new Error('semua key ' + name + ' gagal');
}

function keyInfo(name) {
  const keys = loadKeys(name), st = state[name], now = Date.now();
  return { total: keys.length, cooling: st ? keys.filter((k) => (st.cool[k] || 0) > now).length : 0 };
}

module.exports = { loadKeys, rotate, rotateError, statusToRotate, keyInfo };
