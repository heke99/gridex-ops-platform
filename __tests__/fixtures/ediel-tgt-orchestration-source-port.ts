import { createHash } from 'node:crypto'
import { encodeEdifactLatin1 } from '@/lib/ediel/core/edifactEncoding'
import { readSourceQualifiedPositiveFixtureDraft } from '@/lib/ediel/testing/positiveFixtureAuthority'

// An explicitly bounded orchestration port: private source/profile/membership
// rows are synthetic test facts. Actual actor checks and opaque fixture binding
// run unchanged. This helper proves neither native issuer competence nor send.
export const tgtCompany = 'a2600000-0000-4000-8000-000000000001'
export const tgtOtherCompany = 'a2600000-0000-4000-8000-000000000002'
export const tgtActor = 'a2600000-0000-4000-8000-000000000003'
export const tgtRun = 'a2600000-0000-4000-8000-000000000004'
const wire = "UNA:+.? 'UNB+UNOC:3+92825:ZZ+10000:ZZ+260930:1200+TGT-I++23-DDQ-PRODAT++1++1'UNH+TGT-M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+TGT-D+9+AB'UNT+3+TGT-M'UNZ+1+TGT-I'"
const sha = createHash('sha256').update(encodeEdifactLatin1(wire)).digest('hex')
export function tgtDraftInput(extra: Record<string, unknown> = {}) {
  return { companyId: tgtCompany, messageFamily: 'PRODAT', messageCode: 'Z04',
    direction: 'outbound', environment: 'test', rawPayload: wire, ...extra }
}
export function tgtSourcePort() {
  const state = { activeMembership: true, writePermission: true, hasOriginal: true }
  return {
    state,
    actorQuery(table: string) {
      if (!['company_memberships','user_profiles'].includes(table)) return null
      const filters = new Map<string, unknown>()
      const q = { select: () => q, eq: (key: string, value: unknown) => { filters.set(key,value); return q },
        not: () => q, maybeSingle: async () => ({ error: null, data: table === 'company_memberships'
          ? state.activeMembership && filters.get('company_id') === tgtCompany && filters.get('user_id') === tgtActor
            ? { company_id: tgtCompany, user_id: tgtActor, status: 'active', is_active: true, accepted_at: '2026-09-01T12:00:00Z' } : null
          : filters.get('id') === tgtActor ? { id: tgtActor, user_status: 'active' } : null }) }
      return q
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === 'gridex_actor_has_company_permission') return { error: null, data:
        state.writePermission && args.p_actor_user_id === tgtActor && args.p_company_id === tgtCompany && args.p_permission === 'communication.write' }
      if (name === 'gridex_ediel_negative_fixture_prepare_read_v1') return { error: null, data: null }
      if (name !== 'gridex_ediel_positive_fixture_read_v1') throw new Error('Unexpected orchestration RPC:' + name)
      const c = args.p_context as Record<string, unknown>
      return { error: null, data: state.hasOriginal && c.companyId === tgtCompany && c.actorUserId === tgtActor && c.runId === tgtRun && c.stepNo === 4 && c.rawPayload === wire
        ? { kind: 'source_qualified_positive_fixture', version: 1, registrationId: 'synthetic-private-original',
          companyId: tgtCompany, runId: tgtRun, roleCode: 'supplier', caseCode: '1.2.5', suite: 'PRODAT', revision: '26-A', stepNo: 4,
          wireSha256: sha, originalFileSha256: sha, expectedOutcome: 'positive', expectedDiagnosticCodes: [],
          testReceiverEdielId: '10000', validUntil: '2099-01-01T00:00:00Z', sourceReference: 'independent fixed synthetic original',
          ownerDecisionReference: 'synthetic private source row', authorizesBusinessEffect: false } : null }
    },
    assertOpaqueCanonicalInput(input: { actorUserId: string; requestType: string; baseInput: Record<string, unknown> }) {
      if (input.actorUserId !== tgtActor) throw new Error('scoped canonical actor missing')
      if (input.baseInput.messageFamily === 'PRODAT' && !readSourceQualifiedPositiveFixtureDraft(input.baseInput)) throw new Error('opaque positive fixture missing')
      if (!['supplier_switch','ediel_ack'].includes(input.requestType)) throw new Error('actual canonical route classification failed')
    },
  }
}
