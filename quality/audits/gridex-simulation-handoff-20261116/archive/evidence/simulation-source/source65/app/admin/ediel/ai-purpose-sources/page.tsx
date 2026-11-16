import {requireAdminPageAccess} from '@/lib/admin/guards'
// tenant_ediel_profiles is service-only (no authenticated grant); read it for
// the guarded company only, after the page's server permission check.
import {supabaseService} from '@/lib/supabase/service'
import AiPurposeWorkspace from './workspace'
export const dynamic='force-dynamic'
export default async function AiPurposeSourcesPage({searchParams}:{searchParams:Promise<{artifactId?:string}>}){
 const access=await requireAdminPageAccess({allOf:['communication.read','customers.read','contracts.read']})
 if(!access.companyId||!['communication.read','customers.read','contracts.read'].every(p=>access.permissions.includes(p)))return <main className="p-6"><h1 className="text-2xl font-semibold">AI/BI:s ändamålsunderlag</h1><p>Välj ett bolag med behörighet att läsa kommunikation, kunder och avtal.</p></main>
 const profiles=await supabaseService.from('tenant_ediel_profiles').select('environment').eq('company_id',access.companyId).eq('market','electricity').eq('is_enabled',true)
 if(profiles.error)return <main className="p-6"><h1 className="text-2xl font-semibold">AI/BI:s ändamålsunderlag</h1><p role="alert">Bolagets aktuella Ediel-profiler kunde inte läsas.</p></main>
 const environments=[...new Set((profiles.data??[]).map(p=>p.environment).filter((e):e is 'test'|'production'=>e==='test'||e==='production'))],params=await searchParams
 return <main className="mx-auto max-w-4xl p-4 sm:p-6"><h1 className="mb-2 text-2xl font-semibold">AI/BI:s ändamålsunderlag</h1><p className="mb-6">Arkivera det juridiska originalet för ett avgränsat ändamål och dess gallringsvillkor. En annan behörig granskare måste pröva originalet. Aktuell behörighet hos utfärdare och företrädare måste kunna styrkas innan listans personuppgifter får behandlas.</p><AiPurposeWorkspace environments={environments} initialArtifactId={params.artifactId??''} canArchive={['communication.write','customers.write','contracts.write'].every(p=>access.permissions.includes(p))} canReview={['communication.write','customers.write','contracts.write','ediel.ai_purpose.review'].every(p=>access.permissions.includes(p))}/></main>
}
