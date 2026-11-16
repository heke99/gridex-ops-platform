import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { isEvidenceUuid } from '@/lib/ediel/utilts/durableSourceDiscovery'
import {readProdatRecoveryWorkspace} from '@/lib/ediel/recovery/operatorWorkspace'
import RecoveryWorkspace from './workspace'

export const dynamic='force-dynamic'
export default async function ProdatRecoveryPage({searchParams}:{searchParams:Promise<{messageId?:string;originalMessageId?:string}>}) {
  const access=await requireAdminPageAccess({allOf:['communication.read']})
  if (!isEvidenceUuid(access.companyId)||!access.permissions.includes('communication.read')) return <main className="p-6"><h1 className="text-2xl font-semibold">PRODAT-rättelse</h1><p>Välj ett bolag där du får läsa kommunikation.</p></main>
  const params=await searchParams
  let snapshot
  try{snapshot=await readProdatRecoveryWorkspace({companyId:access.companyId,actorUserId:access.userId,...(isEvidenceUuid(params.messageId)?{messageId:params.messageId}:{})})}catch{return <main className="p-6"><h1 className="text-2xl font-semibold">PRODAT-rättelse</h1><p role="alert">Bolagets beständiga meddelanden och transportförsök kunde inte läsas med aktuell behörighet.</p></main>}
  return <main className="mx-auto max-w-5xl p-4 sm:p-6"><h1 className="mb-2 text-2xl font-semibold">PRODAT-rättelse</h1><p className="mb-6">Välj ett beständigt original och dess faktiska negativa ACK för en rättelse. Ett nytt utkast får egen identitet och sparas före separat köläggning. Förnyad leverans av samma original kräver ett styrkt misslyckat transportförsök.</p>
    <RecoveryWorkspace {...snapshot} operationId={randomUUID()} initialMessageId={isEvidenceUuid(params.messageId)?params.messageId:''} initialOriginalId={isEvidenceUuid(params.originalMessageId)?params.originalMessageId:''} canPrepare={access.permissions.includes('communication.write')} canQueue={access.permissions.includes('communication.send')}/>
    <p className="mt-6"><Link href="/admin/ediel/messages" className="underline">Meddelanden</Link> · <Link href="/admin/ediel/outbox" className="underline">Leveranskö</Link> · <Link href="/admin/ediel/process-watches" className="underline">Processbevakning</Link></p>
  </main>
}
