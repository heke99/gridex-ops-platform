import { it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { postcheckJourney, readFixture, seedJourney } from './support-attachment-next-denial-20261001.fixture'

it('T36/P7 real GoTrue intake seed or independent complete postcheck on disposable native stack', async () => {
  if (process.env.GRIDEX_SUPPORT_NEXT_PHASE === 'seed') {
    await seedJourney()
    console.log('SUPPORT_NEXT_DENIAL_NATIVE_SEED_PASS gotrueIssued=true actualStorage=true nonemptyFinancialGraph=true privateFixture=true browserPending=true')
  } else if (process.env.GRIDEX_SUPPORT_NEXT_PHASE === 'postcheck') {
    await postcheckJourney(readFixture())
    console.log('SUPPORT_NEXT_DENIAL_NATIVE_POSTCHECK_PASS financialGraphUnchanged=true quietTenantUnchanged=true currentIdentityUnchanged=true actualStorageUnchanged=true releaseAllowed=false')
  } else throw new Error('attachment_journey_explicit_phase_required')
})
