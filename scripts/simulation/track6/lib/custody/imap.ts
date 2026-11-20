// IMAP-hjälp: läs tillbaka meddelandekällor byte-exakt ur den lokala GreenMail-brevlådan (för att bevisa byte-exakt leverans).
import { imapClient } from '../counterparty'
import { sha256 } from './base'

export async function fetchInboxSources(folder = 'INBOX'): Promise<Array<{ uid: number; sha256: string; bytes: number; messageId: string | null }>> {
  const c = imapClient()
  await c.connect()
  const out: Array<{ uid: number; sha256: string; bytes: number; messageId: string | null }> = []
  try {
    const lock = await c.getMailboxLock(folder)
    try {
      if (!c.mailbox || typeof c.mailbox !== 'object' || !c.mailbox.exists) return out
      for await (const m of c.fetch('1:*', { uid: true, source: true, envelope: true }, { uid: false })) {
        const src = m.source as Buffer
        out.push({ uid: m.uid, sha256: sha256(src), bytes: src.length, messageId: m.envelope?.messageId ?? null })
      }
    } finally { lock.release() }
  } finally { await c.logout().catch(() => undefined) }
  return out
}
