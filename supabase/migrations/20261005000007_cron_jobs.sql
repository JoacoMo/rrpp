-- =============================================================================
-- RRPP Suite · 007 · tareas programadas (pg_cron)
-- =============================================================================
-- Cada 5 minutos se liberan los items trabados (worker caído o cortado).
-- Las fotos viejas NO se purgan acá: borrar filas de storage.objects por SQL no
-- borra los archivos. Eso lo hace el worker de Node con la API de Storage
-- (list_stale_media + clear_snapshot_media).
-- cron.schedule con nombre hace upsert: correr esto de nuevo no duplica el job.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'rrpp-release-stale-locks',
  '*/5 * * * *',
  $$select public.release_stale_locks()$$
);
