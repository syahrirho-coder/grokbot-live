# Grok Bot Live

Dashboard sinyal live bergaya "Grok Bot". Deploy ke Vercel, tanpa build step.

## Isi
- **Tampilan**: ticker mover di bar atas, panel wallet hunter dengan orb (warna dan jumlah partikel mengikuti sinyal dan jumlah smart wallet), kartu keputusan Grok, pop-up profit paper, tombol RINGKASAN (ringkasan sesi), dan tombol PILIH SIMBOL untuk daftar token/pair.
- **Crypto Futures**: candle dan harga live dari Binance Futures (WebSocket, fallback polling).
- **DEX Meme**: token trending dari DexScreener, candle dari GeckoTerminal, skor 0-100 dari statistik pair.
- **Forex** dan **Gold**: TwelveData dengan rotasi key lewat `/api/market`. Kalau semua key gagal atau belum di-set, otomatis pindah ke Yahoo Finance (header chart menampilkan sumber yang dipakai).
- **Cek risiko token Solana** (`api/risk.js`): LP lock/burn (RugCheck, GMGN), mint dan freeze authority (Helius), top10 holder, insider, jumlah smart wallet yang sedang hold (GMGN). Flag berat memblokir entry paper.
- **Signal engine**: EMA20/50, RSI14, ATR14, breakout 20 candle, volume. Skor dihitung dari candle yang sudah close.
- **Akun paper**: modal virtual $100, entry otomatis kalau skor >= 60, SL 1.5 ATR, TP1 (50%) lalu SL ke entry, TP2. Fee dihitung. Tersimpan di localStorage browser.
- **Analisis Grok AI** (opsional): komentar singkat dari Groq lewat `/api/ai`.

## Deploy
```bash
npm i -g vercel
cd grokbot-live
vercel          # preview
vercel --prod   # production
```
Atau push folder ini ke GitHub lalu Import Project di vercel.com (Framework: Other).

Isi di Vercel > Settings > Environment Variables. Setiap layanan menerima banyak key; pilih salah satu cara:
- `HELIUS_API_KEYS=k1,k2,k3,k4,k5,k6` (dipisah koma), atau `HELIUS_API_KEY_1` ... `HELIUS_API_KEY_6`
- `GROQ_API_KEYS=...` (6 key), atau `GROQ_API_KEY_1` ... `GROQ_API_KEY_6`
- `TWELVEDATA_API_KEYS=...` (10 key), atau `TWELVEDATA_API_KEY_1` ... `TWELVEDATA_API_KEY_10`
- `GMGN_API_KEY` (boleh juga `GMGN_API_KEYS`)
- Opsional: `GROQ_MODEL` (boleh beberapa dipisah koma, dicoba berurutan; default `openai/gpt-oss-120b,openai/gpt-oss-20b`), `GMGN_BASE_URL` (default `https://openapi.gmgn.ai`), `GMGN_AUTH_HEADER` (default `X-APIKEY`), `RUGCHECK_API_KEY`

Cara kerja rotasi (`api/_keys.js`): setiap panggilan memakai key berikutnya secara bergiliran. Kalau satu key kena limit (HTTP 429, "run out of API credits", 401/403/402), key itu diistirahatkan (1 menit untuk limit per menit, 1 jam untuk kuota harian atau key ditolak) dan request otomatis dicoba dengan key lain. Cooldown disimpan di memori instance serverless, jadi bisa berbeda antar instance. Respons `/api/market` dan `/api/ai` menyertakan `keys: {total, cooling}`.

Setelah deploy, buka `/api/risk?mint=<alamat token Solana>` di browser. Field `sources` menunjukkan sumber mana yang berhasil (rugcheck, gmgn_security, gmgn_smart, helius) atau pesan errornya.

## Catatan penting
- Binance dan DexScreener dipanggil **langsung dari browser** pengguna. Binance Futures memblokir IP Amerika, jadi kalau lewat server Vercel (region US) akan kena 451. Dari browser di Indonesia aman.
- Hemat kredit TwelveData (free: 800 kredit per hari dan 8 per menit per key). Chart forex/emas refresh tiap 20 detik dan daftar harga tiap 5 menit, sekitar 7.000 kredit per hari kalau satu tab terbuka terus. Dengan 10 key kapasitasnya 8.000 kredit per hari, jadi cukup untuk satu atau dua pengguna. Respons di-cache di edge Vercel 15 detik. Forex dan emas tidak punya volume. Perubahan harian dihitung dari candle sekitar 24 jam sebelumnya.
- Fallback Yahoo memakai gold futures (GC=F) dan silver futures (SI=F), jadi harganya sedikit berbeda dari spot XAU/USD.
- GeckoTerminal gratis dibatasi sekitar 30 request/menit. Aplikasi ini refresh candle DEX tiap 15 detik.
- Cek risiko hanya untuk token Solana. Chain lain tampil "n/a". Tanpa key GMGN/Helius, kartu risiko memakai sumber yang tersisa.
- Format auth GMGN (`X-APIKEY` + `timestamp` + `client_id`, base `openapi.gmgn.ai`) ditulis dari ingatan dan belum diuji dengan key asli. Kalau `sources.gmgn_*` di `/api/risk` error 401/403, samakan dengan `OpenApiClient` di paket gmgn-skills lewat `GMGN_BASE_URL` / `GMGN_AUTH_HEADER`. GMGN hanya menerima IPv4.
- Nilai `burn_status` GMGN belum kuketahui pasti. UI menampilkannya apa adanya dan menandai "burned" lewat tebakan teks atau `lpLockedPct` RugCheck.
- Akun PAPER hanya simulasi. Hasilnya bukan jaminan dan bukan saran finansial.
- Auto-entry hanya berjalan untuk simbol yang sedang dibuka di chart.

## Catatan Groq
- `llama-3.3-70b-versatile` dan `llama-3.1-8b-instant` dihentikan Groq pada 16 Agustus 2026 untuk tier gratis dan developer. Default sekarang `openai/gpt-oss-120b` (production, reasoning) dengan cadangan `openai/gpt-oss-20b`. Model preview seperti `qwen/qwen3.8-27b` bisa dihentikan sewaktu-waktu.
- Batas gratis Groq berlaku per **organisasi**, bukan per key: 30 request/menit, 1.000 request/hari, 8.000 token/menit, 200.000 token/hari untuk model gpt-oss. Rotasi beberapa key dari organisasi yang sama tidak menambah kuota. Rotasi hanya berguna kalau key-nya milik organisasi berbeda.

## Struktur
```
index.html        UI
app.js            logika, chart, signal engine, paper trading
api/_keys.js      rotasi API key + failover
api/market.js     forex & emas (TwelveData, cadangan Yahoo)
api/risk.js       cek LP, authority, holder, smart wallet
api/ai.js         proxy Groq
vercel.json
```
