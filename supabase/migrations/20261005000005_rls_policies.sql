-- =============================================================================
-- RRPP Suite · 005 · RLS y privilegios
-- =============================================================================
-- La API (service role, bypassrls) es la única que escribe. RLS es la segunda
-- barrera: con un JWT de usuario solo se pueden LEER las filas propias.
--   * RLS activado en todas las tablas de public.
--   * Solo políticas SELECT para authenticated; nada de insert/update/delete.
--   * api_tokens no tiene política: con JWT es invisible.
--   * auth.uid() va envuelto en (select ...) para que se evalúe una vez por
--     consulta y no por fila.

-- -----------------------------------------------------------------------------
-- RLS en todas las tablas
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.scoring_settings enable row level security;
alter table public.instagram_accounts enable row level security;
alter table public.instagram_account_usage enable row level security;
alter table public.api_tokens enable row level security;
alter table public.events enable row level security;
alter table public.scrape_jobs enable row level security;
alter table public.scrape_job_items enable row level security;
alter table public.prospects enable row level security;
alter table public.profile_snapshots enable row level security;
alter table public.prospect_analyses enable row level security;
alter table public.analysis_signals enable row level security;
alter table public.icebreakers enable row level security;
alter table public.interactions enable row level security;
alter table public.follow_scans enable row level security;
alter table public.follow_scan_chunks enable row level security;
alter table public.followed_accounts enable row level security;
alter table public.unfollow_actions enable row level security;

-- -----------------------------------------------------------------------------
-- Políticas de lectura
-- -----------------------------------------------------------------------------

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy scoring_settings_select_own on public.scoring_settings
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy instagram_accounts_select_own on public.instagram_accounts
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Sin owner_id propio: se mira la cuenta padre.
create policy instagram_account_usage_select_own on public.instagram_account_usage
  for select to authenticated
  using (
    exists (
      select 1
      from public.instagram_accounts a
      where a.id = instagram_account_usage.account_id
        and a.owner_id = (select auth.uid())
    )
  );

-- api_tokens: a propósito sin política.

create policy events_select_own on public.events
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy scrape_jobs_select_own on public.scrape_jobs
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy scrape_job_items_select_own on public.scrape_job_items
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy prospects_select_own on public.prospects
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy profile_snapshots_select_own on public.profile_snapshots
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy prospect_analyses_select_own on public.prospect_analyses
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Sin owner_id propio: se mira el análisis padre.
create policy analysis_signals_select_own on public.analysis_signals
  for select to authenticated
  using (
    exists (
      select 1
      from public.prospect_analyses a
      where a.id = analysis_signals.analysis_id
        and a.owner_id = (select auth.uid())
    )
  );

create policy icebreakers_select_own on public.icebreakers
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy interactions_select_own on public.interactions
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy follow_scans_select_own on public.follow_scans
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Sin owner_id propio: se mira el escaneo padre.
create policy follow_scan_chunks_select_own on public.follow_scan_chunks
  for select to authenticated
  using (
    exists (
      select 1
      from public.follow_scans s
      where s.id = follow_scan_chunks.scan_id
        and s.owner_id = (select auth.uid())
    )
  );

create policy followed_accounts_select_own on public.followed_accounts
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy unfollow_actions_select_own on public.unfollow_actions
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Privilegios
-- -----------------------------------------------------------------------------
-- Supabase da "all" a anon y authenticated en cada tabla nueva de public.
-- TRUNCATE no pasa por RLS, así que se recorta: anon no ve nada y
-- authenticated solo puede leer (filtrado por las políticas de arriba).
-- service_role conserva todo.

revoke all on all tables in schema public from anon, authenticated;

grant select on
  public.profiles,
  public.scoring_settings,
  public.instagram_accounts,
  public.instagram_account_usage,
  public.events,
  public.scrape_jobs,
  public.scrape_job_items,
  public.prospects,
  public.profile_snapshots,
  public.prospect_analyses,
  public.analysis_signals,
  public.icebreakers,
  public.interactions,
  public.follow_scans,
  public.follow_scan_chunks,
  public.followed_accounts,
  public.unfollow_actions
to authenticated;
