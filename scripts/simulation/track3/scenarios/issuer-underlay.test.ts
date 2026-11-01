// Controlled TEST original producer, separate from the original 17 EDIEL cases.
// Native invocation requires its exact authorized execution and qualified GEN.
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest'
import { Evidence } from '../lib/evidence'
import { createNativeIssuerUnderlay, UNDERLAY_NAMES } from '../lib/issuer-underlay'

const evidence = new Evidence()
let producer: Awaited<ReturnType<typeof createNativeIssuerUnderlay>> | undefined
let primary: unknown
beforeAll(async () => {
  try { producer = await createNativeIssuerUnderlay(evidence) } catch (error) { primary = error; throw error }
})
afterEach(({ task }) => {
  if (task.result?.state === 'fail') producer?.hold()
})
afterAll(async () => {
  const cleanupErrors: unknown[] = []
  try { await producer?.close() } catch (error) { cleanupErrors.push(error) }
  try { evidence.finalize() } catch (error) { cleanupErrors.push(error) }
  if (primary && cleanupErrors.length) throw new AggregateError([primary, ...cleanupErrors], 'Controlled issuer original failure and cleanup/evidence errors require observation')
  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'Owned cleanup and private evidence require observation')
})
describe('Controlled TEST issuer underlay', () => {
  for (const [index, name] of UNDERLAY_NAMES.entries()) {
    it(name, async () => {
      if (!producer) throw Error('T3_UNDERLAY_PRECONDITION: actual qualified runtime unavailable')
      try { await producer.step(index) } catch (error) { primary ??= error; throw error }
    }, 900_000)
  }
})
