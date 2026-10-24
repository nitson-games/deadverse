-- DEADVERSE schema (Neon / PostgreSQL 14+)
-- Idempotent: safe to run repeatedly via `npm run db:setup`.

CREATE TABLE IF NOT EXISTS admins (
  id            text PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL DEFAULT 'Admin',
  permissions   text[],
  is_active     boolean NOT NULL DEFAULT true,
  token_version integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Databases created before the permission layer have admins without a
-- permissions array. migrate.js fills those rows with the full set exactly once;
-- leaving the column nullable is what makes that distinguishable from a
-- deliberately emptied account.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS permissions text[];
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS comics (
  id              text PRIMARY KEY,
  title_fa        text NOT NULL,
  title_en        text NOT NULL,
  publisher       text NOT NULL CHECK (publisher IN ('Marvel', 'DC')),
  year            integer NOT NULL CHECK (year >= 1900 AND year <= 2100),
  desc_fa         text NOT NULL DEFAULT '',
  desc_en         text NOT NULL DEFAULT '',
  image_url       text NOT NULL DEFAULT '',
  image_public_id text NOT NULL DEFAULT '',
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS articles (
  id                 text PRIMARY KEY,
  title_fa           text NOT NULL,
  title_en           text NOT NULL,
  category           text NOT NULL CHECK (category IN ('marvel', 'dc', 'movies', 'characters', 'comics', 'news')),
  date_fa            text NOT NULL DEFAULT '',
  date_en            text NOT NULL DEFAULT '',
  desc_fa            text NOT NULL DEFAULT '',
  desc_en            text NOT NULL DEFAULT '',
  cover_image_url   text NOT NULL DEFAULT '',
  cover_image_pid   text NOT NULL DEFAULT '',
  mid_image_url     text NOT NULL DEFAULT '',
  mid_image_pid     text NOT NULL DEFAULT '',
  late_image_url    text NOT NULL DEFAULT '',
  late_image_pid    text NOT NULL DEFAULT '',
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movies (
  id              text PRIMARY KEY,
  name_fa         text NOT NULL,
  name_en         text NOT NULL,
  universe        text NOT NULL CHECK (universe IN ('Marvel', 'DC')),
  year            integer NOT NULL CHECK (year >= 1900 AND year <= 2100),
  rating          numeric(3, 1) NOT NULL CHECK (rating >= 0 AND rating <= 10),
  desc_fa         text NOT NULL DEFAULT '',
  desc_en         text NOT NULL DEFAULT '',
  image_url       text NOT NULL DEFAULT '',
  image_public_id text NOT NULL DEFAULT '',
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS characters (
  id              text PRIMARY KEY,
  name_fa         text NOT NULL,
  name_en         text NOT NULL,
  universe        text NOT NULL CHECK (universe IN ('Marvel', 'DC')),
  kind            text NOT NULL CHECK (kind IN ('hero', 'villain')),
  desc_fa         text NOT NULL DEFAULT '',
  desc_en         text NOT NULL DEFAULT '',
  image_url       text NOT NULL DEFAULT '',
  image_public_id text NOT NULL DEFAULT '',
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id              text PRIMARY KEY,
  name_fa         text NOT NULL,
  name_en         text NOT NULL,
  role_fa         text NOT NULL DEFAULT '',
  role_en         text NOT NULL DEFAULT '',
  initials        text NOT NULL CHECK (initials <> ''),
  desc_fa         text NOT NULL DEFAULT '',
  desc_en         text NOT NULL DEFAULT '',
  image_url       text NOT NULL DEFAULT '',
  image_public_id text NOT NULL DEFAULT '',
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  email      text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  is_read    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at DESC);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id         text PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_settings (
  id            text PRIMARY KEY,
  hero_title    text NOT NULL DEFAULT 'DEADVERSE',
  hero_sub_fa   text NOT NULL DEFAULT '',
  hero_sub_en   text NOT NULL DEFAULT '',
  hero_desc_fa  text NOT NULL DEFAULT '',
  hero_desc_en  text NOT NULL DEFAULT '',
  about_fa      text NOT NULL DEFAULT '',
  about_en      text NOT NULL DEFAULT '',
  btn1_fa       text NOT NULL DEFAULT '',
  btn1_en       text NOT NULL DEFAULT '',
  btn2_fa       text NOT NULL DEFAULT '',
  btn2_en       text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
