-- =============================================================================
-- RRPP Suite · 003 · prospección: eventos, cola de scraping, prospectos,
-- análisis, mensajes e interacciones
-- =============================================================================
-- Hay FKs circulares (items ⇄ snapshots, prospects ⇄ analyses): se crean las
-- tablas primero y esas FKs al final con alter table.
-- Las FKs nullables compuestas usan "on delete set null (col)" (PG15+) para
-- que al borrar el padre se anule solo la referencia y no el owner_id.

-- -----------------------------------------------------------------------------
-- events: fiestas, para contexto de los mensajes y atribución de ventas
-- -----------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  venue text,
  starts_at timestamptz,
  ticket_price numeric(10, 2),
  message_context text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_id_owner_id_key unique (id, owner_id),
  constraint events_name_length check (char_length(name) between 1 and 120),
  constraint events_venue_length check (venue is null or char_length(venue) <= 120),
  constraint events_ticket_price_positive check (ticket_price is null or ticket_price >= 0),
  constraint events_message_context_length check (message_context is null or char_length(message_context) <= 2000)
);

comment on table public.events is 'Fiestas: dan contexto a los mensajes (message_context) y atribuyen ventas.';

create index events_owner_id_starts_at_idx on public.events (owner_id, starts_at desc nulls last);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- scrape_jobs: una carga de @usuarios
-- -----------------------------------------------------------------------------

create table public.scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  instagram_account_id uuid not null,
  event_id uuid,
  status public.job_status not null default 'queued',
  total_items integer not null default 0,
  done_items integer not null default 0,
  failed_items integer not null default 0,
  skipped_items integer not null default 0,
  reanalyze_after_days smallint not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint scrape_jobs_id_owner_id_key unique (id, owner_id),
  constraint scrape_jobs_instagram_account_fkey
    foreign key (instagram_account_id, owner_id)
    references public.instagram_accounts (id, owner_id) on delete cascade,
  constraint scrape_jobs_event_fkey
    foreign key (event_id, owner_id)
    references public.events (id, owner_id) on delete set null (event_id),
  constraint scrape_jobs_counters_positive check (
    total_items >= 0 and done_items >= 0 and failed_items >= 0 and skipped_items >= 0
  ),
  constraint scrape_jobs_counters_le_total check (done_items + failed_items + skipped_items <= total_items),
  constraint scrape_jobs_reanalyze_after_days_range check (reanalyze_after_days between 0 and 365)
);

comment on table public.scrape_jobs is 'Cargas de @usuarios. Los contadores los mantiene refresh_job_progress.';

create index scrape_jobs_owner_id_created_at_idx on public.scrape_jobs (owner_id, created_at desc);
create index scrape_jobs_instagram_account_id_owner_id_idx on public.scrape_jobs (instagram_account_id, owner_id);
create index scrape_jobs_event_id_owner_id_idx on public.scrape_jobs (event_id, owner_id) where event_id is not null;
-- Jobs vivos por cuenta, en orden de llegada (lo usa claim_scrape_item).
create index scrape_jobs_active_by_account_idx on public.scrape_jobs (instagram_account_id, created_at)
  where status in ('queued', 'running');

create trigger scrape_jobs_set_updated_at
  before update on public.scrape_jobs
  for each row execute function public.set_updated_at();

create trigger scrape_jobs_check_account_role
  before insert or update of instagram_account_id on public.scrape_jobs
  for each row execute function public.check_account_role('scraper');

-- -----------------------------------------------------------------------------
-- prospects: una fila por persona y RRPP
-- -----------------------------------------------------------------------------

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  ig_username text not null,
  ig_user_id text,
  full_name text,
  biography text,
  followers_count integer,
  following_count integer,
  mutual_followers_count integer,
  is_private boolean not null default false,
  status public.prospect_status not null default 'new',
  current_score smallint,
  latest_analysis_id uuid,
  do_not_contact boolean not null default false,
  do_not_contact_reason text,
  notes text,
  last_scraped_at timestamptz,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospects_owner_id_ig_username_key unique (owner_id, ig_username),
  constraint prospects_id_owner_id_key unique (id, owner_id),
  constraint prospects_ig_username_format check (ig_username ~ '^[a-z0-9._]{1,30}$'),
  constraint prospects_ig_user_id_format check (ig_user_id is null or ig_user_id ~ '^[0-9]{1,30}$'),
  constraint prospects_counts_positive check (
    coalesce(followers_count, 0) >= 0
    and coalesce(following_count, 0) >= 0
    and coalesce(mutual_followers_count, 0) >= 0
  ),
  constraint prospects_current_score_range check (current_score is null or current_score between 0 and 10),
  constraint prospects_do_not_contact_reason_length check (
    do_not_contact_reason is null or char_length(do_not_contact_reason) <= 500
  ),
  constraint prospects_notes_length check (notes is null or char_length(notes) <= 5000)
);

comment on table public.prospects is 'Personas a contactar. ig_user_id sobrevive a cambios de @usuario.';
comment on column public.prospects.do_not_contact is 'true si es posible menor o si lo marcó el RRPP; nunca lo limpia un análisis.';

-- Un mismo id de Instagram no se repite por dueño.
create unique index prospects_owner_id_ig_user_id_key on public.prospects (owner_id, ig_user_id)
  where ig_user_id is not null;
-- Listado por puntaje (paginado por cursor) y por estado.
create index prospects_owner_id_current_score_idx on public.prospects (owner_id, current_score desc nulls last, id);
create index prospects_owner_id_status_idx on public.prospects (owner_id, status, current_score desc nulls last);

create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- scrape_job_items: la cola (un @usuario por item)
-- -----------------------------------------------------------------------------

create table public.scrape_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  username text not null,
  status public.item_status not null default 'queued',
  attempts smallint not null default 0,
  analysis_attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  error_code text,
  error_message text,
  locked_by text,
  locked_at timestamptz,
  prospect_id uuid,
  snapshot_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scrape_job_items_job_id_username_key unique (job_id, username),
  constraint scrape_job_items_id_owner_id_key unique (id, owner_id),
  constraint scrape_job_items_job_fkey
    foreign key (job_id, owner_id)
    references public.scrape_jobs (id, owner_id) on delete cascade,
  constraint scrape_job_items_prospect_fkey
    foreign key (prospect_id, owner_id)
    references public.prospects (id, owner_id) on delete set null (prospect_id),
  constraint scrape_job_items_username_format check (username ~ '^[a-z0-9._]{1,30}$'),
  constraint scrape_job_items_attempts_positive check (attempts >= 0),
  constraint scrape_job_items_analysis_attempts_positive check (analysis_attempts >= 0),
  -- tomado ⇔ tiene lock: así no quedan items trabados sin dueño ni locks colgados
  constraint scrape_job_items_lock_consistency check (
    (status in ('scraping', 'analyzing')) = (locked_by is not null and locked_at is not null)
  )
);

comment on table public.scrape_job_items is 'Cola de perfiles: queued → scraping → scraped → analyzing → done (o skipped/failed).';
comment on column public.scrape_job_items.next_attempt_at is 'Backoff: no se reclama antes de esta fecha (scraping y análisis).';
comment on column public.scrape_job_items.locked_at is 'Los locks de más de 10 min los libera release_stale_locks (pg_cron).';

create index scrape_job_items_job_id_owner_id_idx on public.scrape_job_items (job_id, owner_id);
create index scrape_job_items_owner_id_status_idx on public.scrape_job_items (owner_id, status);
create index scrape_job_items_prospect_id_owner_id_idx on public.scrape_job_items (prospect_id, owner_id)
  where prospect_id is not null;
create index scrape_job_items_snapshot_id_owner_id_idx on public.scrape_job_items (snapshot_id, owner_id)
  where snapshot_id is not null;
-- Cola del scraper: items listos de cada job, en orden de llegada.
create index scrape_job_items_scrape_queue_idx on public.scrape_job_items (job_id, created_at)
  where status = 'queued';
-- Cola del análisis.
create index scrape_job_items_analysis_queue_idx on public.scrape_job_items (next_attempt_at)
  where status = 'scraped';
-- Locks vivos (release_stale_locks).
create index scrape_job_items_locked_at_idx on public.scrape_job_items (locked_at)
  where status in ('scraping', 'analyzing');

create trigger scrape_job_items_set_updated_at
  before update on public.scrape_job_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- profile_snapshots: lo que se vio del perfil en cada visita
-- -----------------------------------------------------------------------------

create table public.profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null,
  job_item_id uuid,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  biography text,
  followers_count integer,
  following_count integer,
  mutual_followers_count integer,
  is_private boolean not null default false,
  posts jsonb not null default '[]'::jsonb,
  media_paths text[] not null default '{}'::text[],
  scraped_at timestamptz not null default now(),
  constraint profile_snapshots_id_owner_id_key unique (id, owner_id),
  constraint profile_snapshots_prospect_fkey
    foreign key (prospect_id, owner_id)
    references public.prospects (id, owner_id) on delete cascade,
  constraint profile_snapshots_job_item_fkey
    foreign key (job_item_id, owner_id)
    references public.scrape_job_items (id, owner_id) on delete set null (job_item_id),
  constraint profile_snapshots_counts_positive check (
    coalesce(followers_count, 0) >= 0
    and coalesce(following_count, 0) >= 0
    and coalesce(mutual_followers_count, 0) >= 0
  ),
  constraint profile_snapshots_posts_is_array check (jsonb_typeof(posts) = 'array'),
  constraint profile_snapshots_media_paths_valid check (
    cardinality(media_paths) <= 20 and array_position(media_paths, null) is null
  )
);

comment on table public.profile_snapshots is 'Foto del perfil en cada visita. media_paths se vacía al terminar el análisis.';
comment on column public.profile_snapshots.posts is '[{caption, taken_at, is_video}] de las últimas publicaciones, sin imágenes.';

create index profile_snapshots_prospect_id_owner_id_idx on public.profile_snapshots (prospect_id, owner_id, scraped_at desc);
create index profile_snapshots_owner_id_idx on public.profile_snapshots (owner_id);
create index profile_snapshots_job_item_id_owner_id_idx on public.profile_snapshots (job_item_id, owner_id)
  where job_item_id is not null;
-- Fotos pendientes de borrar (list_stale_media).
create index profile_snapshots_pending_media_idx on public.profile_snapshots (scraped_at)
  where media_paths <> '{}'::text[];

-- Cierre del ciclo items → snapshots.
alter table public.scrape_job_items
  add constraint scrape_job_items_snapshot_fkey
  foreign key (snapshot_id, owner_id)
  references public.profile_snapshots (id, owner_id) on delete set null (snapshot_id);

-- -----------------------------------------------------------------------------
-- prospect_analyses: resultado de Claude + puntaje calculado en código
-- -----------------------------------------------------------------------------

create table public.prospect_analyses (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null,
  snapshot_id uuid,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  model text not null,
  scoring_version integer not null,
  score smallint not null,
  summary text not null default '',
  interests text[] not null default '{}'::text[],
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  constraint prospect_analyses_id_owner_id_key unique (id, owner_id),
  constraint prospect_analyses_prospect_fkey
    foreign key (prospect_id, owner_id)
    references public.prospects (id, owner_id) on delete cascade,
  constraint prospect_analyses_snapshot_fkey
    foreign key (snapshot_id, owner_id)
    references public.profile_snapshots (id, owner_id) on delete set null (snapshot_id),
  constraint prospect_analyses_model_length check (char_length(model) between 1 and 100),
  constraint prospect_analyses_scoring_version_positive check (scoring_version >= 1),
  constraint prospect_analyses_score_range check (score between 0 and 10),
  constraint prospect_analyses_summary_length check (char_length(summary) <= 4000),
  constraint prospect_analyses_interests_valid check (
    cardinality(interests) <= 30 and array_position(interests, null) is null
  ),
  constraint prospect_analyses_tokens_positive check (input_tokens >= 0 and output_tokens >= 0)
);

comment on table public.prospect_analyses is 'Un análisis por snapshot: modelo, versión del puntaje, puntaje y tokens usados.';

create index prospect_analyses_prospect_id_owner_id_idx on public.prospect_analyses (prospect_id, owner_id, created_at desc);
create index prospect_analyses_snapshot_id_owner_id_idx on public.prospect_analyses (snapshot_id, owner_id)
  where snapshot_id is not null;
-- Cuota diaria de análisis por dueño.
create index prospect_analyses_owner_id_created_at_idx on public.prospect_analyses (owner_id, created_at);

-- Cierre del ciclo prospects → analyses.
alter table public.prospects
  add constraint prospects_latest_analysis_fkey
  foreign key (latest_analysis_id, owner_id)
  references public.prospect_analyses (id, owner_id) on delete set null (latest_analysis_id);

create index prospects_latest_analysis_id_owner_id_idx on public.prospects (latest_analysis_id, owner_id)
  where latest_analysis_id is not null;

-- -----------------------------------------------------------------------------
-- analysis_signals: una fila por señal, para filtrar y medir
-- -----------------------------------------------------------------------------

create table public.analysis_signals (
  analysis_id uuid not null references public.prospect_analyses (id) on delete cascade,
  signal public.signal_key not null,
  detected boolean not null,
  evidence text,
  points smallint not null default 0,
  primary key (analysis_id, signal),
  constraint analysis_signals_points_range check (points between 0 and 10),
  constraint analysis_signals_evidence_length check (evidence is null or char_length(evidence) <= 1000)
);

comment on table public.analysis_signals is 'Señales detectadas por Claude con su evidencia y los puntos que aportaron.';

-- -----------------------------------------------------------------------------
-- icebreakers: mensajes de apertura propuestos
-- -----------------------------------------------------------------------------

create table public.icebreakers (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null,
  analysis_id uuid,
  event_id uuid,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  batch smallint not null default 1,
  position smallint not null default 1,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint icebreakers_id_owner_id_key unique (id, owner_id),
  constraint icebreakers_prospect_fkey
    foreign key (prospect_id, owner_id)
    references public.prospects (id, owner_id) on delete cascade,
  constraint icebreakers_analysis_fkey
    foreign key (analysis_id, owner_id)
    references public.prospect_analyses (id, owner_id) on delete set null (analysis_id),
  constraint icebreakers_event_fkey
    foreign key (event_id, owner_id)
    references public.events (id, owner_id) on delete set null (event_id),
  constraint icebreakers_body_length check (char_length(body) between 1 and 1000),
  constraint icebreakers_batch_positive check (batch >= 1),
  constraint icebreakers_position_positive check (position >= 1)
);

comment on table public.icebreakers is 'Mensajes de apertura. batch 1 = los del análisis; cada "regenerar" suma 1. position = orden dentro del lote.';

create index icebreakers_prospect_id_owner_id_idx on public.icebreakers (prospect_id, owner_id, batch desc, position);
create index icebreakers_owner_id_idx on public.icebreakers (owner_id);
create index icebreakers_analysis_id_owner_id_idx on public.icebreakers (analysis_id, owner_id)
  where analysis_id is not null;
create index icebreakers_event_id_owner_id_idx on public.icebreakers (event_id, owner_id)
  where event_id is not null;

-- -----------------------------------------------------------------------------
-- interactions: historial y conversión
-- -----------------------------------------------------------------------------

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid,
  type public.interaction_type not null,
  from_status public.prospect_status not null,
  to_status public.prospect_status not null,
  icebreaker_id uuid,
  amount numeric(10, 2),
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint interactions_prospect_fkey
    foreign key (prospect_id, owner_id)
    references public.prospects (id, owner_id) on delete cascade,
  constraint interactions_event_fkey
    foreign key (event_id, owner_id)
    references public.events (id, owner_id) on delete set null (event_id),
  constraint interactions_icebreaker_fkey
    foreign key (icebreaker_id, owner_id)
    references public.icebreakers (id, owner_id) on delete set null (icebreaker_id),
  constraint interactions_amount_positive check (amount is null or amount >= 0),
  constraint interactions_amount_only_tickets check (amount is null or type = 'ticket_purchased'),
  constraint interactions_note_length check (note is null or char_length(note) <= 2000)
);

comment on table public.interactions is 'Historial por prospecto con la transición de estado aplicada (from_status → to_status).';

create index interactions_prospect_id_owner_id_idx on public.interactions (prospect_id, owner_id, occurred_at desc);
-- Embudo por evento y tipo.
create index interactions_owner_id_event_id_type_idx on public.interactions (owner_id, event_id, type);
create index interactions_event_id_owner_id_idx on public.interactions (event_id, owner_id)
  where event_id is not null;
create index interactions_icebreaker_id_owner_id_idx on public.interactions (icebreaker_id, owner_id)
  where icebreaker_id is not null;
