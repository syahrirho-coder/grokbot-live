// Komentar singkat dari Groq: rotasi banyak API key (api/_keys.js) + cadangan model otomatis.
// POST /api/ai  body: { pasar, simbol, timeframe, ... }
//
// GROQ_MODEL boleh berisi beberapa model dipisah koma, dicoba berurutan. Default:
//   openai/gpt-oss-120b (production, reasoning), lalu openai/gpt-oss-20b.
// Catatan: llama-3.3-70b-versatile dan llama-3.1-8b-instant dihentikan Groq pada 16 Agustus 2026 (tier gratis/developer).

const { rotate, rotateError, statusToRotate, keyInfo } = require('./_keys');

const DEFAULT_MODELS = 'openai/gpt-oss-120b,openai/gpt-oss-20b';
const SYSTEM =
  'Kamu analis trading yang ringkas. Dari data indikator dalam JSON, tulis 4-5 kalimat dalam bahasa Indonesia santai: ' +
  'bias saat ini, alasan utama, level penting (entry/SL/TP), risiko utama, dan apa yang membatalkan skenario. ' +
  'Jangan menjanjikan profit dan jangan memberi perintah pasti. Jika data DEX menunjukkan likuiditas tipis, token baru, atau flag risiko (LP, authority, top10), sebutkan risikonya.';

const models = () => String(process.env.GROQ_MODEL || DEFAULT_MODELS).split(/[\s,;]+/).filter(Boolean);
const clean = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

async function ask(model, ctx) {
  return rotate('GROQ', async (key) => {
    const payload = {
      model,
      temperature: 0.3,
      max_completion_tokens: 900, // model reasoning memakai sebagian token ini
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: ctx }],
    };
    if (model.startsWith('openai/gpt-oss')) payload.reasoning_effort = 'low';
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(25000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const rot = statusToRotate(r.status, 'Groq');
    if (rot) throw rot;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = j.error || {};
      const msg = err.message || 'groq error ' + r.status;
      if (/rate limit|quota|exceeded/i.test(msg)) throw rotateError('Groq: ' + msg.slice(0, 90), 60000);
      const e = new Error(msg);
      e.modelGone = /decommission|not found|does not exist|no longer supported|model_not_found/i.test(msg + ' ' + (err.code || ''));
      throw e;
    }
    const text = clean(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
    if (!text) throw new Error('Groq: jawaban kosong dari ' + model + ' (naikkan max_completion_tokens)');
    return text;
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'gunakan POST' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const ctx = JSON.stringify(body).slice(0, 3500);
    const errors = [];
    for (const model of models()) {
      try {
        const text = await ask(model, ctx);
        return res.status(200).json({ text, model, tried: errors, keys: keyInfo('GROQ') });
      } catch (e) {
        errors.push(model + ': ' + e.message);
        if (/belum di-set/.test(e.message)) throw e;
        // lanjut ke model berikutnya (model dihentikan, jawaban kosong, atau semua key limit)
      }
    }
    throw new Error(errors.join(' | '));
  } catch (e) {
    const msg = String((e && e.message) || e);
    return res.status(/belum di-set/.test(msg) ? 503 : 502).json({ error: msg });
  }
};
