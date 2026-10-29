-- Screen Flow Board
-- projects / screens / connections match the product model.
-- Image bytes live in storage_objects (path:
--   projects/{projectId}/screens/{screenId}/{filename})
-- and are never stored on the screen row.
--
-- user_id is text because session ids are text.
-- Every query is scoped to the verified session user in server functions.
-- The database role used by the app is the table owner on a pooled connection,
-- which bypasses row level security, so RLS policies would not actually
-- constrain it. Do not add a second, client-trusted user id.

create table if not exists projects (
  id uuid primary key,
  user_id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_updated_idx
  on projects (user_id, updated_at desc);

create table if not exists storage_objects (
  path text primary key,
  project_id uuid not null references projects (id) on delete cascade,
  user_id text not null,
  mime_type text not null,
  byte_size integer not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

create index if not exists storage_objects_project_idx
  on storage_objects (project_id);

create table if not exists screens (
  id uuid primary key,
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  original_file_name text not null,
  stored_file_name text not null,
  storage_path text not null,
  image_url text not null,
  public_token text not null unique,
  mime_type text not null,
  width integer,
  height integer,
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  display_width double precision not null default 280,
  display_height double precision not null default 420,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists screens_project_idx on screens (project_id);

create table if not exists connections (
  id uuid primary key,
  project_id uuid not null references projects (id) on delete cascade,
  from_screen_id uuid not null references screens (id) on delete cascade,
  to_screen_id uuid not null references screens (id) on delete cascade,
  label text,
  source_handle text,
  target_handle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connections_no_self check (from_screen_id <> to_screen_id)
);

create index if not exists connections_project_idx on connections (project_id);
create index if not exists connections_from_idx on connections (from_screen_id);
create index if not exists connections_to_idx on connections (to_screen_id);
