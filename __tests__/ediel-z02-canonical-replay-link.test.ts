// masterplan: AT-Z02L-SUPPLIER, AT-Z02LK-SUPPLIER
// Execute the actual private linker declaration selected by the TypeScript AST.
// Declared matching/storage ports prove projection semantics only, not authority.
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

function linker(storage: Record<string, unknown>, matchFailure: Error | null = null) {
  const path = 'lib/ediel/flows/inboundProcessing.ts'
  const source = ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = source.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'linkInboundProdatMessageCanonically')
  if (!declaration) throw Error('production_linker_declaration_unavailable')
  const artifact = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  const effects: Record<string, unknown>[] = []
  const sandbox = {
    matchMeteringPointForEdielMessage: async () => {
      if (matchFailure) throw matchFailure
      return 'point-own'
    },
    matchSiteAndCustomerForMeteringPoint: async (input: Record<string, unknown>) => {
      if (input.companyId !== 'company-own') throw Error('declared_foreign_company_denied')
      return { customerId: 'customer-own', siteId: 'site-own', gridOwnerId: 'grid-own' }
    },
    findMatchingSupplierSwitchRequest: async () => null,
    linkEdielMessage: async (input: Record<string, unknown>) => {
      effects.push({ ...input })
      // Match the real link adapter's undefined-omission semantics.
      if (input.relatedMessageId !== undefined) storage.related_message_id = input.relatedMessageId
      return { ...storage }
    },
  }
  const call = vm.runInNewContext(artifact + '\nlinkInboundProdatMessageCanonically', sandbox) as
    (input: { actorUserId: string; message: EdielMessageRow }) => Promise<unknown>
  return { call, effects }
}
const message = (code: string) => ({ id: 'received-own', company_id: 'company-own',
  direction: 'inbound', message_family: 'PRODAT', message_code: code,
  related_message_id: 'authoritative-original-z01' }) as EdielMessageRow

describe('generic inbound linker preserves authoritative Z02 original correlation', () => {
  it('Z02 replay retains the committed original instead of clearing it', async () => {
    const stored = { related_message_id: 'authoritative-original-z01' }, f = linker(stored)
    await f.call({ actorUserId: 'actor-own', message: message('Z02') })
    expect(stored.related_message_id).toBe('authoritative-original-z01')
    expect(f.effects).toHaveLength(1)
    expect(f.effects[0]).toMatchObject({ edielMessageId: 'received-own', actorUserId: 'actor-own',
      customerId: 'customer-own', siteId: 'site-own', meteringPointId: 'point-own', gridOwnerId: 'grid-own' })
  })

  it('Z02 does not acquire the caller supplied related original before authoritative core correlation', async () => {
    const stored = { related_message_id: null }, f = linker(stored)
    await f.call({ actorUserId: 'actor-own', message: message('Z02') })
    expect(stored.related_message_id).toBeNull()
  })

  it('other PRODAT matching retains its existing relation reset behavior', async () => {
    const stored = { related_message_id: 'old-relation' }, f = linker(stored)
    await f.call({ actorUserId: 'actor-own', message: message('Z04') })
    expect(stored.related_message_id).toBeNull()
  })

  it('a failed current matcher performs no projection write', async () => {
    const stored = { related_message_id: 'authoritative-original-z01' }, failure = Error('current_match_unavailable')
    const f = linker(stored, failure)
    await expect(f.call({ actorUserId: 'actor-own', message: message('Z02') })).rejects.toBe(failure)
    expect(f.effects).toEqual([])
    expect(stored.related_message_id).toBe('authoritative-original-z01')
  })

  it('a foreign current company performs no projection write', async () => {
    const stored = { related_message_id: 'authoritative-original-z01' }, f = linker(stored)
    await expect(f.call({ actorUserId: 'actor-own', message: { ...message('Z02'), company_id: 'foreign' } }))
      .rejects.toThrow('declared_foreign_company_denied')
    expect(f.effects).toEqual([])
    expect(stored.related_message_id).toBe('authoritative-original-z01')
  })
})
