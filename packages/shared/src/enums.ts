import { z } from 'zod';

// Espejo de los enums de Postgres. Los valores tienen que coincidir exactamente con la base:
// test/enums.test.ts lo verifica contra los tipos generados por Supabase.

// --- Cuentas de Instagram ---

export const IG_ACCOUNT_ROLES = ['scraper', 'main'] as const;
export type IgAccountRole = (typeof IG_ACCOUNT_ROLES)[number];
export const igAccountRoleSchema = z.enum(IG_ACCOUNT_ROLES);

export const IG_ACCOUNT_STATUSES = ['active', 'paused', 'needs_login', 'blocked'] as const;
export type IgAccountStatus = (typeof IG_ACCOUNT_STATUSES)[number];
export const igAccountStatusSchema = z.enum(IG_ACCOUNT_STATUSES);

export const TOKEN_KINDS = ['scraper', 'extension'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
export const tokenKindSchema = z.enum(TOKEN_KINDS);

// --- Prospección ---

export const JOB_STATUSES = ['queued', 'running', 'completed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const jobStatusSchema = z.enum(JOB_STATUSES);

export const ITEM_STATUSES = [
  'queued',
  'scraping',
  'scraped',
  'analyzing',
  'done',
  'skipped',
  'failed',
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const itemStatusSchema = z.enum(ITEM_STATUSES);

export const PROSPECT_STATUSES = [
  'new',
  'contacted',
  'seen',
  'replied',
  'bought_ticket',
  'guest_list',
  'discarded',
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];
export const prospectStatusSchema = z.enum(PROSPECT_STATUSES);

export const SIGNAL_KEYS = [
  'cordoba',
  'local_university',
  'nightlife',
  'mutual_followers',
  'possible_minor',
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];
export const signalKeySchema = z.enum(SIGNAL_KEYS);

export const INTERACTION_TYPES = [
  'message_sent',
  'seen_no_reply',
  'replied',
  'ticket_purchased',
  'guest_list',
  'discarded',
  'note',
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];
export const interactionTypeSchema = z.enum(INTERACTION_TYPES);

// --- Limpieza de seguidos ---

export const SCAN_STATUSES = ['uploading', 'completed', 'failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];
export const scanStatusSchema = z.enum(SCAN_STATUSES);

export const UNFOLLOW_RESULTS = [
  'unfollowed',
  'follows_back',
  'already_unfollowed',
  'failed',
  'rate_limited',
] as const;
export type UnfollowResult = (typeof UNFOLLOW_RESULTS)[number];
export const unfollowResultSchema = z.enum(UNFOLLOW_RESULTS);

// --- Etiquetas para la interfaz ---

export const PROSPECT_STATUS_LABELS: Readonly<Record<ProspectStatus, string>> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  seen: 'Clavó visto',
  replied: 'Respondió',
  bought_ticket: 'Compró entrada',
  guest_list: 'Fue por lista',
  discarded: 'Descartado',
};

export const INTERACTION_TYPE_LABELS: Readonly<Record<InteractionType, string>> = {
  message_sent: 'Mensaje enviado',
  seen_no_reply: 'Clavó visto',
  replied: 'Respondió',
  ticket_purchased: 'Compró entrada',
  guest_list: 'Fue por lista',
  discarded: 'Descartado',
  note: 'Nota',
};

export const ITEM_STATUS_LABELS: Readonly<Record<ItemStatus, string>> = {
  queued: 'En cola',
  scraping: 'Extrayendo perfil',
  scraped: 'Perfil extraído',
  analyzing: 'Analizando',
  done: 'Listo',
  skipped: 'Salteado',
  failed: 'Falló',
};

export const JOB_STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  queued: 'En cola',
  running: 'En curso',
  completed: 'Terminada',
  cancelled: 'Cancelada',
};

export const IG_ACCOUNT_STATUS_LABELS: Readonly<Record<IgAccountStatus, string>> = {
  active: 'Activa',
  paused: 'Pausada',
  needs_login: 'Hay que volver a iniciar sesión',
  blocked: 'Bloqueada',
};

export const SIGNAL_KEY_LABELS: Readonly<Record<SignalKey, string>> = {
  cordoba: 'Es de Córdoba',
  local_university: 'Estudia en una universidad local',
  nightlife: 'Le gusta salir de noche',
  mutual_followers: 'Seguidores en común',
  possible_minor: 'Posible menor de edad',
};
