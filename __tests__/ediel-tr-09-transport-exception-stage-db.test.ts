// masterplan: TR-09, AT-TR-09
// Database boundary for the transport reserve procedure: production plaintext of
// any family needs a journaled, bounded exception; invented cases are refused.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const file = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
const extract = (source: string, start: string) => {
  const first = source.indexOf(start)
  const last = source.indexOf('END$$;', first)
  if (first < 0 || last < 0) throw new Error(`Missing SQL declaration: ${start}`)
  return source.slice(first, last + 'END$$;'.length)
}
const base = file('20261001000609_ediel_source_owned_temporary_transport_exceptions.sql')
const forward = file('20261004180000_ediel_tr09_production_smime_all_families.sql')
const c = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-2222-4222-8222-222222222222'
const approver = '33333333-3333-4333-8333-333333333333'
const approval = '44444444-4444-4444-8444-444444444444'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE SCHEMA gridex_transport_exception;CREATE SCHEMA gridex_certificate_trust;
    CREATE TABLE gridex_certificate_trust.authority_versions(id uuid PRIMARY KEY,company_id uuid,environment text,receiver_ediel_id text,valid_from timestamptz,valid_to timestamptz,crls jsonb);
    CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,direction text,message_standard text,message_family text,environment text,raw_payload text,immutable_payload_hash text);
    CREATE TABLE gridex_transport_exception.approvals(id uuid PRIMARY KEY,company_id uuid,message_id uuid,approved_by uuid,maximum_attempts integer);
    CREATE TABLE gridex_transport_exception.operations(attempt_id uuid PRIMARY KEY,approval_id uuid,company_id uuid,message_id uuid,environment text,actor_user_id uuid,binding jsonb,created_at timestamptz);
    CREATE TABLE gridex_transport_exception.events(attempt_id uuid,company_id uuid,message_id uuid,kind text,facts jsonb,UNIQUE(attempt_id,kind));
    CREATE TABLE gridex_transport_exception.alarms(id bigserial,attempt_id uuid,company_id uuid,message_id uuid,responsible_user_id uuid,facts jsonb,created_at timestamptz DEFAULT now());
    -- Authority read stub: the full source/approval verification is covered by its own owner.
    CREATE FUNCTION gridex_transport_exception.read_v1(c uuid,mid uuid,actor uuid,eid uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
     IF eid IS DISTINCT FROM '${approval}'::uuid THEN RETURN jsonb_build_object('status','held'); END IF;
     RETURN jsonb_build_object('status','authorized','approvalId',eid,'case','temporary_encryption_failure','sourceDigest','s','approvalDigest','a','tlsEvidenceDigest','t','validTo','2026-10-05T00:00:00Z');END$$;`)
  await db.exec(extract(base, 'CREATE FUNCTION gridex_transport_exception.case_v1'))
  await db.exec(extract(forward, 'CREATE OR REPLACE FUNCTION gridex_transport_exception.stage_v1'))
}, 60_000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec(`TRUNCATE public.ediel_messages,gridex_transport_exception.approvals,gridex_transport_exception.operations,gridex_transport_exception.events,gridex_transport_exception.alarms`)
  await db.query(`INSERT INTO gridex_transport_exception.approvals VALUES($1,$2,$3,$4,2)`, [approval, c, msg('PRODAT'), approver])
})

const ids: Record<string, string> = {}
const msg = (family: string, environment = 'production') => {
  const key = `${family}:${environment}`
  ids[key] ??= `00000000-0000-4000-8000-${String(Object.keys(ids).length + 1).padStart(12, '0')}`
  return ids[key]
}
const seed = async (family: string, environment = 'production', standard = 'edifact') =>
  db.query(`INSERT INTO public.ediel_messages(id,company_id,direction,message_standard,message_family,environment) VALUES($1,$2,'outbound',$3,$4,$5) ON CONFLICT DO NOTHING`, [msg(family, environment), c, standard, family, environment])
const prepare = (family: string, mimeMode: string, opts: { environment?: string; exception?: unknown; attempt?: string } = {}) =>
  db.query(`SELECT gridex_transport_exception.stage_v1($1::jsonb,$2::jsonb)`, [JSON.stringify({
    action: 'prepare', companyId: c, messageId: msg(family, opts.environment), actorUserId: actor,
    attemptId: opts.attempt ?? '55555555-5555-4555-8555-555555555555',
    binding: { mimeMode, transportException: opts.exception ?? null },
  }), JSON.stringify({ proceed: true })])
const exception = { approvalId: approval, case: 'temporary_encryption_failure', sourceDigest: 's', approvalDigest: 'a', tlsEvidenceDigest: 't' }

describe('TR-09 stage boundary', () => {
  it.each(['PRODAT', 'UTILTS', 'APERAK', 'CONTRL', 'MSCONS'])('on_failure: production %s plaintext without exception is refused', async (family) => {
    await seed(family)
    await expect(prepare(family, 'ediel-singlepart-base64')).rejects.toThrow('transport_exception_actual_approved_plaintext_source_required')
  })

  it('on_failure: non-EDIFACT production plaintext is refused as well', async () => {
    await seed('XMLDOC', 'production', 'xml')
    await expect(prepare('XMLDOC', 'nodemailer-attachment')).rejects.toThrow('transport_exception_actual_approved_plaintext_source_required')
  })

  it.each(['PRODAT', 'UTILTS', 'APERAK'])('condition: production %s S/MIME passes; test environment plaintext is not affected', async (family) => {
    await seed(family)
    await expect(prepare(family, 'ediel-smime-enveloped')).resolves.toBeTruthy()
    await seed(family, 'test')
    await expect(prepare(family, 'ediel-singlepart-base64', { environment: 'test' })).resolves.toBeTruthy()
    const journal = await db.query(`SELECT count(*)::int n FROM gridex_transport_exception.events`)
    expect(journal.rows[0]).toEqual({ n: 0 })
  })

  it('on_pass: an approved exception writes a separate deviation journal, a mandatory-TLS alarm and a bounded operation', async () => {
    await seed('PRODAT')
    await prepare('PRODAT', 'ediel-singlepart-base64', { exception })
    const events = await db.query<{ kind: string }>(`SELECT kind FROM gridex_transport_exception.events`)
    expect(events.rows).toEqual([{ kind: 'prepared' }])
    const alarms = await db.query<{ responsible_user_id: string; facts: Record<string, unknown> }>(`SELECT responsible_user_id,facts FROM gridex_transport_exception.alarms`)
    expect(alarms.rows).toHaveLength(1)
    expect(alarms.rows[0].responsible_user_id).toBe(approver)
    expect(alarms.rows[0].facts).toMatchObject({ mandatoryTls: true, administratorAlarm: true, case: 'temporary_encryption_failure' })
    // Bounded: the approval's attempt budget (2) cannot be exceeded.
    await prepare('PRODAT', 'ediel-singlepart-base64', { exception, attempt: '66666666-6666-4666-8666-666666666666' })
    await expect(prepare('PRODAT', 'ediel-singlepart-base64', { exception, attempt: '77777777-7777-4777-8777-777777777777' }))
      .rejects.toThrow('transport_exception_bounded_attempt_budget_exhausted')
  })

  it('prohibited: an unapproved/forged exception binding does not open plaintext', async () => {
    await seed('UTILTS')
    await expect(prepare('UTILTS', 'ediel-singlepart-base64', { exception: { ...exception, approvalId: '88888888-8888-4888-8888-888888888888' } }))
      .rejects.toThrow('transport_exception_fresh_exact_attempt_binding_required')
  })

  it('prohibited: invented exception cases are refused', async () => {
    await seed('PRODAT')
    await expect(db.query(`SELECT gridex_transport_exception.case_v1(m,'{"case":"general_plaintext_switch"}'::jsonb) FROM public.ediel_messages m WHERE id=$1`, [msg('PRODAT')]))
      .rejects.toThrow('transport_exception_exact_source_case_required')
  })
})
