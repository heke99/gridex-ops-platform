import type {EdielTestRunRow} from '@/lib/ediel/types'
import {loadTgtReportingSourceSelection} from '@/lib/ediel/testing/tgtReportingPermissionContext'
import {reportingScenarios} from '@/lib/ediel/testing/tgtReportingPermissionAssertions'
import {reportingRunScope} from '@/lib/ediel/testing/tgtReportingPermissionNotes'
import {getEdielTgtTestCaseByCode} from '@/lib/ediel/testing/tgtRegistry'
import {saveEdielTgtReportingPermissionAction} from '../reporting-permission-action'
const fieldClass='mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
/** The parent active case page already authorizes visibility; action repeats write authorization. */
export default async function EdielReportingPermissionForm({run}:{run:EdielTestRunRow}){
 const step=getEdielTgtTestCaseByCode(run.test_suite,run.role_code,run.test_case_code)?.expectedSteps.find(s=>s.actor==='gridex'&&s.direction==='outbound'&&s.family==='PRODAT'&&s.code==='Z13')
 if(!step||run.role_code!=='esco')return null
 let source,scenarios
 try{source=await loadTgtReportingSourceSelection(run,step.stepNo);scenarios=reportingScenarios(source,reportingRunScope(run,step.stepNo))}
 catch{return <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">Rapporteringsunderlaget kan inte läsas entydigt. Kontrollera valt testfall och importerad testdata innan underlaget sparas.</p>}
 const hidden=<><input type="hidden" name="testRunId" value={run.id}/><input type="hidden" name="stepNo" value={step.stepNo}/><input type="hidden" name="expectedRunUpdatedAt" value={run.updated_at}/></>
 return <details className="mt-3 rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-semibold text-slate-900">Rapporteringsunderlag för Z13, steg {step.stepNo}</summary>
 <p className="mt-2 text-sm text-slate-700">Bedöm det valda testunderlaget. Tider anges i fast svensk standardtid (UTC+1). Referenser skapas av systemet och gäller endast testkörningen. Spara eller rensa ändrar bara underlaget; skapa och skicka filen med körningens separata knapp.</p>
 <form action={saveEdielTgtReportingPermissionAction} className="mt-3 space-y-4">{hidden}<input type="hidden" name="operation" value="save"/><input type="hidden" name="objectCount" value={scenarios.length}/>
 {scenarios.map((s,i)=><fieldset key={JSON.stringify(s.selector)} className="rounded-lg border border-slate-200 p-3"><legend className="px-1 font-medium">{s.selector.entityLabel} – {s.selector.columnName}</legend>
 <p className="text-xs text-slate-600">{s.selector.workbook}, {s.selector.sheet}. Kund {s.customer.id}. Orsak {s.reason}. Rapportslut i källan: {s.sourceEnd??'inte angivet'}. Syfte i källan: {s.purposeCode??'inte angivet'}.</p>
 <input type="hidden" name={`object.${i}.selector`} value={JSON.stringify(s.selector)}/>
 <div className="mt-3 grid gap-3 md:grid-cols-2">
 <label className="text-sm">Rapporteringens slut<select name={`object.${i}.term`} defaultValue="unknown" className={fieldClass}><option value="unknown">Inte bedömt</option><option value="indefinite">Tills vidare</option><option value="bounded">Bestämt slutdatum och tid</option><option value="bounded_source">Källans datumregel och vald tid</option></select></label>
 <label className="text-sm">Bestämt slutdatum och tid<input type="datetime-local" step="60" name={`object.${i}.end`} className={fieldClass}/></label>
 <label className="text-sm">Tid för källans datumregel<input type="time" step="60" name={`object.${i}.minuteOfDay`} className={fieldClass}/></label>
 <label className="text-sm">Kundklassificering<select name={`object.${i}.classification`} defaultValue="unknown" className={fieldClass}><option value="unknown">Inte bedömt</option><option value="private">Privatkund</option><option value="nonprivate">Företag eller annan juridisk person</option></select></label>
 <label className="text-sm">Grund för kundklassificeringen<textarea name={`object.${i}.classificationRationale`} maxLength={2000} rows={2} className={fieldClass}/></label>
 <label className="text-sm">Bedömt syfte<select name={`object.${i}.purpose`} defaultValue="unknown" className={fieldClass}><option value="unknown">Inte bedömt</option><option value="absent">Utelämnas för icke-privatkund</option>{[['B71','Samtycke'],['B72','Avtal'],['B73','Rättslig förpliktelse'],['B74','Skydd av grundläggande intresse'],['B75','Myndighetsutövning'],['B76','Intresseavvägning']].map(([code,label])=><option key={code} value={code}>{code} – {label}</option>)}</select></label>
 <label className="text-sm">Grund för syftesbedömningen<textarea name={`object.${i}.purposeRationale`} maxLength={2000} rows={2} className={fieldClass}/></label>
 </div></fieldset>)}
 <label className="block text-sm">Källanteckning<textarea name="sourceNote" required maxLength={2000} rows={2} className={fieldClass}/></label>
 <label className="block text-sm">Datumregel<select name="resolution" defaultValue="retain" className={fieldClass}><option value="retain">Behåll tidigare datumankare</option><option value="refresh">Beräkna om mot dagens datum</option></select></label>
 <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Spara rapporteringsunderlag</button></form>
 <form action={saveEdielTgtReportingPermissionAction} className="mt-4 border-t border-slate-200 pt-3">{hidden}<input type="hidden" name="operation" value="clear"/><label className="block text-sm">Orsak till rensning<input name="sourceNote" required maxLength={2000} className={fieldClass}/></label><button type="submit" className="mt-2 rounded-lg border border-slate-300 px-4 py-2 text-sm">Rensa rapporteringsunderlag</button></form>
 </details>
}
