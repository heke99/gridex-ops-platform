import {requireRetentionScope} from '@/lib/ediel/retention/retentionHttp'
import DecisionEvidenceWorkspace from './workspace'
export default async function DecisionEvidencePage(){
 let scope:Awaited<ReturnType<typeof requireRetentionScope>>|null=null
 try{scope=await requireRetentionScope()}catch{scope=null}
 if(!scope)return <main className="p-6"><h1 className="text-xl font-semibold">Bevarande av beslutsoriginal</h1><p>Välj ett eget bolag med aktuella retentionbehörigheter.</p></main>
 return <main className="mx-auto max-w-4xl space-y-6 p-6"><h1 className="text-2xl font-semibold">Bevarande av beslutsoriginal</h1><p>Varje beslutsoriginal behöver ett eget rättsligt underlag och en separat granskare. Rensning följer underlagets exakta källa, klass och tidpunkt.</p><DecisionEvidenceWorkspace companyId={scope.companyId} userId={scope.userId} permissions={[...scope.permissions]}/></main>
}
