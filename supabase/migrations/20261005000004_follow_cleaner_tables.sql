-- =============================================================================
-- RRPP Suite · 004 · limpieza de seguidos (extensión de Chrome)
-- =============================================================================
-- Todo cuelga de una cuenta de Instagram con rol main. La extensión sube el
-- escaneo en partes idempotentes (follow_scan_chunks) y al cerrarlo se borran
-- los seguidos que ya no aparecen, salvo los protegidos (☆).

-- -----------------------------------------------------------------------------
-- follow_scans
-- -----------------------------------------------------------------------------

create table public.follow_scans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  instagram_account_id uuid not null,
  status public.scan_status not null default 'uploading',
  following_count integer not null default 0,
  followers_count integer not null default 0,
  non_followers_count integer not null default 0,
  chunks_expected integer not null,
  chunks_received integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint follow_scans_id_owner_id_key unique (id, owner_id),
  constraint follow_scans_instagram_account_fkey
    foreign key (instagram_account_id, owner_id)
    references public.instagram_accounts (id, owner_id) on delete cascade,
  constraint follow_scans_counts_positive check (
    following_count >= 0 and followers_count >= 0 and non_followers_count >= 0
  ),
  constraint follow_scans_chunks_expected_positive check (chunks_expected >= 1),
  constraint follow_scans_chunks_received_range check (chunks_received between 0 and chunks_expected)
);

comment on table public.follow_scans is 'Escaneos de seguidos/seguidores subidos por la extensión, en partes.';

create index follow_scans_owner_id_started_at_idx on public.follow_scans (owner_id, started_at desc);
create index follow_scans_instagram_account_id_owner_id_idx on public.follow_scans (instagram_account_id, owner_id, started_at desc);
-- A lo sumo un escaneo subiéndose por cuenta (start_follow_scan cierra el anterior).
create unique index follow_scans_one_uploading_per_account_key on public.follow_scans (instagram_account_id)
  where status = 'uploading';

create trigger follow_scans_check_account_role
  before insert or update of instagram_account_id on public.follow_scans
  for each row execute function public.check_account_role('main');

-- -----------------------------------------------------------------------------
-- follow_scan_chunks: partes recibidas (idempotencia por scan_id + índice)
-- -----------------------------------------------------------------------------

create table public.follow_scan_chunks (
  scan_id uuid not null references public.follow_scans (id) on delete cascade,
  chunk_index integer not null,
  row_count integer not null,
  received_at timestamptz not null default now(),
  primary key (scan_id, chunk_index),
  constraint follow_scan_chunks_chunk_index_positive check (chunk_index >= 0),
  constraint follow_scan_chunks_row_count_positive check (row_count >= 0)
);

comment on table public.follow_scan_chunks is 'Partes ya aplicadas de un escaneo: reintentar una parte no la aplica dos veces.';

-- -----------------------------------------------------------------------------
-- followed_accounts: una fila por cuenta que seguís
-- -----------------------------------------------------------------------------

create table public.followed_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  instagram_account_id uuid not null,
  ig_user_id text not null,
  username text not null,
  full_name text,
  is_private boolean not null default false,
  is_verified boolean not null default false,
  follows_back boolean not null,
  is_protected boolean not null default false,
  last_post_at timestamptz,
  last_post_checked_at timestamptz,
  last_seen_scan_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followed_accounts_instagram_account_id_ig_user_id_key unique (instagram_account_id, ig_user_id),
  constraint followed_accounts_instagram_account_fkey
    foreign key (instagram_account_id, owner_id)
    references public.instagram_accounts (id, owner_id) on delete cascade,
  constraint followed_accounts_last_seen_scan_fkey
    foreign key (last_seen_scan_id, owner_id)
    references public.follow_scans (id, owner_id) on delete set null (last_seen_scan_id),
  constraint followed_accounts_ig_user_id_format check (ig_user_id ~ '^[0-9]{1,30}$'),
  constraint followed_accounts_username_format check (username ~ '^[a-z0-9._]{1,30}$')
);

comment on table public.followed_accounts is 'Cuentas que sigue la cuenta main. is_protected y last_post_at se conservan entre escaneos.';
comment on column public.followed_accounts.is_protected is 'La ☆: nunca es candidata a dejar de seguir y sobrevive a escaneos nuevos.';

create index followed_accounts_owner_id_idx on public.followed_accounts (owner_id);
create index followed_accounts_instagram_account_id_owner_id_idx on public.followed_accounts (instagram_account_id, owner_id);
create index followed_accounts_last_seen_scan_id_owner_id_idx on public.followed_accounts (last_seen_scan_id, owner_id)
  where last_seen_scan_id is not null;
-- Candidatas a dejar de seguir.
create index followed_accounts_candidates_idx on public.followed_accounts (instagram_account_id, username)
  where follows_back = false and is_protected = false;

create trigger followed_accounts_set_updated_at
  before update on public.followed_accounts
  for each row execute function public.set_updated_at();

create trigger followed_accounts_check_account_role
  before insert or update of instagram_account_id on public.followed_accounts
  for each row execute function public.check_account_role('main');

-- -----------------------------------------------------------------------------
-- unfollow_actions: pestaña Historial
-- -----------------------------------------------------------------------------

create table public.unfollow_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  instagram_account_id uuid not null,
  ig_user_id text not null,
  username text not null,
  result public.unfollow_result not null,
  detail text,
  created_at timestamptz not null default now(),
  constraint unfollow_actions_instagram_account_fkey
    foreign key (instagram_account_id, owner_id)
    references public.instagram_accounts (id, owner_id) on delete cascade,
  constraint unfollow_actions_ig_user_id_format check (ig_user_id ~ '^[0-9]{1,30}$'),
  constraint unfollow_actions_username_format check (username ~ '^[a-z0-9._]{1,30}$'),
  constraint unfollow_actions_detail_length check (detail is null or char_length(detail) <= 1000)
);

comment on table public.unfollow_actions is 'Historial de unfollows; la ventana de 60 minutos sale de acá.';

create index unfollow_actions_owner_id_created_at_idx on public.unfollow_actions (owner_id, created_at desc);
create index unfollow_actions_instagram_account_id_owner_id_idx on public.unfollow_actions (instagram_account_id, owner_id);
-- Tope por hora e historial por cuenta.
create index unfollow_actions_account_created_at_idx on public.unfollow_actions (instagram_account_id, created_at desc);

create trigger unfollow_actions_check_account_role
  before insert or update of instagram_account_id on public.unfollow_actions
  for each row execute function public.check_account_role('main');
