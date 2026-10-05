-- =============================================================================
-- RRPP Suite · 006 · funciones (RPC): colas, cuotas, transiciones y escaneos
-- =============================================================================
-- Reglas comunes:
--   * security invoker + search_path vacío; todo nombre va calificado.
--   * Devuelven jsonb y corren en una sola transacción (la de la llamada).
--   * Errores de dominio: errcode P0001, message = código UPPER_SNAKE y detail
--     legible. Códigos: ACCOUNT_NOT_FOUND, ITEM_NOT_FOUND, ITEM_NOT_CLAIMED,
--     PROSPECT_NOT_FOUND, EVENT_NOT_FOUND, ICEBREAKER_NOT_FOUND, JOB_NOT_FOUND,
--     INVALID_TRANSITION, SCAN_NOT_FOUND, SCAN_NOT_UPLOADING, SCAN_INCOMPLETE,
--     INVALID_ARGUMENT.
--   * Solo las ejecuta service_role (grants al final).
-- Orden de locks (para no generar deadlocks): cuenta → item → prospecto → job.

-- =============================================================================
-- Helpers
-- =============================================================================

-- Día calendario en la zona horaria del dueño.
create function public.local_day(p_tz text, p_at timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone p_tz)::date;
$$;

-- Medianoche local (como timestamptz) del día de p_at.
create function public.local_day_start(p_tz text, p_at timestamptz default now())
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((p_at at time zone p_tz)::date)::timestamp at time zone p_tz;
$$;

-- Recalcula los contadores del job desde sus items y lo cierra si no queda
-- nada pendiente. Si un job completado recibe items nuevos, se reabre.
create function public.refresh_job_progress(p_job_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_found boolean;
  v_total integer;
  v_done integer;
  v_failed integer;
  v_skipped integer;
  v_active integer;
begin
  -- Primero el lock del job: así el conteo de abajo (otra sentencia, otro
  -- snapshot) ve lo último que commitearon los demás workers.
  perform 1 from public.scrape_jobs j where j.id = p_job_id for no key update;
  v_found := found;
  if not v_found then
    return;
  end if;

  select
    count(*),
    count(*) filter (where i.status = 'done'),
    count(*) filter (where i.status = 'failed'),
    count(*) filter (where i.status = 'skipped'),
    count(*) filter (where i.status in ('queued', 'scraping', 'scraped', 'analyzing'))
  into v_total, v_done, v_failed, v_skipped, v_active
  from public.scrape_job_items i
  where i.job_id = p_job_id;

  update public.scrape_jobs j set
    total_items = v_total,
    done_items = v_done,
    failed_items = v_failed,
    skipped_items = v_skipped,
    status = case
      when v_active = 0 and j.status in ('queued', 'running') then 'completed'::public.job_status
      when v_active > 0 and j.status = 'completed' then
        case when j.started_at is null then 'queued'::public.job_status else 'running'::public.job_status end
      else j.status
    end,
    finished_at = case
      when v_active = 0 and j.status in ('queued', 'running') then now()
      when v_active > 0 and j.status = 'completed' then null
      else j.finished_at
    end
  where j.id = p_job_id;
end;
$$;

-- =============================================================================
-- Triggers de la cola
-- =============================================================================

-- Al insertar items (la API los crea en bloque) se recalculan los contadores
-- de cada job tocado; un job con todo salteado queda completo en el acto.
create function public.handle_scrape_job_items_inserted()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  for v_job_id in
    select distinct n.job_id from new_items n order by n.job_id
  loop
    perform public.refresh_job_progress(v_job_id);
  end loop;
  return null;
end;
$$;

create trigger scrape_job_items_refresh_jobs
  after insert on public.scrape_job_items
  referencing new table as new_items
  for each statement execute function public.handle_scrape_job_items_inserted();

-- Borrar un prospecto (derecho de supresión) corta el trabajo pendiente sobre
-- esa persona: sus items sin terminar pasan a skipped para que no se analicen
-- ni se vuelva a crear el prospecto. Las fotos en Storage las borra la API.
-- Los items se desvinculan acá mismo (prospect_id y snapshot_id a null): si
-- quedaran apuntando, el cascade posterior revisaría sus FKs con el snapshot
-- ya borrado.
create function public.handle_prospect_deleted()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  for v_job_id in
    with skipped as (
      update public.scrape_job_items i set
        status = 'skipped',
        error_code = 'prospect_deleted',
        error_message = null,
        locked_by = null,
        locked_at = null,
        prospect_id = null,
        snapshot_id = null
      where i.owner_id = old.owner_id
        and (
          i.prospect_id = old.id
          or (i.prospect_id is null and i.username = old.ig_username)
        )
        and i.status in ('queued', 'scraping', 'scraped', 'analyzing')
      returning i.job_id
    )
    select distinct s.job_id from skipped s order by s.job_id
  loop
    perform public.refresh_job_progress(v_job_id);
  end loop;
  return old;
end;
$$;

create trigger prospects_skip_pending_items
  before delete on public.prospects
  for each row execute function public.handle_prospect_deleted();

-- =============================================================================
-- Scraper (cuenta secundaria)
-- =============================================================================

-- Reclama el próximo perfil de la cola de una cuenta scraper, respetando pausa,
-- estado de la cuenta y cuota diaria. Si no puede, dice por qué y cuánto esperar.
create function public.claim_scrape_item(p_account_id uuid, p_worker_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account public.instagram_accounts%rowtype;
  v_tz text;
  v_today date;
  v_visited integer;
  v_item public.scrape_job_items%rowtype;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' or char_length(p_worker_id) > 200 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_worker_id is required (max 200 chars)';
  end if;

  -- Lock de la cuenta: serializa los claims de una misma cuenta (cuota exacta).
  select * into v_account
  from public.instagram_accounts a
  where a.id = p_account_id
  for no key update;

  if not found or v_account.role <> 'scraper' then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_FOUND',
      detail = format('scraper account %s not found', p_account_id);
  end if;

  -- Señal de vida y fin de pausa vencida, en un solo update.
  update public.instagram_accounts a set
    last_heartbeat_at = now(),
    status = case
      when a.status = 'paused' and a.paused_until <= now() then 'active'::public.ig_account_status
      else a.status
    end,
    last_error = case when a.status = 'paused' and a.paused_until <= now() then null else a.last_error end,
    paused_until = case when a.status = 'paused' and a.paused_until <= now() then null else a.paused_until end
  where a.id = v_account.id
  returning * into v_account;

  if v_account.status = 'paused' then
    return jsonb_build_object(
      'status', 'wait',
      'reason', 'account_paused',
      'retry_after_seconds', case
        when v_account.paused_until is null then 300
        else greatest(1, ceil(extract(epoch from (v_account.paused_until - now())))::integer)
      end
    );
  elsif v_account.status = 'needs_login' then
    return jsonb_build_object('status', 'wait', 'reason', 'account_needs_login', 'retry_after_seconds', 300);
  elsif v_account.status = 'blocked' then
    return jsonb_build_object('status', 'wait', 'reason', 'account_blocked', 'retry_after_seconds', 300);
  end if;

  select p.timezone into v_tz from public.profiles p where p.id = v_account.owner_id;
  v_today := public.local_day(v_tz);

  select u.profiles_visited into v_visited
  from public.instagram_account_usage u
  where u.account_id = v_account.id and u.day = v_today;
  v_visited := coalesce(v_visited, 0);

  if v_visited >= v_account.daily_profile_limit then
    return jsonb_build_object(
      'status', 'wait',
      'reason', 'daily_limit',
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (((v_today + 1)::timestamp at time zone v_tz) - now())))::integer
      )
    );
  end if;

  -- El item queued más viejo de los jobs vivos de la cuenta.
  select i.* into v_item
  from public.scrape_job_items i
  join public.scrape_jobs j on j.id = i.job_id
  where j.instagram_account_id = v_account.id
    and j.status in ('queued', 'running')
    and i.status = 'queued'
    and i.next_attempt_at <= now()
  order by j.created_at, i.created_at, i.id
  limit 1
  for update of i skip locked;

  if not found then
    return jsonb_build_object('status', 'wait', 'reason', 'queue_empty', 'retry_after_seconds', 30);
  end if;

  update public.scrape_job_items i set
    status = 'scraping',
    attempts = i.attempts + 1,
    locked_by = p_worker_id,
    locked_at = now()
  where i.id = v_item.id
  returning * into v_item;

  update public.scrape_jobs j set
    status = 'running',
    started_at = coalesce(j.started_at, now())
  where j.id = v_item.job_id
    and (j.status = 'queued' or (j.status = 'running' and j.started_at is null));

  insert into public.instagram_account_usage as u (account_id, day, profiles_visited)
  values (v_account.id, v_today, 1)
  on conflict (account_id, day) do update set profiles_visited = u.profiles_visited + 1
  returning u.profiles_visited into v_visited;

  return jsonb_build_object(
    'status', 'claimed',
    'item', jsonb_build_object(
      'id', v_item.id,
      'job_id', v_item.job_id,
      'owner_id', v_item.owner_id,
      'username', v_item.username,
      'attempts', v_item.attempts
    ),
    'pacing', jsonb_build_object(
      'min_delay_seconds', v_account.min_delay_seconds,
      'max_delay_seconds', v_account.max_delay_seconds
    ),
    'remaining_today', greatest(v_account.daily_profile_limit - v_visited, 0)
  );
end;
$$;

-- Guarda lo que vio el scraper: upsert del prospecto, snapshot nuevo e item a
-- scraped. Idempotente: si el resultado ya estaba guardado devuelve los mismos ids.
create function public.record_scrape_result(
  p_item_id uuid,
  p_worker_id text,
  p_profile jsonb,
  p_media_paths text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.scrape_job_items%rowtype;
  v_ig_user_id text;
  v_full_name text;
  v_biography text;
  v_followers integer;
  v_following integer;
  v_mutuals integer;
  v_is_private boolean;
  v_posts_in jsonb;
  v_posts jsonb;
  v_media text[];
  v_prospect_id uuid;
  v_snapshot_id uuid;
  v_try integer;
begin
  select * into v_item from public.scrape_job_items i where i.id = p_item_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ITEM_NOT_FOUND',
      detail = format('scrape item %s not found', p_item_id);
  end if;

  -- Reintento de un resultado ya guardado: misma respuesta, sin cambios.
  if v_item.snapshot_id is not null and v_item.status in ('scraped', 'analyzing', 'done') then
    return jsonb_build_object(
      'status', 'scraped',
      'prospect_id', v_item.prospect_id,
      'snapshot_id', v_item.snapshot_id
    );
  end if;

  if v_item.status <> 'scraping' or v_item.locked_by is distinct from p_worker_id then
    raise exception using errcode = 'P0001', message = 'ITEM_NOT_CLAIMED',
      detail = format('item %s is %s and is not claimed by this worker', p_item_id, v_item.status);
  end if;

  -- Validación del perfil.
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_profile must be a JSON object';
  end if;

  v_posts_in := p_profile -> 'posts';
  if v_posts_in is null or jsonb_typeof(v_posts_in) = 'null' then
    v_posts_in := '[]'::jsonb;
  elsif jsonb_typeof(v_posts_in) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_profile.posts must be an array';
  elsif jsonb_array_length(v_posts_in) > 12
     or exists (select 1 from jsonb_array_elements(v_posts_in) e where jsonb_typeof(e) <> 'object') then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_profile.posts must hold up to 12 objects';
  end if;

  begin
    v_ig_user_id := nullif(btrim(p_profile ->> 'ig_user_id'), '');
    v_full_name := nullif(p_profile ->> 'full_name', '');
    v_biography := nullif(p_profile ->> 'biography', '');
    v_followers := (p_profile ->> 'followers_count')::integer;
    v_following := (p_profile ->> 'following_count')::integer;
    v_mutuals := (p_profile ->> 'mutual_followers_count')::integer;
    v_is_private := coalesce((p_profile ->> 'is_private')::boolean, false);

    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'caption', p.value ->> 'caption',
                 'taken_at', (p.value ->> 'taken_at')::timestamptz,
                 'is_video', coalesce((p.value ->> 'is_video')::boolean, false)
               )
               order by p.ordinality
             ),
             '[]'::jsonb
           )
      into v_posts
      from jsonb_array_elements(v_posts_in) with ordinality as p(value, ordinality);
  exception
    when data_exception then
      raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
        detail = format('invalid p_profile: %s', sqlerrm);
  end;

  if v_ig_user_id is not null and v_ig_user_id !~ '^[0-9]{1,30}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_profile.ig_user_id must be numeric';
  end if;

  if v_followers < 0 or v_following < 0 or v_mutuals < 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_profile counts must be >= 0';
  end if;

  -- Las rutas tienen que vivir bajo la carpeta del dueño: el worker después
  -- borra esos archivos y no puede tocar los de otro usuario.
  v_media := coalesce(p_media_paths, '{}'::text[]);
  if cardinality(v_media) > 20 or exists (
    select 1
    from unnest(v_media) as m(path)
    where m.path is null
       or m.path !~ ('^' || v_item.owner_id::text || '/[A-Za-z0-9._/-]{1,200}$')
       or m.path ~ '(^|/)\.{1,2}(/|$)'
       or m.path ~ '//'
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = format('p_media_paths must be up to 20 paths under %s/', v_item.owner_id);
  end if;

  -- Upsert del prospecto: primero por ig_user_id (sobrevive a cambios de
  -- @usuario), después por @usuario. Si otro worker lo inserta en paralelo,
  -- el insert no hace nada y se vuelve a buscar.
  for v_try in 1..3 loop
    v_prospect_id := null;

    if v_ig_user_id is not null then
      select p.id into v_prospect_id
      from public.prospects p
      where p.owner_id = v_item.owner_id and p.ig_user_id = v_ig_user_id
      for update;
    end if;

    if v_prospect_id is null then
      select p.id into v_prospect_id
      from public.prospects p
      where p.owner_id = v_item.owner_id and p.ig_username = v_item.username
      for update;
    end if;

    exit when v_prospect_id is not null;

    insert into public.prospects (owner_id, ig_username, ig_user_id)
    values (v_item.owner_id, v_item.username, v_ig_user_id)
    on conflict do nothing
    returning id into v_prospect_id;

    exit when v_prospect_id is not null;
  end loop;

  if v_prospect_id is null then
    raise exception using errcode = '40001', message = 'concurrent prospect upsert, retry',
      detail = format('owner %s, username %s', v_item.owner_id, v_item.username);
  end if;

  update public.prospects p set
    ig_user_id = coalesce(v_ig_user_id, p.ig_user_id),
    -- Cambio de @usuario detectado por ig_user_id: se actualiza solo si
    -- ninguna otra fila del dueño ya usa ese @usuario.
    ig_username = case
      when p.ig_username = v_item.username then p.ig_username
      when exists (
        select 1 from public.prospects o
        where o.owner_id = p.owner_id and o.ig_username = v_item.username and o.id <> p.id
      ) then p.ig_username
      else v_item.username
    end,
    full_name = v_full_name,
    biography = v_biography,
    followers_count = v_followers,
    following_count = v_following,
    mutual_followers_count = v_mutuals,
    is_private = v_is_private,
    last_scraped_at = now()
  where p.id = v_prospect_id;

  insert into public.profile_snapshots (
    prospect_id, job_item_id, owner_id, biography,
    followers_count, following_count, mutual_followers_count, is_private,
    posts, media_paths
  )
  values (
    v_prospect_id, v_item.id, v_item.owner_id, v_biography,
    v_followers, v_following, v_mutuals, v_is_private,
    v_posts, v_media
  )
  returning id into v_snapshot_id;

  update public.scrape_job_items i set
    status = 'scraped',
    prospect_id = v_prospect_id,
    snapshot_id = v_snapshot_id,
    locked_by = null,
    locked_at = null,
    error_code = null,
    error_message = null,
    next_attempt_at = now()
  where i.id = v_item.id;

  perform public.refresh_job_progress(v_item.job_id);

  return jsonb_build_object(
    'status', 'scraped',
    'prospect_id', v_prospect_id,
    'snapshot_id', v_snapshot_id
  );
end;
$$;

-- Error del scraper. Según el código: falla definitiva, reintento con backoff
-- o freno de la cuenta (el item vuelve a la cola sin gastar intento).
create function public.fail_scrape_item(
  p_item_id uuid,
  p_worker_id text,
  p_code text,
  p_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_account public.instagram_accounts%rowtype;
  v_item public.scrape_job_items%rowtype;
  v_status public.item_status;
  v_attempts smallint;
  v_next_attempt_at timestamptz := now();
  v_message text := left(nullif(btrim(p_message), ''), 1000);
begin
  select j.instagram_account_id into v_account_id
  from public.scrape_job_items i
  join public.scrape_jobs j on j.id = i.job_id
  where i.id = p_item_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ITEM_NOT_FOUND',
      detail = format('scrape item %s not found', p_item_id);
  end if;

  if p_code is null or p_code not in ('not_found', 'transient', 'rate_limited', 'challenge', 'login_required') then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = format('unknown failure code %s', coalesce(p_code, 'null'));
  end if;

  -- Mismo orden de locks que claim_scrape_item: cuenta → item.
  select * into v_account from public.instagram_accounts a where a.id = v_account_id for no key update;

  select * into v_item from public.scrape_job_items i where i.id = p_item_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ITEM_NOT_FOUND',
      detail = format('scrape item %s not found', p_item_id);
  end if;

  if v_item.status <> 'scraping' or v_item.locked_by is distinct from p_worker_id then
    raise exception using errcode = 'P0001', message = 'ITEM_NOT_CLAIMED',
      detail = format('item %s is %s and is not claimed by this worker', p_item_id, v_item.status);
  end if;

  v_attempts := v_item.attempts;

  case p_code
    when 'not_found' then
      v_status := 'failed';

    when 'transient' then
      if v_item.attempts >= 3 then
        v_status := 'failed';
      else
        -- backoff exponencial: 4, 16 minutos
        v_status := 'queued';
        v_next_attempt_at := now() + make_interval(mins => power(4, v_item.attempts)::integer);
      end if;

    when 'rate_limited' then
      v_status := 'queued';
      v_attempts := greatest(v_item.attempts - 1, 0);
      update public.instagram_accounts a set
        status = 'paused',
        paused_until = greatest(coalesce(a.paused_until, now()), now() + interval '3 hours'),
        last_error = left('rate_limited' || coalesce(': ' || v_message, ''), 1000)
      where a.id = v_account_id
        and a.status in ('active', 'paused');

    else -- challenge | login_required
      v_status := 'queued';
      v_attempts := greatest(v_item.attempts - 1, 0);
      update public.instagram_accounts a set
        status = 'needs_login',
        last_error = left(p_code || coalesce(': ' || v_message, ''), 1000)
      where a.id = v_account_id
        and a.status <> 'blocked';
  end case;

  update public.scrape_job_items i set
    status = v_status,
    attempts = v_attempts,
    next_attempt_at = v_next_attempt_at,
    error_code = p_code,
    error_message = v_message,
    locked_by = null,
    locked_at = null
  where i.id = v_item.id;

  perform public.refresh_job_progress(v_item.job_id);

  select * into v_account from public.instagram_accounts a where a.id = v_account_id;

  return jsonb_build_object(
    'item_status', v_status,
    'account_status', v_account.status,
    'paused_until', v_account.paused_until
  );
end;
$$;

-- =============================================================================
-- Worker de análisis
-- =============================================================================

-- Reclama un perfil ya extraído para analizar, respetando la cuota diaria de
-- análisis del dueño (cuenta los análisis de hoy más los que están en curso).
create function public.claim_analysis_item(p_worker_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.scrape_job_items%rowtype;
  v_profile public.profiles%rowtype;
  v_used bigint;
  v_prospect jsonb;
  v_snapshot jsonb;
  v_event jsonb;
  v_scoring jsonb;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' or char_length(p_worker_id) > 200 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_worker_id is required (max 200 chars)';
  end if;

  with pending_owners as (
    select distinct i.owner_id
    from public.scrape_job_items i
    where i.status = 'scraped' and i.next_attempt_at <= now()
  ),
  eligible_owners as (
    select p.id
    from pending_owners o
    join public.profiles p on p.id = o.owner_id
    where (
        select count(*) from public.prospect_analyses a
        where a.owner_id = p.id and a.created_at >= public.local_day_start(p.timezone)
      ) + (
        select count(*) from public.scrape_job_items b
        where b.owner_id = p.id and b.status = 'analyzing'
      ) < p.daily_analysis_limit
  )
  select i.* into v_item
  from public.scrape_job_items i
  where i.status = 'scraped'
    and i.next_attempt_at <= now()
    and i.prospect_id is not null
    and i.snapshot_id is not null
    and i.owner_id in (select e.id from eligible_owners e)
  order by i.next_attempt_at, i.created_at, i.id
  limit 1
  for update of i skip locked;

  if not found then
    return jsonb_build_object('status', 'empty');
  end if;

  -- Serializa por dueño y vuelve a mirar la cuota: dos workers en paralelo no
  -- pueden pasarse del tope.
  select * into v_profile from public.profiles p where p.id = v_item.owner_id for no key update;

  select (
      select count(*) from public.prospect_analyses a
      where a.owner_id = v_profile.id and a.created_at >= public.local_day_start(v_profile.timezone)
    ) + (
      select count(*) from public.scrape_job_items b
      where b.owner_id = v_profile.id and b.status = 'analyzing'
    )
  into v_used;

  if v_used >= v_profile.daily_analysis_limit then
    return jsonb_build_object('status', 'empty');
  end if;

  update public.scrape_job_items i set
    status = 'analyzing',
    analysis_attempts = i.analysis_attempts + 1,
    locked_by = p_worker_id,
    locked_at = now()
  where i.id = v_item.id
  returning * into v_item;

  select jsonb_build_object(
           'id', p.id,
           'ig_username', p.ig_username,
           'full_name', p.full_name,
           'biography', p.biography,
           'followers_count', p.followers_count,
           'following_count', p.following_count,
           'mutual_followers_count', p.mutual_followers_count,
           'is_private', p.is_private
         )
    into v_prospect
    from public.prospects p
   where p.id = v_item.prospect_id;

  select jsonb_build_object(
           'id', s.id,
           'posts', s.posts,
           'media_paths', to_jsonb(s.media_paths)
         )
    into v_snapshot
    from public.profile_snapshots s
   where s.id = v_item.snapshot_id;

  select jsonb_build_object(
           'id', e.id,
           'name', e.name,
           'message_context', e.message_context
         )
    into v_event
    from public.scrape_jobs j
    join public.events e on e.id = j.event_id
   where j.id = v_item.job_id;

  -- Si faltara la configuración (no debería), se crea con los valores por defecto.
  insert into public.scoring_settings (owner_id) values (v_item.owner_id)
  on conflict (owner_id) do nothing;

  select jsonb_build_object(
           'cordoba_points', s.cordoba_points,
           'university_points', s.university_points,
           'nightlife_points', s.nightlife_points,
           'mutuals_points', s.mutuals_points,
           'mutuals_threshold', s.mutuals_threshold,
           'version', s.version
         )
    into v_scoring
    from public.scoring_settings s
   where s.owner_id = v_item.owner_id;

  return jsonb_build_object(
    'status', 'claimed',
    'item', jsonb_build_object(
      'id', v_item.id,
      'job_id', v_item.job_id,
      'owner_id', v_item.owner_id,
      'username', v_item.username,
      'analysis_attempts', v_item.analysis_attempts
    ),
    'prospect', v_prospect,
    'snapshot', v_snapshot,
    'event', v_event,
    'scoring', v_scoring
  );
end;
$$;

-- Guarda el análisis, sus señales y los mensajes; actualiza el prospecto, vacía
-- las rutas de fotos del snapshot y cierra el item. Idempotente.
create function public.complete_analysis(p_item_id uuid, p_worker_id text, p_result jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.scrape_job_items%rowtype;
  v_prospect public.prospects%rowtype;
  v_existing_id uuid;
  v_existing_prospect_id uuid;
  v_existing_score smallint;
  v_model text;
  v_scoring_version integer;
  v_score integer;
  v_summary text;
  v_interests_in jsonb;
  v_interests text[];
  v_input_tokens integer;
  v_output_tokens integer;
  v_dnc boolean;
  v_dnc_reason text;
  v_signals jsonb;
  v_icebreakers jsonb;
  v_bad integer;
  v_dupes integer;
  v_analysis_id uuid;
  v_event_id uuid;
  v_batch integer;
begin
  select * into v_item from public.scrape_job_items i where i.id = p_item_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ITEM_NOT_FOUND',
      detail = format('scrape item %s not found', p_item_id);
  end if;

  -- Reintento de un análisis ya guardado: misma respuesta, sin cambios.
  if v_item.status = 'done' then
    select a.id, a.prospect_id, a.score
      into v_existing_id, v_existing_prospect_id, v_existing_score
      from public.prospect_analyses a
     where a.snapshot_id = v_item.snapshot_id
     order by a.created_at desc
     limit 1;

    if v_existing_id is null then
      raise exception using errcode = 'P0001', message = 'PROSPECT_NOT_FOUND',
        detail = format('the analysis of item %s no longer exists', p_item_id);
    end if;

    return jsonb_build_object(
      'analysis_id', v_existing_id,
      'prospect_id', v_existing_prospect_id,
      'score', v_existing_score
    );
  end if;

  if v_item.status <> 'analyzing' or v_item.locked_by is distinct from p_worker_id then
    raise exception using errcode = 'P0001', message = 'ITEM_NOT_CLAIMED',
      detail = format('item %s is %s and is not claimed by this worker', p_item_id, v_item.status);
  end if;

  -- Validación del resultado.
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result must be a JSON object';
  end if;

  begin
    v_model := nullif(btrim(p_result ->> 'model'), '');
    v_scoring_version := (p_result ->> 'scoring_version')::integer;
    v_score := (p_result ->> 'score')::integer;
    v_summary := coalesce(btrim(p_result ->> 'summary'), '');
    v_input_tokens := coalesce((p_result ->> 'input_tokens')::integer, 0);
    v_output_tokens := coalesce((p_result ->> 'output_tokens')::integer, 0);
    v_dnc := coalesce((p_result ->> 'do_not_contact')::boolean, false);
    v_dnc_reason := left(nullif(btrim(p_result ->> 'do_not_contact_reason'), ''), 500);
  exception
    when data_exception then
      raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
        detail = format('invalid p_result: %s', sqlerrm);
  end;

  if v_model is null or char_length(v_model) > 100 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.model is required (max 100 chars)';
  end if;
  if v_scoring_version is null or v_scoring_version < 1 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.scoring_version must be >= 1';
  end if;
  if v_score is null or v_score not between 0 and 10 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.score must be between 0 and 10';
  end if;
  if char_length(v_summary) > 4000 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.summary is too long (max 4000 chars)';
  end if;
  if v_input_tokens < 0 or v_output_tokens < 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result token counts must be >= 0';
  end if;

  -- interests: array de strings
  v_interests_in := coalesce(nullif(p_result -> 'interests', 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(v_interests_in) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.interests must be an array of strings';
  end if;
  if jsonb_array_length(v_interests_in) > 30
     or exists (select 1 from jsonb_array_elements(v_interests_in) e where jsonb_typeof(e) <> 'string') then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.interests must be an array of up to 30 strings';
  end if;
  v_interests := array(
    select btrim(e.value)
    from jsonb_array_elements_text(v_interests_in) with ordinality as e(value, ordinality)
    where btrim(e.value) <> ''
    order by e.ordinality
  );

  -- signals: array de objetos {signal, detected, evidence, points}
  v_signals := coalesce(nullif(p_result -> 'signals', 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(v_signals) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.signals must be an array';
  end if;
  if exists (select 1 from jsonb_array_elements(v_signals) e where jsonb_typeof(e) <> 'object') then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.signals must hold objects';
  end if;

  begin
    select
      count(*) filter (
        where s.signal is null
           or not (s.signal = any (enum_range(null::public.signal_key)::text[]))
           or s.detected is null
           or coalesce(s.points, 0) not between 0 and 10
           or char_length(coalesce(s.evidence, '')) > 1000
      ),
      count(*) - count(distinct s.signal)
    into v_bad, v_dupes
    from jsonb_to_recordset(v_signals) as s(signal text, detected boolean, evidence text, points integer);
  exception
    when data_exception then
      raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
        detail = format('invalid p_result.signals: %s', sqlerrm);
  end;

  if v_bad > 0 or v_dupes > 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.signals has unknown, repeated or out-of-range entries';
  end if;

  -- icebreakers: array de strings no vacíos
  v_icebreakers := coalesce(nullif(p_result -> 'icebreakers', 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(v_icebreakers) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.icebreakers must be an array of strings';
  end if;
  if jsonb_array_length(v_icebreakers) > 10
     or exists (
       select 1 from jsonb_array_elements(v_icebreakers) e
       where jsonb_typeof(e) <> 'string'
          or btrim(e #>> '{}') = ''
          or char_length(btrim(e #>> '{}')) > 1000
     ) then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result.icebreakers must be up to 10 non-empty strings (max 1000 chars)';
  end if;

  -- Orden de locks: item → prospecto → job.
  select * into v_prospect from public.prospects p where p.id = v_item.prospect_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROSPECT_NOT_FOUND',
      detail = format('prospect of item %s no longer exists', p_item_id);
  end if;

  select j.event_id into v_event_id from public.scrape_jobs j where j.id = v_item.job_id;

  insert into public.prospect_analyses (
    prospect_id, snapshot_id, owner_id, model, scoring_version, score,
    summary, interests, input_tokens, output_tokens
  )
  values (
    v_prospect.id, v_item.snapshot_id, v_item.owner_id, v_model, v_scoring_version, v_score,
    v_summary, v_interests, v_input_tokens, v_output_tokens
  )
  returning id into v_analysis_id;

  insert into public.analysis_signals (analysis_id, signal, detected, evidence, points)
  select v_analysis_id, s.signal::public.signal_key, s.detected, nullif(btrim(s.evidence), ''), coalesce(s.points, 0)
  from jsonb_to_recordset(v_signals) as s(signal text, detected boolean, evidence text, points integer);

  -- Posible menor (o no contactar): sin mensajes.
  if not v_dnc and jsonb_array_length(v_icebreakers) > 0 then
    select coalesce(max(b.batch), 0) + 1 into v_batch
    from public.icebreakers b
    where b.prospect_id = v_prospect.id;

    insert into public.icebreakers (prospect_id, analysis_id, event_id, owner_id, body, batch, position)
    select v_prospect.id, v_analysis_id, v_event_id, v_item.owner_id, btrim(e.body), v_batch, e.ordinality
    from jsonb_array_elements_text(v_icebreakers) with ordinality as e(body, ordinality);
  end if;

  update public.prospects p set
    current_score = v_score,
    latest_analysis_id = v_analysis_id,
    -- nunca se limpia una marca manual; el motivo solo se pone si es nueva
    do_not_contact = p.do_not_contact or v_dnc,
    do_not_contact_reason = case
      when not p.do_not_contact and v_dnc then v_dnc_reason
      else p.do_not_contact_reason
    end
  where p.id = v_prospect.id;

  -- Las fotos se borran al terminar el análisis (el worker borra los archivos).
  update public.profile_snapshots s set media_paths = '{}'::text[]
  where s.id = v_item.snapshot_id and s.media_paths <> '{}'::text[];

  update public.scrape_job_items i set
    status = 'done',
    locked_by = null,
    locked_at = null,
    error_code = null,
    error_message = null
  where i.id = v_item.id;

  perform public.refresh_job_progress(v_item.job_id);

  return jsonb_build_object(
    'analysis_id', v_analysis_id,
    'prospect_id', v_prospect.id,
    'score', v_score
  );
end;
$$;

-- Error del worker de análisis: reintento con backoff (2, 4 minutos) o falla
-- definitiva. Si falla, devuelve las rutas de fotos para que el worker las borre.
create function public.fail_analysis_item(
  p_item_id uuid,
  p_worker_id text,
  p_retryable boolean,
  p_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.scrape_job_items%rowtype;
  v_status public.item_status;
  v_media text[] := '{}'::text[];
  v_message text := left(nullif(btrim(p_message), ''), 1000);
begin
  select * into v_item from public.scrape_job_items i where i.id = p_item_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ITEM_NOT_FOUND',
      detail = format('scrape item %s not found', p_item_id);
  end if;

  if v_item.status <> 'analyzing' or v_item.locked_by is distinct from p_worker_id then
    raise exception using errcode = 'P0001', message = 'ITEM_NOT_CLAIMED',
      detail = format('item %s is %s and is not claimed by this worker', p_item_id, v_item.status);
  end if;

  if coalesce(p_retryable, false) and v_item.analysis_attempts < 3 then
    v_status := 'scraped';
    update public.scrape_job_items i set
      status = 'scraped',
      next_attempt_at = now() + make_interval(mins => power(2, v_item.analysis_attempts)::integer),
      error_code = 'analysis_failed',
      error_message = v_message,
      locked_by = null,
      locked_at = null
    where i.id = v_item.id;
  else
    v_status := 'failed';

    select s.media_paths into v_media
    from public.profile_snapshots s
    where s.id = v_item.snapshot_id
    for update;
    v_media := coalesce(v_media, '{}'::text[]);

    update public.profile_snapshots s set media_paths = '{}'::text[]
    where s.id = v_item.snapshot_id and s.media_paths <> '{}'::text[];

    update public.scrape_job_items i set
      status = 'failed',
      error_code = 'analysis_failed',
      error_message = v_message,
      locked_by = null,
      locked_at = null
    where i.id = v_item.id;
  end if;

  perform public.refresh_job_progress(v_item.job_id);

  return jsonb_build_object(
    'item_status', v_status,
    'media_paths', to_jsonb(v_media)
  );
end;
$$;

-- =============================================================================
-- Mantenimiento de la cola
-- =============================================================================

-- Devuelve a la cola los items trabados (worker caído). Lo corre pg_cron.
create function public.release_stale_locks(p_timeout interval default '10 minutes')
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scraping integer;
  v_analyzing integer;
  v_jobs uuid[];
  v_more uuid[];
  v_job_id uuid;
begin
  if p_timeout is null or p_timeout < interval '1 minute' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_timeout must be at least 1 minute';
  end if;

  with released as (
    update public.scrape_job_items i set
      status = case when i.attempts >= 3 then 'failed'::public.item_status else 'queued'::public.item_status end,
      error_code = 'timeout',
      error_message = 'scrape lock expired',
      next_attempt_at = now(),
      locked_by = null,
      locked_at = null
    where i.status = 'scraping'
      and i.locked_at < now() - p_timeout
    returning i.job_id
  )
  select count(*), coalesce(array_agg(distinct r.job_id), '{}'::uuid[])
  into v_scraping, v_jobs
  from released r;

  with released as (
    update public.scrape_job_items i set
      status = case when i.analysis_attempts >= 3 then 'failed'::public.item_status else 'scraped'::public.item_status end,
      error_code = 'timeout',
      error_message = 'analysis lock expired',
      next_attempt_at = now(),
      locked_by = null,
      locked_at = null
    where i.status = 'analyzing'
      and i.locked_at < now() - p_timeout
    returning i.job_id
  )
  select count(*), coalesce(array_agg(distinct r.job_id), '{}'::uuid[])
  into v_analyzing, v_more
  from released r;

  for v_job_id in
    select distinct j.id from unnest(v_jobs || v_more) as j(id) order by j.id
  loop
    perform public.refresh_job_progress(v_job_id);
  end loop;

  return jsonb_build_object('scraping_released', v_scraping, 'analyzing_released', v_analyzing);
end;
$$;

-- Cancela una carga: lo que está en cola se saltea; lo que está en curso termina.
create function public.cancel_scrape_job(p_owner_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.scrape_jobs%rowtype;
  v_skipped integer;
begin
  select * into v_job from public.scrape_jobs j where j.id = p_job_id and j.owner_id = p_owner_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOB_NOT_FOUND',
      detail = format('job %s not found', p_job_id);
  end if;

  if v_job.status = 'cancelled' then
    return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'skipped', 0);
  end if;

  if v_job.status = 'completed' then
    raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION',
      detail = format('job %s is already completed', p_job_id);
  end if;

  -- Items primero y job después (mismo orden de locks que el resto).
  with skipped as (
    update public.scrape_job_items i set
      status = 'skipped',
      error_code = 'cancelled',
      error_message = null
    where i.job_id = v_job.id
      and i.status = 'queued'
    returning 1
  )
  select count(*) into v_skipped from skipped;

  update public.scrape_jobs j set
    status = 'cancelled',
    finished_at = now()
  where j.id = v_job.id
    and j.status in ('queued', 'running');

  perform public.refresh_job_progress(v_job.id);

  select * into v_job from public.scrape_jobs j where j.id = p_job_id;

  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'skipped', v_skipped);
end;
$$;

-- =============================================================================
-- Conversión
-- =============================================================================

-- Registra una interacción validando la transición de estado del prospecto.
--   rangos: new 0 · contacted 1 · seen 2 · replied 3 · bought_ticket/guest_list 4
--   vale si: mismo estado (no cambia) · rango igual o mayor (salvo desde
--   discarded) · a discarded desde cualquiera · a contacted desde
--   bought_ticket/guest_list/discarded (nuevo ciclo para otro evento) ·
--   entre bought_ticket y guest_list.
create function public.record_interaction(
  p_owner_id uuid,
  p_prospect_id uuid,
  p_type public.interaction_type,
  p_event_id uuid default null,
  p_icebreaker_id uuid default null,
  p_amount numeric default null,
  p_note text default null,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prospect public.prospects%rowtype;
  v_from public.prospect_status;
  v_to public.prospect_status;
  v_from_rank integer;
  v_to_rank integer;
  v_allowed boolean;
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
  v_note text := nullif(btrim(p_note), '');
  v_interaction public.interactions%rowtype;
begin
  if p_type is null then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_type is required';
  end if;

  select * into v_prospect
  from public.prospects p
  where p.id = p_prospect_id and p.owner_id = p_owner_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROSPECT_NOT_FOUND',
      detail = format('prospect %s not found', p_prospect_id);
  end if;

  if p_event_id is not null and not exists (
    select 1 from public.events e where e.id = p_event_id and e.owner_id = p_owner_id
  ) then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND',
      detail = format('event %s not found', p_event_id);
  end if;

  if p_icebreaker_id is not null and not exists (
    select 1 from public.icebreakers b
    where b.id = p_icebreaker_id and b.prospect_id = v_prospect.id and b.owner_id = p_owner_id
  ) then
    raise exception using errcode = 'P0001', message = 'ICEBREAKER_NOT_FOUND',
      detail = format('icebreaker %s not found for prospect %s', p_icebreaker_id, p_prospect_id);
  end if;

  if p_amount is not null and p_type <> 'ticket_purchased' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_amount only applies to ticket_purchased';
  end if;

  if p_amount is not null and (p_amount < 0 or p_amount >= 100000000) then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_amount must be between 0 and 99999999.99';
  end if;

  if v_note is not null and char_length(v_note) > 2000 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_note is too long (max 2000 chars)';
  end if;

  -- A un posible menor (o a quien marcaste) no se le escribe.
  if p_type = 'message_sent' and v_prospect.do_not_contact then
    raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION',
      detail = 'prospect is marked do_not_contact';
  end if;

  v_from := v_prospect.status;
  v_to := case p_type
    when 'message_sent' then 'contacted'
    when 'seen_no_reply' then 'seen'
    when 'replied' then 'replied'
    when 'ticket_purchased' then 'bought_ticket'
    when 'guest_list' then 'guest_list'
    when 'discarded' then 'discarded'
    else v_from -- note: no cambia el estado
  end;

  v_from_rank := case v_from
    when 'new' then 0 when 'contacted' then 1 when 'seen' then 2 when 'replied' then 3
    when 'bought_ticket' then 4 when 'guest_list' then 4
  end;
  v_to_rank := case v_to
    when 'new' then 0 when 'contacted' then 1 when 'seen' then 2 when 'replied' then 3
    when 'bought_ticket' then 4 when 'guest_list' then 4
  end;

  v_allowed := coalesce(
    v_to = v_from
    or v_to = 'discarded'
    or (v_from <> 'discarded' and v_to_rank >= v_from_rank)
    or (v_from in ('bought_ticket', 'guest_list', 'discarded') and v_to = 'contacted')
    or (v_from in ('bought_ticket', 'guest_list') and v_to in ('bought_ticket', 'guest_list')),
    false
  );

  if not v_allowed then
    raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION',
      detail = format('%s cannot move a prospect from %s to %s', p_type, v_from, v_to);
  end if;

  if v_to <> v_from or p_type = 'message_sent' then
    update public.prospects p set
      status = v_to,
      last_contacted_at = case
        when p_type = 'message_sent' then greatest(p.last_contacted_at, v_occurred_at)
        else p.last_contacted_at
      end
    where p.id = v_prospect.id;
  end if;

  if p_type = 'message_sent' and p_icebreaker_id is not null then
    update public.icebreakers b set used_at = coalesce(b.used_at, v_occurred_at)
    where b.id = p_icebreaker_id;
  end if;

  insert into public.interactions (
    prospect_id, owner_id, event_id, type, from_status, to_status,
    icebreaker_id, amount, note, occurred_at
  )
  values (
    v_prospect.id, p_owner_id, p_event_id, p_type, v_from, v_to,
    p_icebreaker_id, p_amount, v_note, v_occurred_at
  )
  returning * into v_interaction;

  return jsonb_build_object(
    'interaction', to_jsonb(v_interaction),
    'prospect_status', v_to
  );
end;
$$;

-- =============================================================================
-- Limpieza de seguidos (extensión)
-- =============================================================================

-- Abre un escaneo nuevo; el que estuviera a medio subir queda como failed.
create function public.start_follow_scan(
  p_account_id uuid,
  p_following_count integer,
  p_followers_count integer,
  p_non_followers_count integer,
  p_chunks_expected integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account public.instagram_accounts%rowtype;
  v_scan_id uuid;
begin
  -- Lock de la cuenta: serializa los escaneos de una misma cuenta.
  select * into v_account
  from public.instagram_accounts a
  where a.id = p_account_id
  for no key update;

  if not found or v_account.role <> 'main' then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_FOUND',
      detail = format('main account %s not found', p_account_id);
  end if;

  if p_chunks_expected is null or p_chunks_expected < 1 or p_chunks_expected > 10000 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_chunks_expected must be between 1 and 10000';
  end if;

  if p_following_count is null or p_following_count < 0
     or p_followers_count is null or p_followers_count < 0
     or p_non_followers_count is null or p_non_followers_count < 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'scan counts must be >= 0';
  end if;

  update public.follow_scans s set
    status = 'failed',
    finished_at = now()
  where s.instagram_account_id = v_account.id
    and s.status = 'uploading';

  insert into public.follow_scans (
    owner_id, instagram_account_id, following_count, followers_count,
    non_followers_count, chunks_expected
  )
  values (
    v_account.owner_id, v_account.id, p_following_count, p_followers_count,
    p_non_followers_count, p_chunks_expected
  )
  returning id into v_scan_id;

  update public.instagram_accounts a set last_heartbeat_at = now() where a.id = v_account.id;

  return jsonb_build_object('scan_id', v_scan_id);
end;
$$;

-- Aplica una parte del escaneo. Idempotente por (scan_id, chunk_index).
-- Conserva is_protected, last_post_at y last_post_checked_at.
create function public.apply_follow_scan_chunk(p_scan_id uuid, p_chunk_index integer, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scan public.follow_scans%rowtype;
  v_row_count integer;
  v_invalid integer;
begin
  -- Lock del escaneo: las partes de un mismo escaneo se aplican de a una.
  select * into v_scan from public.follow_scans s where s.id = p_scan_id for no key update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SCAN_NOT_FOUND',
      detail = format('scan %s not found', p_scan_id);
  end if;

  if v_scan.status <> 'uploading' then
    raise exception using errcode = 'P0001', message = 'SCAN_NOT_UPLOADING',
      detail = format('scan %s is %s', p_scan_id, v_scan.status);
  end if;

  if p_chunk_index is null or p_chunk_index < 0 or p_chunk_index >= v_scan.chunks_expected then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = format('p_chunk_index must be between 0 and %s', v_scan.chunks_expected - 1);
  end if;

  if exists (
    select 1 from public.follow_scan_chunks c
    where c.scan_id = v_scan.id and c.chunk_index = p_chunk_index
  ) then
    return jsonb_build_object(
      'chunks_received', v_scan.chunks_received,
      'chunks_expected', v_scan.chunks_expected,
      'duplicate', true
    );
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_rows must be an array';
  end if;

  v_row_count := jsonb_array_length(p_rows);
  if v_row_count > 5000 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_rows holds more than 5000 rows';
  end if;

  if exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r) <> 'object') then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_rows must hold objects';
  end if;

  begin
    select count(*) filter (
             where r.ig_user_id is null
                or r.ig_user_id !~ '^[0-9]{1,30}$'
                or r.username is null
                or r.username !~ '^[a-z0-9._]{1,30}$'
                or r.follows_back is null
           )
      into v_invalid
      from jsonb_to_recordset(p_rows) as r(
        ig_user_id text, username text, full_name text,
        is_private boolean, is_verified boolean, follows_back boolean
      );
  exception
    when data_exception then
      raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
        detail = format('invalid p_rows: %s', sqlerrm);
  end;

  if v_invalid > 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = format('%s rows have an invalid ig_user_id, username or follows_back', v_invalid);
  end if;

  -- Si un ig_user_id viene repetido en la parte, gana la última aparición.
  insert into public.followed_accounts as f (
    owner_id, instagram_account_id, ig_user_id, username, full_name,
    is_private, is_verified, follows_back, last_seen_scan_id
  )
  select distinct on (r.ig_user_id)
    v_scan.owner_id, v_scan.instagram_account_id, r.ig_user_id, r.username, nullif(btrim(r.full_name), ''),
    coalesce(r.is_private, false), coalesce(r.is_verified, false), r.follows_back, v_scan.id
  from rows from (
    jsonb_to_recordset(p_rows) as (
      ig_user_id text, username text, full_name text,
      is_private boolean, is_verified boolean, follows_back boolean
    )
  ) with ordinality as r(ig_user_id, username, full_name, is_private, is_verified, follows_back, ord)
  order by r.ig_user_id, r.ord desc
  on conflict (instagram_account_id, ig_user_id) do update set
    username = excluded.username,
    full_name = excluded.full_name,
    is_private = excluded.is_private,
    is_verified = excluded.is_verified,
    follows_back = excluded.follows_back,
    last_seen_scan_id = excluded.last_seen_scan_id;

  insert into public.follow_scan_chunks (scan_id, chunk_index, row_count)
  values (v_scan.id, p_chunk_index, v_row_count);

  update public.follow_scans s set chunks_received = s.chunks_received + 1
  where s.id = v_scan.id
  returning * into v_scan;

  return jsonb_build_object(
    'chunks_received', v_scan.chunks_received,
    'chunks_expected', v_scan.chunks_expected,
    'duplicate', false
  );
end;
$$;

-- Cierra el escaneo: borra los seguidos que no aparecieron (salvo protegidos).
create function public.complete_follow_scan(p_scan_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scan public.follow_scans%rowtype;
  v_removed integer;
  v_total integer;
  v_non_followers integer;
begin
  select * into v_scan from public.follow_scans s where s.id = p_scan_id for no key update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SCAN_NOT_FOUND',
      detail = format('scan %s not found', p_scan_id);
  end if;

  if v_scan.status <> 'uploading' then
    raise exception using errcode = 'P0001', message = 'SCAN_NOT_UPLOADING',
      detail = format('scan %s is %s', p_scan_id, v_scan.status);
  end if;

  if v_scan.chunks_received < v_scan.chunks_expected then
    raise exception using errcode = 'P0001', message = 'SCAN_INCOMPLETE',
      detail = format('scan %s has %s of %s chunks', p_scan_id, v_scan.chunks_received, v_scan.chunks_expected);
  end if;

  with removed as (
    delete from public.followed_accounts f
    where f.instagram_account_id = v_scan.instagram_account_id
      and f.owner_id = v_scan.owner_id
      and f.last_seen_scan_id is distinct from v_scan.id
      and not f.is_protected
    returning 1
  )
  select count(*) into v_removed from removed;

  update public.follow_scans s set
    status = 'completed',
    finished_at = now()
  where s.id = v_scan.id;

  select
    count(*),
    count(*) filter (where not f.follows_back and not f.is_protected)
  into v_total, v_non_followers
  from public.followed_accounts f
  where f.instagram_account_id = v_scan.instagram_account_id
    and f.owner_id = v_scan.owner_id;

  return jsonb_build_object(
    'removed', v_removed,
    'total', v_total,
    'non_followers', v_non_followers
  );
end;
$$;

-- Registra un intento de unfollow, actualiza la lista y la cuota del día.
create function public.record_unfollow(
  p_account_id uuid,
  p_ig_user_id text,
  p_username text,
  p_result public.unfollow_result,
  p_detail text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account public.instagram_accounts%rowtype;
  v_tz text;
  v_today date;
  v_last_hour integer;
  v_today_count integer;
begin
  -- Lock de la cuenta: serializa la cuota del día.
  select * into v_account
  from public.instagram_accounts a
  where a.id = p_account_id
  for no key update;

  if not found or v_account.role <> 'main' then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_FOUND',
      detail = format('main account %s not found', p_account_id);
  end if;

  if p_result is null
     or p_ig_user_id is null or p_ig_user_id !~ '^[0-9]{1,30}$'
     or p_username is null or p_username !~ '^[a-z0-9._]{1,30}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_result, a numeric p_ig_user_id and a valid p_username are required';
  end if;

  insert into public.unfollow_actions (owner_id, instagram_account_id, ig_user_id, username, result, detail)
  values (
    v_account.owner_id, v_account.id, p_ig_user_id, p_username, p_result,
    left(nullif(btrim(p_detail), ''), 1000)
  );

  if p_result in ('unfollowed', 'already_unfollowed') then
    delete from public.followed_accounts f
    where f.instagram_account_id = v_account.id and f.ig_user_id = p_ig_user_id;
  elsif p_result = 'follows_back' then
    -- Te sigue: se corrige la fila y no se toca la cuenta.
    update public.followed_accounts f set follows_back = true
    where f.instagram_account_id = v_account.id and f.ig_user_id = p_ig_user_id;
  end if;

  select p.timezone into v_tz from public.profiles p where p.id = v_account.owner_id;
  v_today := public.local_day(v_tz);

  if p_result = 'unfollowed' then
    insert into public.instagram_account_usage as u (account_id, day, unfollows)
    values (v_account.id, v_today, 1)
    on conflict (account_id, day) do update set unfollows = u.unfollows + 1;
  end if;

  update public.instagram_accounts a set last_heartbeat_at = now() where a.id = v_account.id;

  select count(*) into v_last_hour
  from public.unfollow_actions u
  where u.instagram_account_id = v_account.id
    and u.result = 'unfollowed'
    and u.created_at > now() - interval '60 minutes';

  select u.unfollows into v_today_count
  from public.instagram_account_usage u
  where u.account_id = v_account.id and u.day = v_today;

  return jsonb_build_object(
    'last_hour', v_last_hour,
    'today', coalesce(v_today_count, 0)
  );
end;
$$;

-- Estado de los topes de unfollow (ventana móvil de 60 minutos + día local).
create function public.get_unfollow_limits(p_account_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_account public.instagram_accounts%rowtype;
  v_tz text;
  v_last_hour integer;
  v_oldest timestamptz;
  v_today_count integer;
begin
  select * into v_account from public.instagram_accounts a where a.id = p_account_id;
  if not found or v_account.role <> 'main' then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_FOUND',
      detail = format('main account %s not found', p_account_id);
  end if;

  select count(*), min(u.created_at)
  into v_last_hour, v_oldest
  from public.unfollow_actions u
  where u.instagram_account_id = v_account.id
    and u.result = 'unfollowed'
    and u.created_at > now() - interval '60 minutes';

  select p.timezone into v_tz from public.profiles p where p.id = v_account.owner_id;

  select u.unfollows into v_today_count
  from public.instagram_account_usage u
  where u.account_id = v_account.id and u.day = public.local_day(v_tz);

  return jsonb_build_object(
    'last_hour', v_last_hour,
    'oldest_in_window_at', v_oldest,
    'today', coalesce(v_today_count, 0)
  );
end;
$$;

-- =============================================================================
-- Fotos en Storage
-- =============================================================================
-- Borrar filas de storage.objects por SQL no borra los archivos, así que el
-- worker de Node purga por la API de Storage: list_stale_media → borra los
-- archivos → clear_snapshot_media.

-- Snapshots con fotos más viejas que el umbral.
create function public.list_stale_media(
  p_older_than interval default '24 hours',
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_older_than is null or p_older_than < interval '0' then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_older_than must be >= 0';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_limit must be between 1 and 1000';
  end if;

  return coalesce(
    (
      select jsonb_agg(
               jsonb_build_object(
                 'snapshot_id', s.id,
                 'owner_id', s.owner_id,
                 'media_paths', to_jsonb(s.media_paths)
               )
               order by s.scraped_at, s.id
             )
      from (
        select x.id, x.owner_id, x.media_paths, x.scraped_at
        from public.profile_snapshots x
        where x.media_paths <> '{}'::text[]
          and x.scraped_at < now() - p_older_than
        order by x.scraped_at, x.id
        limit p_limit
      ) s
    ),
    '[]'::jsonb
  );
end;
$$;

-- Vacía media_paths de los snapshots cuyos archivos ya se borraron.
create function public.clear_snapshot_media(p_snapshot_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cleared integer;
begin
  if p_snapshot_ids is null then
    raise exception using errcode = 'P0001', message = 'INVALID_ARGUMENT',
      detail = 'p_snapshot_ids is required';
  end if;

  with cleared as (
    update public.profile_snapshots s set media_paths = '{}'::text[]
    where s.id = any (p_snapshot_ids)
      and s.media_paths <> '{}'::text[]
    returning 1
  )
  select count(*) into v_cleared from cleared;

  return jsonb_build_object('cleared', v_cleared);
end;
$$;

-- =============================================================================
-- Privilegios: solo service_role
-- =============================================================================
-- Supabase da EXECUTE a anon y authenticated en cada función nueva, además del
-- EXECUTE a PUBLIC de Postgres: se sacan los tres.

revoke all on function public.local_day(text, timestamptz) from public, anon, authenticated;
revoke all on function public.local_day_start(text, timestamptz) from public, anon, authenticated;
revoke all on function public.refresh_job_progress(uuid) from public, anon, authenticated;
revoke all on function public.claim_scrape_item(uuid, text) from public, anon, authenticated;
revoke all on function public.record_scrape_result(uuid, text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.fail_scrape_item(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_analysis_item(text) from public, anon, authenticated;
revoke all on function public.complete_analysis(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_analysis_item(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.release_stale_locks(interval) from public, anon, authenticated;
revoke all on function public.cancel_scrape_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_interaction(uuid, uuid, public.interaction_type, uuid, uuid, numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.start_follow_scan(uuid, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.apply_follow_scan_chunk(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.complete_follow_scan(uuid) from public, anon, authenticated;
revoke all on function public.record_unfollow(uuid, text, text, public.unfollow_result, text) from public, anon, authenticated;
revoke all on function public.get_unfollow_limits(uuid) from public, anon, authenticated;
revoke all on function public.list_stale_media(interval, integer) from public, anon, authenticated;
revoke all on function public.clear_snapshot_media(uuid[]) from public, anon, authenticated;
revoke all on function public.handle_scrape_job_items_inserted() from public, anon, authenticated;
revoke all on function public.handle_prospect_deleted() from public, anon, authenticated;

grant execute on function public.local_day(text, timestamptz) to service_role;
grant execute on function public.local_day_start(text, timestamptz) to service_role;
grant execute on function public.refresh_job_progress(uuid) to service_role;
grant execute on function public.claim_scrape_item(uuid, text) to service_role;
grant execute on function public.record_scrape_result(uuid, text, jsonb, text[]) to service_role;
grant execute on function public.fail_scrape_item(uuid, text, text, text) to service_role;
grant execute on function public.claim_analysis_item(text) to service_role;
grant execute on function public.complete_analysis(uuid, text, jsonb) to service_role;
grant execute on function public.fail_analysis_item(uuid, text, boolean, text) to service_role;
grant execute on function public.release_stale_locks(interval) to service_role;
grant execute on function public.cancel_scrape_job(uuid, uuid) to service_role;
grant execute on function public.record_interaction(uuid, uuid, public.interaction_type, uuid, uuid, numeric, text, timestamptz) to service_role;
grant execute on function public.start_follow_scan(uuid, integer, integer, integer, integer) to service_role;
grant execute on function public.apply_follow_scan_chunk(uuid, integer, jsonb) to service_role;
grant execute on function public.complete_follow_scan(uuid) to service_role;
grant execute on function public.record_unfollow(uuid, text, text, public.unfollow_result, text) to service_role;
grant execute on function public.get_unfollow_limits(uuid) to service_role;
grant execute on function public.list_stale_media(interval, integer) to service_role;
grant execute on function public.clear_snapshot_media(uuid[]) to service_role;
