# CakapCepat — Kerangka MVP (Internal Tool)

Ini adalah **titik awal teknis** (starter code) untuk CakapCepat — sistem otomasi WhatsApp
untuk dipakai **internal** oleh tim/departemen kamu sendiri (bukan produk yang dijual ke
bisnis lain). Baca `CakapCepat-Rencana-Arsitektur-Internal.docx` dulu untuk konteks lengkap
sebelum menyerahkan folder ini ke developer.

## Untuk kamu yang non-teknis: apa isi folder ini?

1. **Terima & kirim pesan WhatsApp** — termasuk broadcast bertahap (anti-banned) dan balasan
   otomatis, lewat WhatsApp Cloud API resmi Meta.
2. **Model multi-nomor per CS & per produk** — setiap CS bisa punya nomor WhatsApp sendiri,
   dan setiap produk baru bisa dapat nomor WhatsApp baru pula. Satu nomor (`whatsapp_channels`)
   bisa ditandai pemiliknya (CS mana), produk mana, dan opsional departemen mana — bukan
   banyak "pelanggan" terpisah seperti produk SaaS, tapi satu perusahaan dengan banyak nomor.
3. **Pelacakan iklan CTWA (Click-to-WhatsApp)** — menangkap `ctwa_clid` dari chat yang berasal
   dari iklan Meta, lalu melaporkan balik hasil closing-nya lewat Meta Conversions API (CAPI).
4. **Kerangka AI chatbot** — struktur dasar untuk balasan otomatis berbasis AI + knowledge base,
   siap dikembangkan lebih lanjut oleh developer.

Yang **BELUM** ada (sengaja, di luar Fase 1): tampilan dashboard (frontend), Instagram
automation, dan reporting/analytics lanjutan — itu Fase 2 sesuai dokumen rencana.

Tidak ada sistem billing/subscription di sini — karena ini bukan produk yang dijual.

## Untuk developer

Stack: Node.js + TypeScript + Express + PostgreSQL + Redis/BullMQ (antrean broadcast).

### Setup lokal

```bash
cp .env.example .env          # isi kredensial WhatsApp Cloud API, CAPI, & DB
docker compose up -d          # jalankan Postgres + Redis lokal
npm install
npm run db:migrate            # load src/db/schema.sql ke database
npm run dev                   # jalankan server
npm run worker                # (terminal terpisah) jalankan broadcast worker
```

### Struktur folder

```
src/
  server.ts                 # entrypoint Express
  config.ts                 # baca env var
  db/
    schema.sql               # skema tabel: organization, departments, contacts, dst
    pool.ts / migrate.ts
  whatsapp/
    client.ts                # kirim pesan via WhatsApp Cloud API
    webhook.ts                # terima webhook — termasuk tangkap ctwa_clid dari iklan CTWA
    capi.ts                   # kirim event konversi ke Meta Conversions API (CAPI)
  ai/
    chatbot.ts                # stub balasan AI berbasis knowledge base
  queue/
    broadcastQueue.ts / broadcastWorker.ts   # antrean broadcast bertahap (anti-banned)
  routes/
    departments.ts             # CRUD departemen (pengelompokan tim, opsional)
    products.ts                 # CRUD produk/lini bisnis
    channels.ts                  # daftarkan nomor WA baru, assign ke CS & produk
    contacts.ts                # CRUD kontak/lead
    conversations.ts           # assign agent, ubah status pipeline, tandai closing (trigger CAPI)
    broadcasts.ts               # buat & trigger campaign broadcast
  middleware/
    auth.ts                    # stub autentikasi JWT sederhana (single-org, role-based)
```

### Menambah nomor WhatsApp baru (CS baru / produk baru)

1. Tambahkan nomor barunya ke WhatsApp Business Account (WABA) lewat Meta Business Manager —
   cepat begitu bisnis kamu sudah terverifikasi sekali. Ingat batas jumlah nomor: mulai dari 2,
   naik otomatis ke 20 setelah bisnis terverifikasi/2.000 pesan terkirim, bisa ajukan sampai 50
   nomor lewat tiket support Meta kalau kebutuhan kamu sebesar itu.
2. Ambil `phone_number_id` dan buat System User access token dari Meta Business Settings.
3. Panggil `POST /api/channels` dengan kredensial itu, sekalian isi `ownerUserId` (CS pemilik)
   dan `productId` (produk yang dijual lewat nomor ini). Lihat `src/routes/channels.ts`.

Sejak Oktober 2025, batas kirim pesan (messaging limit) dihitung di level akun bisnis (business
portfolio) secara keseluruhan — bukan per nomor lagi. Jadi nomor baru yang ditambahkan ke akun
bisnis yang sudah mapan umumnya ikut kapasitas gabungan, tidak selalu mulai dari nol. Tetap
pantau quality rating tiap nomor di Meta Business Manager untuk memastikan performanya baik.

### Yang wajib dikerjakan developer sebelum dipakai tim sungguhan

- [ ] Selesaikan **Business Verification** langsung ke Meta (Bab 7 dokumen rencana) — tidak perlu Tech Provider Program karena ini internal.
- [ ] Setup **Meta Pixel** khusus untuk CAPI (bisa pixel yang sama dengan yang dipakai iklan CTWA di Meta Ads Manager).
- [ ] Lengkapi `ai/chatbot.ts` dengan provider AI pilihan kamu (mis. Claude API) dan isi knowledge base awal dari FAQ/SOP tim.
- [ ] Ganti `middleware/auth.ts` dengan sistem autentikasi production-grade.
- [ ] Bangun frontend dashboard (di luar scope kerangka ini).
- [ ] Tambahkan test otomatis & monitoring sebelum dipakai semua departemen.

### Referensi resmi

- WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api
- Conversions API for Business Messaging (CTWA tracking): https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging
