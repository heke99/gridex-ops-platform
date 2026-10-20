import { afterEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ authorized: true, userId: 'admin-ai-test' }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: async () => {
  if (!io.authorized) throw new Error('forbidden')
  return { userId: io.userId }
} }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(path) } }))
import { testManualMailAiConnection } from '@/app/admin/manual-requests/actions'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); io.authorized = true })

describe('platform-admin AI connection check', () => {
  it('requires platform-admin access before any provider call', async () => {
    io.authorized = false
    vi.stubGlobal('fetch', async () => { throw new Error('must not call') })
    await expect(testManualMailAiConnection()).rejects.toThrow('forbidden')
  })
  it('tests only a fixed synthetic reply and blocks immediate repeated tests', async () => {
    io.userId = 'synthetic-admin-live-test'
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-secret')
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(String(init.body))
      expect(request.input[0].content[0].text).toContain('Avtalet löper till 2027-03-31.')
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ outcome: 'contract_information', outcome_source: 0, review_reasons: [], fields: [{ field: 'contract_end', value: '2027-03-31', source: 0 }] }) }] }] }))
    })
    await expect(testManualMailAiConnection()).rejects.toThrow('/admin/manual-requests?ai_test=ok')
    await expect(testManualMailAiConnection()).rejects.toThrow('/admin/manual-requests?ai_test=rate_limited')
  })
  it('reports a missing production runtime key without exposing credentials', async () => {
    io.userId = 'synthetic-admin-missing-key'
    vi.stubEnv('OPENAI_API_KEY', '')
    await expect(testManualMailAiConnection()).rejects.toThrow('/admin/manual-requests?ai_test=not_configured')
  })
})
