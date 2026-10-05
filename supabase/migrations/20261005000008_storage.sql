-- =============================================================================
-- RRPP Suite · 008 · Storage
-- =============================================================================
-- Bucket privado para las fotos de los perfiles mientras se analizan.
-- Rutas: {owner_id}/{item_id}/{n}.{ext} (record_scrape_result exige el prefijo
-- {owner_id}/). El scraper sube con URLs firmadas que emite la API y el worker
-- las borra al terminar el análisis (o a las 24 h como máximo).
-- Sin políticas sobre storage.objects: con RLS activado y sin políticas, solo
-- la service role (API y worker) puede leer, subir o borrar.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-media',
  'profile-media',
  false,
  5242880, -- 5 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
