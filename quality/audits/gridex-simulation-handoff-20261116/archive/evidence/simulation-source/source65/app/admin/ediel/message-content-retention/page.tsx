import {requireRetentionScope} from '@/lib/ediel/retention/retentionHttp'
import MessageContentRetentionWorkspace from './workspace'

export default async function MessageContentRetentionPage(){
 let scope:Awaited<ReturnType<typeof requireRetentionScope>>|null=null
 try{scope=await requireRetentionScope()}catch{scope=null}
 if(!scope)return <main className="p-6"><h1 className="text-xl font-semibold">Bevarande och rensning av Ediel-innehåll</h1><p>Välj ett eget bolag och kontrollera dina aktuella retentionbehörigheter.</p></main>
 return <main className="mx-auto max-w-4xl space-y-6 p-6"><h1 className="text-2xl font-semibold">Bevarande och rensning av Ediel-innehåll</h1><p>Arkivera det rättsliga beslutet och låt en annan behörig granskare bedöma det. Rensningen följer beslutets källa, klass och tidpunkt.</p><MessageContentRetentionWorkspace companyId={scope.companyId} permissions={[...scope.permissions]}/></main>
}
