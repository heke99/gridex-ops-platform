// masterplan: DB-05
// Finite SQL mechanism proof: actual receipt/HMAC/forward code with the table
// columns/constraints from schema.sql and limited fixture grants. This does not
// exercise Auth, PostgREST, customer lock concurrency or genuine legal facts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');
const schema = read('supabase/schema.sql');
const predecessor = read('supabase/migrations/20261001000610_ediel_customer_class_retention.sql');
const originals = read('supabase/migrations/20261001071500_ediel_customer_invoice_retention_decision_original_classes.sql');
const intake = read('supabase/migrations/20260930232100_ediel_requested_change_source_intake_and_review.sql');
const forward = read('supabase/migrations/20261012150838_db05_customer_legal_authority_wall_clock.sql');
const signature = 'gridex_ediel_retention.customer_receipt_v1(gridex_ediel_retention.customer_decisions)';
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
let db: PGlite;

function functionSql(source: string, name: string): string {
  const start = source.indexOf(`CREATE FUNCTION ${name}(`);
  const end = source.indexOf('$$;', start);
  if (start < 0 || end < start) throw Error('actual_function_source_required');
  return source.slice(start, end + 3);
}
function tableSql(name: string): string {
  const start = schema.indexOf(`CREATE TABLE gridex_ediel_retention.${name} (`);
  const end = schema.indexOf('\n);', start);
  if (start < 0 || end < start) throw Error('actual_table_source_required');
  return schema.slice(start, end + 3);
}

// Execute the actual predecessor with the later original-byte guard extracted
// from its immutable applied forward. The live compiled prosrc hash below
// qualifies this reconstruction; schema.sql may already contain the new fix.
const guard = originals.match(/,'(BEGIN IF d\.document_bytes.*?END IF;)','i'\)/)?.[1]?.replaceAll("''", "'");
if (!guard) throw Error('actual_original_byte_guard_required');
const installedPredecessor = functionSql(predecessor, 'gridex_ediel_retention.customer_receipt_v1')
  .replace('\nBEGIN\n', '\n' + guard + '\n');

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE gridex_ediel_retention_owner;
    CREATE SCHEMA gridex_ediel_retention; CREATE SCHEMA gridex_requested_changes;`);
  for (const name of ['issuers', 'issuer_revocations', 'customer_decisions', 'customer_revocations']) {
    await db.exec(tableSql(name));
    await db.exec(`ALTER TABLE gridex_ediel_retention.${name} OWNER TO gridex_ediel_retention_owner`);
  }
  await db.exec(functionSql(intake, 'gridex_requested_changes.receipt_hmac_sha256_v1'));
  await db.exec(installedPredecessor);
  await db.exec(`ALTER FUNCTION ${signature} OWNER TO gridex_ediel_retention_owner;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    GRANT USAGE ON SCHEMA gridex_ediel_retention,gridex_requested_changes TO gridex_ediel_retention_owner;`);
}, 30_000);
afterEach(async () => { await db.close(); });

async function authority() {
  return (await db.query<{ body: string; metadata: unknown }>(
    `SELECT prosrc AS body,to_jsonb(p)-'prosrc' AS metadata
     FROM pg_proc p WHERE oid=$1::regprocedure`, [signature],
  )).rows[0];
}
async function receipt(decision: string) {
  return (await db.query<{ receipt: Record<string, unknown> | null }>(
    `SELECT gridex_ediel_retention.customer_receipt_v1(d) AS receipt
     FROM gridex_ediel_retention.customer_decisions d WHERE id=$1::uuid`, [decision],
  )).rows[0].receipt;
}

async function crossExpiry() {
  const issuer = randomUUID(), company = randomUUID(), customer = randomUUID(), decision = randomUUID();
  const key = Buffer.alloc(32, 11), document = Buffer.from('Synthetic finite DB05 retention original');
  const evidence = Buffer.from('Synthetic issuer competence, not an authorized legal original');
  const now = (await db.query<{ at: string }>('SELECT clock_timestamp()::text AS at')).rows[0].at;
  const stamp = Date.parse(now);
  const expiresAt = new Date(stamp + 1200).toISOString();
  const policy = {
    format: 'ediel_customer_retention_policy_v1', retentionClass: 'customer_canonical_personal_fields',
    companyId: company, customerId: customer, sourceHash: digest('Synthetic current source'),
    documentHash: digest(document), issuerLegalReference: 'SYNTHETIC_SQL_FIXTURE',
    legalBasisReference: 'SYNTHETIC_MECHANISM_ONLY', issuedAt: new Date(stamp - 1000).toISOString(),
    expiresAt, retainUntil: new Date(stamp - 2000).toISOString(),
  };
  const bytes = Buffer.from(JSON.stringify(policy));
  const signed = { issuerId: issuer, payloadBase64: bytes.toString('base64'),
    signatureHex: createHmac('sha256', key).update(bytes).digest('hex') };
  await db.query(`INSERT INTO gridex_ediel_retention.issuers
    (id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [issuer, company, policy.issuerLegalReference, evidence,
    digest(evidence), key, new Date(stamp - 3600000).toISOString(), new Date(stamp + 3600000).toISOString()]);
  await db.query(`INSERT INTO gridex_ediel_retention.customer_decisions
    (id,company_id,customer_id,retention_class,source_hash,document_bytes,document_hash,issuer_receipt,submitted_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [decision, company, customer, policy.retentionClass,
    policy.sourceHash, document, policy.documentHash, JSON.stringify(signed), randomUUID()]);
  await db.exec('BEGIN');
  let after: Record<string, unknown> | null;
  try {
    const started = (await db.query<{ transaction: string; observed: string }>(
      'SELECT now()::text AS transaction,clock_timestamp()::text AS observed',
    )).rows[0];
    expect(Date.parse(started.transaction)).toBeLessThan(Date.parse(expiresAt));
    expect(Date.parse(started.observed)).toBeLessThan(Date.parse(expiresAt));
    // Real SQL HMAC, original-byte and scope checks must first admit this policy.
    expect(await receipt(decision)).toEqual(policy);
    const remaining = (await db.query<{ ms: number }>(
      `SELECT greatest(0,extract(epoch FROM ($1::timestamptz-clock_timestamp()))*1000)::float8 AS ms`,
      [expiresAt],
    )).rows[0].ms;
    await delay(remaining + 50);
    const clocks = (await db.query<{ transaction: string; expired: boolean }>(
      'SELECT now()::text AS transaction,clock_timestamp()>=$1::timestamptz AS expired', [expiresAt],
    )).rows[0];
    expect(clocks.transaction).toBe(started.transaction);
    expect(clocks.expired).toBe(true);
    after = await receipt(decision);
  } finally {
    await db.exec('ROLLBACK');
  }
  // A fresh transaction with the same unchanged original rejects expiry too.
  expect(await receipt(decision)).toBeNull();
  return { after, policy };
}

it('rejects a legal receipt expiring within the transaction and preserves installed authority', async () => {
  const before = await authority();
  expect(digest(before.body)).toBe('9238f39eb6a8a06225e4a4fd9edf464ec383a16e50271d89a3fd4e378ddbb48f');
  // Known predecessor witness: valid-at-start remains admitted after expiry.
  const stale = await crossExpiry();
  expect(stale.after).toEqual(stale.policy);
  await db.exec(forward);
  const installed = await authority();
  expect(installed.metadata).toEqual(before.metadata);
  // The unchanged timed contrast now rejects that expired legal authority.
  const corrected = await crossExpiry();
  expect(corrected.after).toBeNull();
}, 30_000);

it('refuses an unexpected installed predecessor without changing its authority', async () => {
  await db.exec(installedPredecessor.replace('CREATE FUNCTION ', 'CREATE OR REPLACE FUNCTION ')
    .replace('RETURN p;', 'RETURN NULL;'));
  const before = await authority();
  await expect(db.exec(forward)).rejects.toThrow('customer_legal_clock_original_review_required');
  await db.exec('ROLLBACK');
  expect(await authority()).toEqual(before);
}, 30_000);
