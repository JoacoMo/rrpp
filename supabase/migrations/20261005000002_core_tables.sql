-- =============================================================================
-- RRPP Suite · 002 · cuenta, configuración, cuentas de Instagram y tokens
-- =============================================================================
-- Convenciones de todas las tablas de negocio:
--   * owner_id → profiles(id) on delete cascade (borrar el usuario borra todo).
--   * Las tablas que otras referencian con owner_id tienen unique (id, owner_id)
--     y los hijos usan FK compuesta (x_id, owner_id): así es imposible colgar
--     una fila de un padre de otro usuario.
--   * Solo escribe la API con la service role; RLS (migración 005) es la
--     segunda barrera para lecturas con JWT.

-- -----------------------------------------------------------------------------
-- profiles (1:1 con auth.users)
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  timezone text not null default 'America/Argentina/Cordoba',
  daily_analysis_limit smallint not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 80),
  constraint profiles_timezone_valid check (public.is_valid_timezone(timezone)),
  constraint profiles_daily_analysis_limit_range check (daily_analysis_limit between 0 and 1000)
);

comment on table public.profiles is 'Perfil del RRPP, 1:1 con auth.users. Lo crea handle_new_user al registrarse.';
comment on column public.profiles.timezone is 'Zona horaria IANA; corta los días de las cuotas diarias.';
comment on column public.profiles.daily_analysis_limit is 'Tope de análisis con Claude por día (control de costos). 0 = pausado.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- scoring_settings (1:1 con profiles)
-- -----------------------------------------------------------------------------

create table public.scoring_settings (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  cordoba_points smallint not null default 3,
  university_points smallint not null default 2,
  nightlife_points smallint not null default 3,
  mutuals_points smallint not null default 2,
  mutuals_threshold integer not null default 10,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scoring_settings_cordoba_points_range check (cordoba_points between 0 and 10),
  constraint scoring_settings_university_points_range check (university_points between 0 and 10),
  constraint scoring_settings_nightlife_points_range check (nightlife_points between 0 and 10),
  constraint scoring_settings_mutuals_points_range check (mutuals_points between 0 and 10),
  constraint scoring_settings_points_sum check (
    cordoba_points + university_points + nightlife_points + mutuals_points <= 10
  ),
  constraint scoring_settings_mutuals_threshold_range check (mutuals_threshold >= 0),
  constraint scoring_settings_version_positive check (version >= 1)
);

comment on table public.scoring_settings is 'Puntos por señal. version sube sola en cada cambio y queda registrada en cada análisis.';

-- La versión la maneja la base: sube 1 si cambió algún valor y no se puede pisar a mano.
create function public.bump_scoring_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.cordoba_points, new.university_points, new.nightlife_points, new.mutuals_points, new.mutuals_threshold)
     is distinct from
     (old.cordoba_points, old.university_points, old.nightlife_points, old.mutuals_points, old.mutuals_threshold)
  then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

create trigger scoring_settings_bump_version
  before update on public.scoring_settings
  for each row execute function public.bump_scoring_version();

create trigger scoring_settings_set_updated_at
  before update on public.scoring_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- instagram_accounts
-- -----------------------------------------------------------------------------

create table public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  username text not null,
  role public.ig_account_role not null,
  status public.ig_account_status not null default 'active',
  daily_profile_limit smallint not null default 45,
  min_delay_seconds smallint not null default 15,
  max_delay_seconds smallint not null default 45,
  paused_until timestamptz,
  last_error text,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_accounts_owner_id_username_key unique (owner_id, username),
  constraint instagram_accounts_id_owner_id_key unique (id, owner_id),
  constraint instagram_accounts_username_format check (username ~ '^[a-z0-9._]{1,30}$'),
  constraint instagram_accounts_daily_profile_limit_range check (daily_profile_limit between 1 and 50),
  constraint instagram_accounts_min_delay_range check (min_delay_seconds between 1 and 3600),
  constraint instagram_accounts_max_delay_range check (max_delay_seconds between 1 and 3600),
  constraint instagram_accounts_delay_order check (max_delay_seconds >= min_delay_seconds)
);

comment on table public.instagram_accounts is 'Cuentas de Instagram del RRPP: scraper (secundaria) o main (principal, extensión).';
comment on column public.instagram_accounts.paused_until is 'Freno automático: hasta cuándo no se reclaman perfiles (null con status paused = pausa manual).';

create trigger instagram_accounts_set_updated_at
  before update on public.instagram_accounts
  for each row execute function public.set_updated_at();

-- El rol no cambia: tokens, cargas y escaneos dependen de él.
create function public.prevent_account_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    raise exception using
      errcode = '23514',
      message = 'instagram_accounts.role cannot be changed',
      detail = format('account %s has role %s', old.id, old.role),
      table = 'instagram_accounts',
      column = 'role';
  end if;
  return new;
end;
$$;

create trigger instagram_accounts_role_immutable
  before update of role on public.instagram_accounts
  for each row execute function public.prevent_account_role_change();

-- Verifica que instagram_account_id apunte a una cuenta del rol esperado
-- (tg_argv[0]). Si la cuenta no existe, deja que falle la FK con su error.
create function public.check_account_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role public.ig_account_role;
begin
  select a.role into v_role
  from public.instagram_accounts a
  where a.id = new.instagram_account_id;

  if found and v_role <> tg_argv[0]::public.ig_account_role then
    raise exception using
      errcode = '23514',
      message = format('%s.instagram_account_id must reference an account with role %s', tg_table_name, tg_argv[0]),
      detail = format('account %s has role %s', new.instagram_account_id, v_role),
      table = tg_table_name,
      column = 'instagram_account_id';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- instagram_account_usage: contadores diarios atómicos
-- -----------------------------------------------------------------------------

create table public.instagram_account_usage (
  account_id uuid not null references public.instagram_accounts (id) on delete cascade,
  day date not null,
  profiles_visited integer not null default 0,
  unfollows integer not null default 0,
  primary key (account_id, day),
  constraint instagram_account_usage_profiles_visited_positive check (profiles_visited >= 0),
  constraint instagram_account_usage_unfollows_positive check (unfollows >= 0)
);

comment on table public.instagram_account_usage is 'Cuotas por cuenta y día (día en la zona horaria del dueño). Solo la tocan las funciones.';

-- -----------------------------------------------------------------------------
-- api_tokens: credenciales del scraper y de la extensión
-- -----------------------------------------------------------------------------

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  instagram_account_id uuid not null,
  kind public.token_kind not null,
  name text not null,
  token_prefix text not null,
  token_hash text not null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint api_tokens_token_hash_key unique (token_hash),
  constraint api_tokens_instagram_account_fkey
    foreign key (instagram_account_id, owner_id)
    references public.instagram_accounts (id, owner_id) on delete cascade,
  constraint api_tokens_name_length check (char_length(name) between 1 and 60),
  constraint api_tokens_token_prefix_length check (char_length(token_prefix) between 4 and 16),
  constraint api_tokens_token_hash_length check (char_length(token_hash) between 32 and 128)
);

comment on table public.api_tokens is 'Tokens del scraper y la extensión. Solo se guarda el hash; sin políticas RLS (invisible con JWT).';
comment on column public.api_tokens.token_hash is 'SHA-256 del token; el token en claro se muestra una sola vez.';

create index api_tokens_owner_id_created_at_idx on public.api_tokens (owner_id, created_at desc);
create index api_tokens_instagram_account_id_owner_id_idx on public.api_tokens (instagram_account_id, owner_id);

-- Un token scraper solo opera sobre una cuenta scraper; uno extension, sobre una main.
create function public.check_api_token_account()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role public.ig_account_role;
  v_expected public.ig_account_role;
begin
  v_expected := case new.kind when 'scraper' then 'scraper' else 'main' end::public.ig_account_role;

  select a.role into v_role
  from public.instagram_accounts a
  where a.id = new.instagram_account_id;

  if found and v_role <> v_expected then
    raise exception using
      errcode = '23514',
      message = format('api_tokens of kind %s require an account with role %s', new.kind, v_expected),
      detail = format('account %s has role %s', new.instagram_account_id, v_role),
      table = 'api_tokens',
      column = 'instagram_account_id';
  end if;
  return new;
end;
$$;

create trigger api_tokens_check_account
  before insert or update of kind, instagram_account_id on public.api_tokens
  for each row execute function public.check_api_token_account();

-- -----------------------------------------------------------------------------
-- Alta de usuario: crea el perfil y la configuración de puntaje por defecto
-- -----------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
        'usuario'
      ),
      80
    )
  );

  insert into public.scoring_settings (owner_id) values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Las funciones de trigger no se llaman por RPC.
revoke all on function public.bump_scoring_version() from public, anon, authenticated;
revoke all on function public.prevent_account_role_change() from public, anon, authenticated;
revoke all on function public.check_account_role() from public, anon, authenticated;
revoke all on function public.check_api_token_account() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
