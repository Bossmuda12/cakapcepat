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
CREATE INDEX IF NOT EXISTS idx_messages_sender_user ON messages(sender_user_id);-- ============================================================================
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
