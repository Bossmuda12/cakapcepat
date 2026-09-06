-- ============================================================================
-- Skema database CakapCepat — v2: mendukung banyak nomor WhatsApp per CS,
-- dan nomor baru per produk. Model single-organization + multi-department,
-- TANPA billing/subscription (bukan produk yang dijual ke bisnis lain).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Biasanya cuma 1 baris — perusahaan/tim kamu sendiri.
CREATE TABLE IF NOT EXISTS organization (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Departemen/cabang: Sales, Customer Service, Marketing, dst.
-- Sifatnya pengelompokan tim, OPSIONAL dipakai per channel (lihat whatsapp_channels).
CREATE TABLE IF NOT EXISTS departments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Produk/lini bisnis — dipakai untuk menandai "nomor WA ini punya siapa,
-- untuk jualan produk apa" saat kamu meluncurkan produk baru dengan CS
-- (dan nomor WhatsApp) baru.
CREATE TABLE IF NOT EXISTS products (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin/agent internal (termasuk CS). Akses ke departemen diatur lewat
-- department_members; kepemilikan nomor WA diatur lewat whatsapp_channels.owner_user_id.
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'agent',   -- owner | admin | agent
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS department_members (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id, user_id)
);

-- Nomor WhatsApp Business. INTI dari kebutuhan "1 CS = 1 nomor sendiri, dan
-- nomor baru tiap ada produk baru":
--   - owner_user_id  -> nomor ini dipegang CS siapa (boleh kosong kalau shared)
--   - product_id     -> nomor ini untuk jualan produk apa (boleh kosong kalau umum)
--   - department_id  -> pengelompokan tim (opsional, boleh kosong)
-- Ketiganya nullable & independen — satu nomor bisa dimiliki 1 CS untuk 1 produk
-- tanpa harus terikat departemen tertentu, sesuai kebutuhan kamu.
CREATE TABLE IF NOT EXISTS whatsapp_channels (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  department_id         UUID REFERENCES departments(id) ON DELETE SET NULL,
  product_id            UUID REFERENCES products(id) ON DELETE SET NULL,
  owner_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  label                 TEXT,            -- nama bebas, mis. "CS Budi - Produk Skincare"
  phone_number_id       TEXT NOT NULL,   -- ID dari Meta, BUKAN nomor telepon itu sendiri
  display_phone_number  TEXT,
  access_token          TEXT NOT NULL,   -- sebaiknya dienkripsi sebelum disimpan di production
  status                TEXT NOT NULL DEFAULT 'pending', -- pending | connected | disconnected
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (phone_number_id)
);

-- Kontak/lead (pembeli/calon pembeli yang dihubungi lewat WhatsApp).
CREATE TABLE IF NOT EXISTS contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  wa_number       TEXT NOT NULL,      -- format internasional, mis. 62812xxxxxxx
  name            TEXT,
  labels          TEXT[] DEFAULT '{}',
  pipeline_stage  TEXT DEFAULT 'new', -- new | contacted | qualified | closing_won | closing_lost
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, wa_number)
);

-- Thread percakapan per kontak per channel (per nomor WA, per CS/produk).
CREATE TABLE IF NOT EXISTS conversations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel_id       UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  assigned_to      UUID REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'open',  -- open | pending | closed
  -- Atribusi iklan Click-to-WhatsApp (CTWA) — lihat Bab 8 dokumen rencana.
  ctwa_clid        TEXT,
  ad_source_url    TEXT,
  conversion_reported BOOLEAN NOT NULL DEFAULT false,
  last_message_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Setiap pesan individual, masuk maupun keluar (termasuk balasan AI).
CREATE TABLE IF NOT EXISTS messages (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction        TEXT NOT NULL,               -- inbound | outbound
  sender_type      TEXT NOT NULL DEFAULT 'human', -- human | ai | system
  wa_message_id    TEXT,
  content_type     TEXT NOT NULL DEFAULT 'text', -- text | template | image | document | dst
  content          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'received', -- sent | delivered | read | failed | received
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campaign broadcast (kirim massal, per channel/nomor).
CREATE TABLE IF NOT EXISTS broadcasts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id      UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  template_name   TEXT NOT NULL,
  template_params JSONB DEFAULT '[]',
  target_label    TEXT,
  status          TEXT NOT NULL DEFAULT 'draft', -- draft | queued | sending | done | failed
  scheduled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broadcast_id  UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | sent | delivered | failed
  error         TEXT,
  sent_at       TIMESTAMPTZ
);

-- Aturan auto-reply / trigger AI per channel.
CREATE TABLE IF NOT EXISTS automations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id    UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  trigger_type  TEXT NOT NULL,     -- keyword | office_hours | fallback_to_ai
  config        JSONB NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Materi referensi yang dipakai AI chatbot untuk menjawab (lihat Bab 9).
-- Bisa umum (product_id NULL) atau spesifik per produk.
CREATE TABLE IF NOT EXISTS knowledge_base_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log event yang dikirim ke Meta Conversions API — untuk audit & debug atribusi CTWA.
CREATE TABLE IF NOT EXISTS ad_conversion_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_name       TEXT NOT NULL,
  ctwa_clid        TEXT NOT NULL,
  payload_sent     JSONB NOT NULL,
  response_status  INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_channels_owner ON whatsapp_channels(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_channels_product ON whatsapp_channels(product_id);

-- Kredensial Meta Conversions API (CAPI) — disimpan di sini supaya bisa diatur
-- lewat dashboard (halaman CTWA & Iklan), bukan cuma lewat env var.
ALTER TABLE organization ADD COLUMN IF NOT EXISTS capi_pixel_id TEXT;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS capi_access_token TEXT;

-- Kredensial & konfigurasi AI chatbot (Claude API) — disimpan di sini supaya
-- bisa diatur lewat dashboard (halaman Otomatisasi), bukan cuma lewat env var.
ALTER TABLE organization ADD COLUMN IF NOT EXISTS ai_api_key TEXT;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS ai_model TEXT;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS ai_system_prompt TEXT;

-- Atribusi pesan outbound manual ke user (CS) yang mengirim — dipakai halaman
-- Monitor untuk menghitung performa per CS (jumlah pesan terkirim hari ini).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sender_user ON messages(sender_user_id);


-- Laporan AI harian via WhatsApp (ringkasan leads + estimasi potensi konversi)
-- dan analisis Hot Leads on-demand — lihat src/ai/leadsAnalyzer.ts & src/scheduler.ts.
ALTER TABLE organization ADD COLUMN IF NOT EXISTS daily_report_wa_number TEXT;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS daily_report_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS daily_report_hour INT NOT NULL DEFAULT 8;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS last_daily_report_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS lead_reports (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  summary          TEXT NOT NULL,
  hot_leads        JSONB NOT NULL DEFAULT '[]',
  warm_leads       JSONB NOT NULL DEFAULT '[]',
  drop_leads       JSONB NOT NULL DEFAULT '[]',
  flags            JSONB NOT NULL DEFAULT '[]',
  estimated_value  BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_reports_org ON lead_reports(organization_id, created_at DESC);

-- Registrasi mandiri (Register), verifikasi email, dan lupa password —
-- dikirim via Gmail SMTP (lihat src/email.ts). Setiap registrasi baru
-- membuat organization sendiri (multi-tenant, produk ini bisa dipakai/
-- dijual ke siapa pun, bukan cuma TahaGroup).
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token);
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token);

-- Login sosial (Google / Facebook OAuth). google_id/facebook_id dipakai
-- untuk mencocokkan akun yang sudah ada by email, atau membuat akun baru
-- otomatis (email dari provider sudah terverifikasi oleh mereka, jadi
-- email_verified langsung true tanpa perlu link verifikasi lagi).
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_facebook_id ON users(facebook_id) WHERE facebook_id IS NOT NULL;

-- Username terpisah dari email (email tetap dipakai untuk login, username
-- untuk identitas tampilan yang bisa diubah bebas) + foto profil (disimpan
-- sebagai data URL base64 langsung di kolom, jadi otomatis sinkron di semua
-- device/browser karena datanya dari backend, bukan localStorage).
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

-- Onboarding: user yang daftar lewat Google/Facebook OAuth belum punya
-- password beneran (random) dan belum sempat lengkapi data diri. Flag ini
-- memaksa mereka lewat halaman /complete-profile sekali sebelum masuk dashboard.
ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_onboarding BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- Status order COD (terpisah dari contacts.pipeline_stage yang dipakai untuk
-- funnel sales umum) — dipakai halaman "Laporan Order" untuk menandai order
-- COD per percakapan: order valid (qualified_cod), closing (uang diterima),
-- spam, cancelled, atau returned. Nilai TERKINI disimpan langsung di
-- conversations (buat query cepat), riwayat lengkap tiap perubahan status
-- disimpan di order_status_events (buat laporan/export spreadsheet & audit
-- kapan tiap event dikirim ke Meta CAPI, kalau memang dikirim).
-- ============================================================================
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS order_status TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS order_value BIGINT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS order_status_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS order_status_events (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id       UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status                TEXT NOT NULL,   -- qualified_cod | closing | spam | cancelled | returned
  value                 BIGINT,
  note                  TEXT,
  changed_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Diisi kalau status ini memicu pelaporan ke Meta CAPI (lihat src/whatsapp/capi.ts).
  -- Tetap NULL untuk status yang sengaja TIDAK dilaporkan ke Meta (spam/cancelled/
  -- returned) — dicatat di sini cuma untuk laporan internal, bukan dikirim ke Meta,
  -- karena CAPI tidak punya cara resmi "membatalkan" event Purchase yang sudah terlanjur
  -- terkirim.
  capi_event_name       TEXT,
  capi_response_status  INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_status_events_conversation ON order_status_events(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_order_status ON conversations(order_status);

-- ============================================================================
-- Koneksi WhatsApp TANPA API resmi (QR code / kode pairing, ala WhatsApp Web)
-- — dipakai untuk nomor TIM yang belum bisa dapat akses WhatsApp Cloud API
-- resmi dari Meta (lihat pembatasan Account Quality). Nomor UTAMA tetap
-- disarankan pakai Cloud API resmi (connection_type='cloud_api') supaya
-- atribusi iklan CTWA & pelaporan Meta CAPI tetap jalan — QR/pairing cuma
-- untuk nomor tim tambahan (pendekatan hybrid).
-- ============================================================================
ALTER TABLE whatsapp_channels ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_channels ALTER COLUMN access_token DROP NOT NULL;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS connection_type TEXT NOT NULL DEFAULT 'cloud_api'; -- cloud_api | qr_session
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS connection_state TEXT NOT NULL DEFAULT 'idle'; -- idle | qr_pending | pairing_pending | connecting | connected | reconnecting | logged_out | error (P-12: gagal reconnect setelah batas percobaan)
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS qr_data_url TEXT;   -- QR code terkini sbg data:image, transient
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS pairing_code TEXT; -- kode pairing 8-digit terkini, transient
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS qr_requested_at TIMESTAMPTZ;

-- Pastikan nomor Cloud API tetap wajib punya phone_number_id/access_token
-- walaupun kolomnya sekarang nullable (biar nomor QR bisa kosong).
-- ADD CONSTRAINT tidak punya IF NOT EXISTS bawaan Postgres, jadi dibungkus
-- DO block supaya schema.sql tetap aman dijalankan berulang kali.
DO $$ BEGIN
  ALTER TABLE whatsapp_channels ADD CONSTRAINT chk_channel_cloud_api_fields
    CHECK (connection_type <> 'cloud_api' OR (phone_number_id IS NOT NULL AND access_token IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Auth-state Baileys (kredensial sesi WhatsApp Web + signal keys) per channel
-- QR/pairing, disimpan di Postgres — BUKAN di disk lokal container — supaya
-- sesi WA tidak hilang tiap kali Railway redeploy service.
CREATE TABLE IF NOT EXISTS whatsapp_qr_auth_keys (
  channel_id  UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  key_name    TEXT NOT NULL, -- 'creds' utk kredensial utama, atau '<tipe>-<id>' utk signal key (pre-key, session, dst)
  value       JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, key_name)
);

-- conversations.assigned_to sebelumnya TIDAK punya ON DELETE SET NULL —
-- akibatnya kalau anggota tim yang lagi di-assign ke sebuah percakapan
-- dihapus, DELETE-nya gagal (foreign key violation) padahal seharusnya
-- cuma "lepas assign"-nya, bukan blokir hapus user. Diperbaiki di sini
-- (dipakai fitur "Hapus anggota tim" di halaman Tim).
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_assigned_to_fkey;
ALTER TABLE conversations ADD CONSTRAINT conversations_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;

-- ============================================================================
-- P-1: Percakapan duplikat. INSERT ke conversations di ingest.ts sebelumnya
-- pakai "ON CONFLICT DO NOTHING" padahal TIDAK ADA unique constraint di
-- (contact_id, channel_id) — jadi tiap pesan masuk selalu bikin baris
-- conversations baru alih-alih dipakai bareng (percakapan "pecah" per pesan).
--
-- Blok ini (aman dijalankan berulang tiap deploy):
--   (a) gabungkan duplikat LAMA yang sudah kadung tercipta: untuk tiap
--       (contact_id, channel_id) sisakan 1 baris tertua, pindahkan semua
--       messages & order_status_events ke baris itu, pertahankan nilai
--       ctwa_clid/ad_source_url/order_status/order_value/assigned_to yang
--       tidak NULL dari baris duplikat (kalau baris tertua kosong), lalu
--       hapus baris duplikatnya;
--   (b) pasang UNIQUE INDEX di (contact_id, channel_id) supaya duplikat baru
--       tidak bisa tercipta lagi — dipakai ingest.ts sebagai target upsert
--       "ON CONFLICT (contact_id, channel_id)".
-- ============================================================================
DO $$
DECLARE
  dup RECORD;
  keep_id UUID;
BEGIN
  -- Kalau index unique-nya sudah ada, berarti penggabungan sudah pernah
  -- dijalankan sebelumnya — tidak perlu diulang (schema.sql dijalankan
  -- ulang tiap deploy).
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_conversations_contact_channel'
  ) THEN
    RETURN;
  END IF;

  FOR dup IN
    SELECT contact_id, channel_id
    FROM conversations
    GROUP BY contact_id, channel_id
    HAVING count(*) > 1
  LOOP
    -- Baris tertua yang dipertahankan.
    SELECT id INTO keep_id
    FROM conversations
    WHERE contact_id = dup.contact_id AND channel_id = dup.channel_id
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    -- Pindahkan semua pesan & event status order dari duplikat ke percakapan yang dipertahankan.
    UPDATE messages SET conversation_id = keep_id
    WHERE conversation_id IN (
      SELECT id FROM conversations
      WHERE contact_id = dup.contact_id AND channel_id = dup.channel_id AND id <> keep_id
    );

    UPDATE order_status_events SET conversation_id = keep_id
    WHERE conversation_id IN (
      SELECT id FROM conversations
      WHERE contact_id = dup.contact_id AND channel_id = dup.channel_id AND id <> keep_id
    );

    -- Pertahankan nilai atribusi/order/assign yang tidak NULL dari duplikat,
    -- kalau baris yang dipertahankan sendiri masih kosong di kolom itu.
    UPDATE conversations keep SET
      ctwa_clid = COALESCE(keep.ctwa_clid, dup_agg.ctwa_clid),
      ad_source_url = COALESCE(keep.ad_source_url, dup_agg.ad_source_url),
      order_status = COALESCE(keep.order_status, dup_agg.order_status),
      order_value = COALESCE(keep.order_value, dup_agg.order_value),
      assigned_to = COALESCE(keep.assigned_to, dup_agg.assigned_to),
      last_message_at = GREATEST(keep.last_message_at, dup_agg.last_message_at)
    FROM (
      SELECT
        max(ctwa_clid) AS ctwa_clid,
        max(ad_source_url) AS ad_source_url,
        max(order_status) AS order_status,
        max(order_value) AS order_value,
        max(assigned_to::text)::uuid AS assigned_to,
        max(last_message_at) AS last_message_at
      FROM conversations
      WHERE contact_id = dup.contact_id AND channel_id = dup.channel_id AND id <> keep_id
    ) dup_agg
    WHERE keep.id = keep_id;

    -- Hapus baris duplikat (messages/order_status_events yang tersisa di
    -- baris ini sudah dipindahkan di atas, jadi ON DELETE CASCADE aman).
    DELETE FROM conversations
    WHERE contact_id = dup.contact_id AND channel_id = dup.channel_id AND id <> keep_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_contact_channel ON conversations(contact_id, channel_id);

-- ============================================================================
-- P-3: Pesan kembar. wa_message_id sebelumnya tidak unique, jadi retry
-- webhook Meta / event Baileys yang diproses dua kali bisa mencatat pesan
-- yang sama dua kali. Bersihkan dulu duplikat wa_message_id yang sudah
-- kadung tercatat (sisakan yang tertua), baru pasang UNIQUE INDEX partial
-- (wa_message_id NULL tetap boleh berulang — pesan outbound lama/manual
-- banyak yang tidak punya wa_message_id).
-- ============================================================================
DELETE FROM messages m
USING messages newer
WHERE m.wa_message_id IS NOT NULL
  AND m.wa_message_id = newer.wa_message_id
  AND m.id <> newer.id
  AND (m.created_at, m.id) > (newer.created_at, newer.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa_message_id ON messages(wa_message_id) WHERE wa_message_id IS NOT NULL;

-- ============================================================================
-- P-6: Pengetahuan AI tidak disaring per produk. conversations.product_id
-- menandai chat ini soal produk apa (diturunkan dari whatsapp_channels.product_id
-- saat percakapan dibuat kalau belum diisi manual) supaya chatbot.ts bisa
-- menyaring knowledge_base_entries yang relevan saja — lihat src/ai/chatbot.ts.
-- ============================================================================
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_product ON conversations(product_id);

-- ############################################################################
-- GELOMBANG FITUR OTOMATISASI (F-1 s/d F-41)
-- Semua blok di bawah idempotent — schema.sql dijalankan ulang tiap deploy.
-- ############################################################################

-- ============================================================================
-- F-KATEGORI: Produk tiga lapis — Kategori > Produk > Varian.
-- Alasannya bukan cuma tombol filter: pengetahuan AI ikut berlapis, jadi
-- materi "cara COD" ditulis sekali di lapis toko, "cara rawat parfum" sekali
-- di lapis kategori, dan hanya harga/aroma/stok yang ditulis per produk.
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_categories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_categories_org ON product_categories(organization_id);

ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
-- Harga disimpan dalam SEN (integer) supaya tidak ada galat pembulatan desimal.
-- RM189.00 disimpan sebagai 18900.
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_cents BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MYR';
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_org ON products(organization_id);

CREATE TABLE IF NOT EXISTS product_variants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,            -- mis. "50ml", "Saiz 9"
  price_cents BIGINT,                   -- kalau NULL, pakai harga produk induk
  sku         TEXT,
  stock       INT,                      -- NULL = tidak dilacak
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);

-- Knowledge base ikut berlapis: entry boleh menempel ke kategori (berlaku untuk
-- semua produk di kategori itu), ke produk, atau tidak keduanya (materi umum toko).
ALTER TABLE knowledge_base_entries ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_kb_category ON knowledge_base_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_kb_product ON knowledge_base_entries(product_id);

-- ============================================================================
-- F-11: Tabel PESANAN sungguhan. Sebelumnya "order" cuma label status yang
-- menempel di percakapan — tidak ada nama pembeli, alamat, resi, kurir.
-- Akibatnya email kurir berisi resi tidak bisa dicocokkan ke siapa pun.
--
-- DUA LABEL TERPISAH (keputusan pemilik, 6 Sep 2026):
--   sales_status    = hasil chat      (qualified_cod/closing/cancelled/spam/...)
--   shipping_status = hasil pengiriman (pending/packed/shipped/problem/returned/delivered)
-- Dipisah supaya satu pesanan bisa "closing" DAN "retur" sekaligus — kalau
-- disatukan, angka closing turun surut tiap ada retur dan tingkat retur
-- mustahil dihitung.
-- ============================================================================
CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  channel_id      UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL,
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id      UUID REFERENCES product_variants(id) ON DELETE SET NULL,

  -- Data pembeli (dikumpulkan AI saat closing, boleh disunting manual)
  customer_name   TEXT,
  customer_phone  TEXT,
  address_line    TEXT,
  postcode        TEXT,
  city            TEXT,
  state           TEXT,
  country         TEXT DEFAULT 'MY',

  quantity        INT NOT NULL DEFAULT 1,
  unit_price_cents BIGINT,
  total_cents     BIGINT,
  currency        TEXT NOT NULL DEFAULT 'MYR',

  -- Label A — hasil chat
  sales_status    TEXT NOT NULL DEFAULT 'closing',
  -- Label B — status pengiriman
  shipping_status TEXT NOT NULL DEFAULT 'pending',
  -- Penanda "bermasalah" sengaja BUKAN status, tapi bendera + alasan: paket
  -- bisa bermasalah hari ini lalu jalan lagi besok, dan riwayatnya harus tetap ada.
  has_problem     BOOLEAN NOT NULL DEFAULT false,
  problem_reason  TEXT,
  problem_at      TIMESTAMPTZ,

  courier         TEXT,
  tracking_no     TEXT,
  shipped_at      TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  returned_at     TIMESTAMPTZ,

  cod_received    BOOLEAN NOT NULL DEFAULT false,
  cod_amount_cents BIGINT,
  cod_received_at TIMESTAMPTZ,

  -- Anti-dobel untuk rekap ke grup WhatsApp & pesan otomatis paket bermasalah
  group_reported_at   TIMESTAMPTZ,
  problem_notified_at TIMESTAMPTZ,

  notes           TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Satu resi hanya boleh dipakai satu pesanan per organisasi — ini yang membuat
-- pencocokan email kurir -> pembeli tidak pernah salah orang.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking ON orders(organization_id, tracking_no) WHERE tracking_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_org_created ON orders(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_conversation ON orders(conversation_id);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_status ON orders(organization_id, shipping_status);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);

-- Riwayat perubahan status pesanan (untuk audit & laporan)
CREATE TABLE IF NOT EXISTS order_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  field       TEXT NOT NULL,          -- sales_status | shipping_status | has_problem | cod_received
  old_value   TEXT,
  new_value   TEXT,
  source      TEXT NOT NULL DEFAULT 'manual', -- manual | ai | courier_email | courier_webhook
  note        TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at DESC);

-- ============================================================================
-- F-15/F-16: Jejak email/webhook kurir yang sudah diproses. Kurir mengirim
-- email berulang untuk resi yang sama; tanpa tabel ini pembeli bisa dikirimi
-- pesan "paket ditolak" tiga kali.
-- ============================================================================
CREATE TABLE IF NOT EXISTS courier_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  courier         TEXT,
  tracking_no     TEXT NOT NULL,
  raw_status      TEXT,                -- teks status apa adanya dari kurir
  mapped_status   TEXT,                -- shipping_status hasil pemetaan
  source          TEXT NOT NULL DEFAULT 'email', -- email | webhook | manual
  source_ref      TEXT,                -- message-id email / id event webhook
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_courier_events_ref ON courier_events(organization_id, source, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_courier_events_tracking ON courier_events(organization_id, tracking_no);

-- ============================================================================
-- F-3 Persona per nomor + F-37 pembatas kirim per nomor.
-- Persona ikut NOMOR (mis. "Rina"), pengetahuan ikut PRODUK — supaya satu CS
-- virtual bisa melayani banyak produk tanpa gaya bicaranya berubah-ubah.
-- ============================================================================
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS persona_name TEXT;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS persona_prompt TEXT;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT false;
-- Mode persetujuan: AI menyusun balasan, manusia menyetujui sebelum terkirim.
-- Sangat disarankan menyala 1-2 minggu pertama.
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS ai_approval_mode BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS hourly_send_limit INT NOT NULL DEFAULT 120;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS last_disconnect_notified_at TIMESTAMPTZ;

-- F-4 Balas seperti manusia + jam kerja per nomor
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS humanize_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS work_hour_start INT NOT NULL DEFAULT 9;
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS work_hour_end INT NOT NULL DEFAULT 22;

-- F-37 penghitung kirim per nomor per jam (jendela geser sederhana)
CREATE TABLE IF NOT EXISTS channel_send_counters (
  channel_id  UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  hour_bucket TIMESTAMPTZ NOT NULL,     -- date_trunc('hour', now())
  sent_count  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, hour_bucket)
);

-- ============================================================================
-- F-6/F-7: Pagar pengaman AI & ambil alih manual.
-- ============================================================================
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS attention_reason TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS attention_at TIMESTAMPTZ;
-- ai_paused = AI dikunci untuk percakapan ini (dipicu pagar pengaman ATAU
-- ditekan manual oleh owner lewat tombol "Ambil Alih").
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_paused_by UUID REFERENCES users(id) ON DELETE SET NULL;
-- F-10 ringkasan otomatis supaya owner tidak perlu membaca seluruh chat
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_summary_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_conversations_attention ON conversations(needs_attention) WHERE needs_attention = true;

-- Daftar pemicu yang mengunci AI dan menandai "butuh perhatian".
CREATE TABLE IF NOT EXISTS ai_guardrails (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  keyword         TEXT NOT NULL,        -- dicocokkan tidak peka huruf besar/kecil
  reason          TEXT NOT NULL,
  pause_ai        BOOLEAN NOT NULL DEFAULT true,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_guardrails_org ON ai_guardrails(organization_id) WHERE is_active = true;

-- ============================================================================
-- F-5: Ingatan anti-ulang. AI cenderung memakai pembuka yang sama
-- ("Baik kak, terima kasih sudah menghubungi...") — 50 chat dengan pembuka
-- identik tetap terbaca sebagai bot walau isinya berbeda.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_opener_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  channel_id      UUID REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  opener          TEXT NOT NULL,        -- kalimat pembuka yang sudah dipakai
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_opener_recent ON ai_opener_history(organization_id, channel_id, created_at DESC);

-- ============================================================================
-- F-9: Batas biaya AI & model bertingkat.
-- Model kecil untuk klasifikasi (tiap pesan), model besar hanya untuk menjawab.
-- ============================================================================
ALTER TABLE organization ADD COLUMN IF NOT EXISTS ai_model_small TEXT;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS ai_daily_budget_cents BIGINT;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS ai_spend_date DATE;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS ai_spend_cents BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  purpose         TEXT NOT NULL,        -- reply | classify | detect_product | summarize | followup
  model           TEXT,
  input_tokens    INT,
  output_tokens   INT,
  cost_cents      BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_org_date ON ai_usage_log(organization_id, created_at DESC);

-- ============================================================================
-- F-19 s/d F-22: Grup closingan & laporan.
-- ============================================================================
ALTER TABLE organization ADD COLUMN IF NOT EXISTS closing_group_jid TEXT;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS closing_group_name TEXT;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS closing_group_channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS group_report_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS group_daily_summary_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS last_group_summary_at TIMESTAMPTZ;
-- F-22: nomor pengirim laporan harian dipilih eksplisit (sebelumnya asal ambil
-- "channel pertama yang connected")
ALTER TABLE organization ADD COLUMN IF NOT EXISTS daily_report_channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL;

-- ============================================================================
-- F-25 s/d F-28: Follow-up berjadwal.
-- ============================================================================
CREATE TABLE IF NOT EXISTS follow_ups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id      UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL,
  attempt         INT NOT NULL DEFAULT 1,   -- 1 = H+1, 2 = H+3, 3 = H+7
  scheduled_at    TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | sent | cancelled | failed
  sent_at         TIMESTAMPTZ,
  message_text    TEXT,
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Satu percakapan hanya boleh punya satu follow-up terjadwal per percobaan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_ups_conv_attempt ON follow_ups(conversation_id, attempt);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(scheduled_at) WHERE status = 'scheduled';

ALTER TABLE organization ADD COLUMN IF NOT EXISTS followup_enabled BOOLEAN NOT NULL DEFAULT false;
-- Batas percobaan: kirim berulang ke orang yang tidak membalas adalah cara
-- tercepat dilaporkan spam dan nomor diblokir.
ALTER TABLE organization ADD COLUMN IF NOT EXISTS followup_max_attempts INT NOT NULL DEFAULT 3;

-- ============================================================================
-- F-30 s/d F-33: Media & voice note. Sebelumnya pesan yang tidak berisi teks
-- DIBUANG total (kode berhenti kalau textBody kosong) — foto alamat, bukti
-- transfer, dan voice note pelanggan hilang tanpa jejak.
-- ============================================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT;     -- image | audio | video | document | sticker
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_mime TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;      -- lokasi file (disk/objek) atau media id Meta
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_size INT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS transcript TEXT;     -- hasil transkrip voice note
ALTER TABLE messages ADD COLUMN IF NOT EXISTS transcribed_at TIMESTAMPTZ;

-- ============================================================================
-- F-41: Catatan aktivitas — siapa mengubah apa, kapan.
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,        -- mis. order.status_changed, channel.deleted
  entity          TEXT,
  entity_id       UUID,
  detail          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(organization_id, created_at DESC);

-- ============================================================================
-- P-21: Index organization_id yang hilang (dipakai hampir di semua query).
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_channels_org ON whatsapp_channels(organization_id);

-- ============================================================================
-- F-39: Notifikasi ke owner saat ada chat ditandai "butuh perhatian".
-- Penanda waktu supaya satu percakapan tidak diberitahukan berulang-ulang.
-- ============================================================================
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS attention_notified_at TIMESTAMPTZ;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS attention_alert_enabled BOOLEAN NOT NULL DEFAULT true;
