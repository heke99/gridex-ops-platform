import Link from 'next/link'
import { requireRetentionScope } from '@/lib/ediel/retention/retentionHttp'
import { ProcessJournalWorkspace } from './workspace'
export default async function ProcessJournalRetentionPage(){
 let scope:Awaited<ReturnType<typeof requireRetentionScope>>
 try{scope=await requireRetentionScope()}catch{return <main className="p-4"><h1 className="text-2xl font-semibold">Källbunden gallring av processjournaler</h1><p role="alert">Välj ett eget bolag med aktuell uttrycklig klassbehörighet för att öppna journalerna.</p></main>}
 return <main className="mx-auto grid min-w-0 max-w-5xl gap-5 p-4"><h1 className="text-2xl font-semibold">Källbunden gallring av processjournaler</h1><p>Varje faktakopia och sparad läsning kräver ett eget juridiskt beslut för den oförändrade källan. Alla inkluderade kunder och leveranser måste vara avvecklade. En särskild prövning ska ange när kroppens uppgifter får tas bort och vilket begränsat journaländamål som därefter gäller.</p><p>Andra kopior gallras inte automatiskt. Saknad behörighet, utfärdarkompetens, tidsgrund eller källomfattning håller ingreppet spärrat. Läsningarna styrker inte historisk fullständighet eller rätt att utföra marknadseffekter.</p><nav className="flex flex-wrap gap-4"><Link href="/retention/customer-records" className="underline">Avtals- och kundhistorik</Link><Link href="/retention/message-content" className="underline">Meddelandeoriginal och transportfiler</Link></nav><ProcessJournalWorkspace permissions={scope.permissions}/></main>
}
