import { isValidIdempotencyKey } from '@/lib/api/idempotencyKey'

export type UnderlayClientScope = { companyId: string; actorUserId: string; billingMonth: string }

const storeName = 'intents'

async function openIntents(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('gridex-underlay-generation', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** One durable key per actor, selected company and period, including across tabs. */
export async function saveUnderlayIntent(
  { companyId, actorUserId, billingMonth }: UnderlayClientScope,
  completedKey?: string,
): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify([companyId, actorUserId, billingMonth]))
  const scope = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)))
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
  const candidate = crypto.randomUUID()
  const db = await openIntents()

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite', { durability: 'strict' })
      const store = tx.objectStore(storeName)
      const request = store.get(scope)
      let savedKey: string = candidate
      request.onsuccess = () => {
        const previous: unknown = request.result
        if (previous !== undefined && (typeof previous !== 'string' || !isValidIdempotencyKey(previous))) {
          tx.abort()
          return
        }
        if (typeof previous === 'string' && previous !== completedKey) {
          savedKey = previous
          return
        }
        store.put(savedKey, scope)
      }
      tx.oncomplete = () => resolve(savedKey)
      tx.onabort = () => reject(tx.error ?? new Error('underlay_client_intent_unsaved'))
    })
  } finally {
    db.close()
  }
}
