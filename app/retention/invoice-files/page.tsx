import {requireRetentionScope} from '@/lib/ediel/retention/retentionHttp'
import {InvoiceFileWorkspace} from './workspace'
export const dynamic='force-dynamic'
export default async function InvoiceFileRetentionPage(){
 let scope:Awaited<ReturnType<typeof requireRetentionScope>>
 try{scope=await requireRetentionScope(['ediel.retention.invoice_copy_evidence'])}catch{return <main className="p-4"><h1 className="text-2xl font-semibold">Faktura-PDF: separat källprövning och gallring</h1><p role="alert">Välj ett eget bolag med aktuell uttrycklig klassbehörighet för att öppna fakturakopiorna.</p></main>}
 return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8"><h1 className="text-2xl font-semibold">Faktura-PDF: separat källprövning och gallring</h1><p>Varje faktisk kopia behöver eget källintag, aktuellt juridiskt beslut, en annan behörig granskare och styrkta tidsvillkor. Delade Storage-byte kan gallras först när alla refererande kopior har kvalificerats. Fjärr-URL:er håller ingreppet spärrat tills en faktisk ägd källa kan styrkas.</p><InvoiceFileWorkspace permissions={scope.permissions}/></main>
}
