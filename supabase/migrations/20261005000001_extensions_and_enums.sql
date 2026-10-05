-- =============================================================================
-- RRPP Suite · 001 · extensiones, enums y helpers genéricos
-- =============================================================================
-- gen_random_uuid() es del core desde PG13, así que no hace falta pgcrypto.
-- Los @usuarios de Instagram van como text en minúscula (los normaliza la API)
-- y se validan con un check; por eso tampoco usamos citext.
-- pg_cron se habilita en la migración 007.

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type public.ig_account_role as enum ('scraper', 'main');
comment on type public.ig_account_role is 'scraper = cuenta secundaria que visita perfiles; main = cuenta principal (extensión)';

create type public.ig_account_status as enum ('active', 'paused', 'needs_login', 'blocked');

create type public.token_kind as enum ('scraper', 'extension');

create type public.job_status as enum ('queued', 'running', 'completed', 'cancelled');

create type public.item_status as enum (
  'queued', 'scraping', 'scraped', 'analyzing', 'done', 'skipped', 'failed'
);

create type public.prospect_status as enum (
  'new', 'contacted', 'seen', 'replied', 'bought_ticket', 'guest_list', 'discarded'
);

create type public.signal_key as enum (
  'cordoba', 'local_university', 'nightlife', 'mutual_followers', 'possible_minor'
);

create type public.interaction_type as enum (
  'message_sent', 'seen_no_reply', 'replied', 'ticket_purchased', 'guest_list', 'discarded', 'note'
);

create type public.scan_status as enum ('uploading', 'completed', 'failed');

create type public.unfollow_result as enum (
  'unfollowed', 'follows_back', 'already_unfollowed', 'failed', 'rate_limited'
);

-- -----------------------------------------------------------------------------
-- Helpers genéricos
-- -----------------------------------------------------------------------------

-- Mantiene updated_at en cada update (se engancha con un trigger BEFORE UPDATE).
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Valida que una zona horaria exista (la usan los checks de profiles).
-- Si se guarda una zona inválida se rompen todos los cortes de día, por eso se
-- valida en la base y no solo en la API.
create function public.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_tz is not null
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz);
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.is_valid_timezone(text) from public, anon, authenticated;
grant execute on function public.is_valid_timezone(text) to service_role;
