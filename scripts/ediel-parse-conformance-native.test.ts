// reality-defects: J4 parse conformance — the scenario's stored-outcome read model runs against the real local schema, and a parsed envelope survives jsonb storage exactly
//
// Read-only: SELECTs only, no fixture writes. Proves that scripts/reality/chain-j4-parse-conformance.test.ts reads the
// columns that inbound reception actually writes (inbound_email_messages, inbound_processing_jobs,
// inbound_ediel_parse_results, ediel_messages, customer_operation_tasks, grid_owner_data_requests), and that the parsed
// payload of a conformance file (ÅÄÖ, release-decoded text, decimal comma strings) is unchanged by a jsonb round trip.
// Synthetic data only.
import { describe, expect, it } from 'vitest'
import { literal, sql } from './helpers/live-chain-fixture'
import { sentZ01ForFacility, storedForMail } from './helpers/reality/parseConformanceWorld'
import { e66TwoPoints, unlinkedHeaderAperak, z06TwoObjects } from './helpers/reality/parseConformanceWire'
import { parseEdifactPayload } from '@/lib/inbound-mail/edielEmailParser'

const P = { issuer: '16700', receiver: '7300000000001', reference: 'J4NATIVE1', meters: ['735999000000000017', '735999000000000024'] as [string, string], gridArea: 'ALS' }

describe('J4 native read model', () => {
  it('storedForMail and sentZ01ForFacility run against the real schema and return empty results for unknown mail', () => {
    expect(storedForMail('<j4-native-unknown@example.invalid>')).toEqual({ messageId: '<j4-native-unknown@example.invalid>', mail: null, jobs: [], parse: null, messages: [], tasks: [] })
    expect(sentZ01ForFacility('00000000-0000-4000-8000-000000000000', '735999000000000017')).toBeNull()
  })

  it('a parsed conformance payload is identical after jsonb storage (no character or number drift)', () => {
    for (const file of [e66TwoPoints(P), z06TwoObjects({ ...P, una: 'custom' }), unlinkedHeaderAperak({ ...P, acknowledgedDocument: 'DOC-1' })]) {
      const parsed = JSON.parse(JSON.stringify(parseEdifactPayload(file.edifact))) as Record<string, unknown>
      expect(sql(`SELECT ${literal(parsed)}::jsonb`), file.key).toEqual(parsed)
      expect(sql<string>(`SELECT to_jsonb(${literal(file.edifact)}::text)`), file.key).toBe(file.edifact)
    }
  })
})
