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
ALTER TABLE whatsapp_channels ADD COLUMN IF NOT EXISTS connection_state TEXT NOT NULL DEFAULT 'idle'; -- idle | qr_pending | pairing_pending | connecting | connected | reconnecting | logged_out
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
