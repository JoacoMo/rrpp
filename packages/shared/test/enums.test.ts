import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  IG_ACCOUNT_ROLES,
  IG_ACCOUNT_STATUSES,
  IG_ACCOUNT_STATUS_LABELS,
  INTERACTION_TYPES,
  INTERACTION_TYPE_LABELS,
  ITEM_STATUSES,
  ITEM_STATUS_LABELS,
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  SCAN_STATUSES,
  SIGNAL_KEYS,
  SIGNAL_KEY_LABELS,
  TOKEN_KINDS,
  UNFOLLOW_RESULTS,
  igAccountRoleSchema,
  igAccountStatusSchema,
  interactionTypeSchema,
  itemStatusSchema,
  jobStatusSchema,
  prospectStatusSchema,
  scanStatusSchema,
  signalKeySchema,
  tokenKindSchema,
  unfollowResultSchema,
  type Database,
  type IgAccountRole,
  type IgAccountStatus,
  type InteractionType,
  type ItemStatus,
  type JobStatus,
  type ProspectStatus,
  type ScanStatus,
  type SignalKey,
  type TokenKind,
  type UnfollowResult,
} from '../src/index';

const enums = [
  {
    name: 'ig_account_role',
    values: IG_ACCOUNT_ROLES,
    schema: igAccountRoleSchema,
    expected: ['scraper', 'main'],
  },
  {
    name: 'ig_account_status',
    values: IG_ACCOUNT_STATUSES,
    schema: igAccountStatusSchema,
    expected: ['active', 'paused', 'needs_login', 'blocked'],
  },
  {
    name: 'token_kind',
    values: TOKEN_KINDS,
    schema: tokenKindSchema,
    expected: ['scraper', 'extension'],
  },
  {
    name: 'job_status',
    values: JOB_STATUSES,
    schema: jobStatusSchema,
    expected: ['queued', 'running', 'completed', 'cancelled'],
  },
  {
    name: 'item_status',
    values: ITEM_STATUSES,
    schema: itemStatusSchema,
    expected: ['queued', 'scraping', 'scraped', 'analyzing', 'done', 'skipped', 'failed'],
  },
  {
    name: 'prospect_status',
    values: PROSPECT_STATUSES,
    schema: prospectStatusSchema,
    expected: ['new', 'contacted', 'seen', 'replied', 'bought_ticket', 'guest_list', 'discarded'],
  },
  {
    name: 'signal_key',
    values: SIGNAL_KEYS,
    schema: signalKeySchema,
    expected: ['cordoba', 'local_university', 'nightlife', 'mutual_followers', 'possible_minor'],
  },
  {
    name: 'interaction_type',
    values: INTERACTION_TYPES,
    schema: interactionTypeSchema,
    expected: [
      'message_sent',
      'seen_no_reply',
      'replied',
      'ticket_purchased',
      'guest_list',
      'discarded',
      'note',
    ],
  },
  {
    name: 'scan_status',
    values: SCAN_STATUSES,
    schema: scanStatusSchema,
    expected: ['uploading', 'completed', 'failed'],
  },
  {
    name: 'unfollow_result',
    values: UNFOLLOW_RESULTS,
    schema: unfollowResultSchema,
    expected: ['unfollowed', 'follows_back', 'already_unfollowed', 'failed', 'rate_limited'],
  },
] as const;

describe('enums', () => {
  it.each(enums)('$name tiene exactamente los valores de la base', ({ values, expected }) => {
    expect([...values]).toEqual([...expected]);
  });

  it.each(enums)('$name no tiene valores repetidos', ({ values }) => {
    expect(new Set(values).size).toBe(values.length);
  });

  it.each(enums)('el esquema de $name acepta cada valor', ({ values, schema }) => {
    for (const value of values) {
      expect(schema.parse(value)).toBe(value);
    }
  });

  it.each(enums)('el esquema de $name rechaza valores desconocidos', ({ schema }) => {
    expect(schema.safeParse('unknown_value').success).toBe(false);
    expect(schema.safeParse('').success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse(1).success).toBe(false);
  });

  it('los tipos coinciden con los enums generados de Postgres', () => {
    type DbEnums = Database['public']['Enums'];
    expectTypeOf<IgAccountRole>().toEqualTypeOf<DbEnums['ig_account_role']>();
    expectTypeOf<IgAccountStatus>().toEqualTypeOf<DbEnums['ig_account_status']>();
    expectTypeOf<TokenKind>().toEqualTypeOf<DbEnums['token_kind']>();
    expectTypeOf<JobStatus>().toEqualTypeOf<DbEnums['job_status']>();
    expectTypeOf<ItemStatus>().toEqualTypeOf<DbEnums['item_status']>();
    expectTypeOf<ProspectStatus>().toEqualTypeOf<DbEnums['prospect_status']>();
    expectTypeOf<SignalKey>().toEqualTypeOf<DbEnums['signal_key']>();
    expectTypeOf<InteractionType>().toEqualTypeOf<DbEnums['interaction_type']>();
    expectTypeOf<ScanStatus>().toEqualTypeOf<DbEnums['scan_status']>();
    expectTypeOf<UnfollowResult>().toEqualTypeOf<DbEnums['unfollow_result']>();
  });
});

describe('etiquetas', () => {
  const labelSets = [
    { name: 'prospect_status', values: PROSPECT_STATUSES, labels: PROSPECT_STATUS_LABELS },
    { name: 'interaction_type', values: INTERACTION_TYPES, labels: INTERACTION_TYPE_LABELS },
    { name: 'item_status', values: ITEM_STATUSES, labels: ITEM_STATUS_LABELS },
    { name: 'job_status', values: JOB_STATUSES, labels: JOB_STATUS_LABELS },
    { name: 'ig_account_status', values: IG_ACCOUNT_STATUSES, labels: IG_ACCOUNT_STATUS_LABELS },
    { name: 'signal_key', values: SIGNAL_KEYS, labels: SIGNAL_KEY_LABELS },
  ] as const;

  it.each(labelSets)(
    '$name tiene una etiqueta para cada valor y nada más',
    ({ values, labels }) => {
      expect(Object.keys(labels).sort()).toEqual([...values].sort());
    },
  );

  it.each(labelSets)('las etiquetas de $name no están vacías', ({ labels }) => {
    for (const label of Object.values(labels)) {
      expect(label.trim()).not.toBe('');
    }
  });

  it('usa el vocabulario del RRPP', () => {
    expect(PROSPECT_STATUS_LABELS.seen).toBe('Clavó visto');
    expect(PROSPECT_STATUS_LABELS.guest_list).toBe('Fue por lista');
    expect(PROSPECT_STATUS_LABELS.bought_ticket).toBe('Compró entrada');
    expect(INTERACTION_TYPE_LABELS.seen_no_reply).toBe('Clavó visto');
    expect(INTERACTION_TYPE_LABELS.ticket_purchased).toBe('Compró entrada');
    expect(INTERACTION_TYPE_LABELS.guest_list).toBe('Fue por lista');
  });
});
