import type { EdielProcessNextAction } from '@/lib/ediel/operations/processNextAction'

const businessMessages: Record<EdielProcessNextAction['cause'], string> = {
  source_context_held: 'Underlaget behöver kontrolleras innan ärendet kan gå vidare.',
  business_response_pending: 'Begäran är skickad. Vi väntar på svar.',
  business_response_received: 'Svar har kommit in och behöver följas upp.',
  business_response_rejected: 'Mottagaren har avvisat begäran. Granska orsaken innan en ny begäran skickas.',
  business_watch_overdue: 'Tiden för uppföljning har passerat. Kontrollera om svar har kommit in.',
  technical_rejection: 'Utskicket kunde inte behandlas. Kontakta support för hjälp.',
}

export default function InfoRequestProcessDetails({ decision, showTechnicalDetails = false }: { decision: EdielProcessNextAction; showTechnicalDetails?: boolean }) {
  if (!showTechnicalDetails) return <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700" aria-label="Nästa steg"><p className="font-semibold">Nästa steg</p><p className="mt-1">{businessMessages[decision.cause]}</p><p className="mt-1">{decision.responsibility === 'counterparty' ? 'Inväntar motpartens svar.' : 'Ärendet behöver granskas av ert bolag.'}</p>{decision.timeBasis.businessDueAt ? <p className="mt-1">Följ upp senast {new Date(decision.timeBasis.businessDueAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}</p> : null}</div>
  const waitingLabels: Record<string,string> = { Z02_or_negative_APERAK:'Z02 eller negativ APERAK',CONTRL:'Teknisk CONTRL',APERAK:'APERAK' }
  const blockerLabels:Record<string,string>={source_owned_process_context_required:'Källbeslut eller tidsgrund måste kontrolleras',business_response_rejected:'Kvalificerat negativt affärssvar',technical_response_rejected:'Teknisk avvisning',business_sender_watch_overdue:'Den egna affärsbevakningen har löpt ut',technical_sender_watch_overdue:'Den egna tekniska bevakningen har löpt ut'}
  return <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" aria-label="Nästa processåtgärd">
    <p className="font-semibold">Nästa åtgärd</p><p className="mt-1">{decision.summary}</p>
    <dl className="mt-2 space-y-1"><div><dt className="font-semibold">Väntar på</dt><dd>{decision.waitingFor.length?decision.waitingFor.map(value=>waitingLabels[value]??value).join(', '):'Inget automatiskt externt steg'}</dd></div>
      <div><dt className="font-semibold">Ansvar</dt><dd>{decision.responsibility==='counterparty'?'Motpartens svar; eget bolag bevakar':'Eget bolag granskar'}</dd></div>
      <div><dt className="font-semibold">Hinder</dt><dd>{decision.blockers.length?decision.blockers.map(value=>blockerLabels[value]??'Källbeslutet kräver granskning').join(', '):'Inget hinder just nu'}</dd></div>
      <div><dt className="font-semibold">Tidsgrund</dt><dd>{decision.timeBasis.anchor==='z09_validity_day'?`Originalets giltighetsdag ${decision.timeBasis.validityDay??'saknas'}, bevakningsdag ${decision.timeBasis.dueDay??'saknas'}. Faktisk SMTP-acceptans ${decision.timeBasis.actualAcceptedAt??'saknas'} prövas separat.`:`Egen uppföljning från SMTP-acceptans ${decision.timeBasis.anchorAt??'saknar kvalificerad tidsgrund'}.`} Motpartens mottagningstid är inte känd.</dd></div>
      <div><dt className="font-semibold">Affärsbevakning till</dt><dd>{decision.timeBasis.businessDueAt??'Ingen numerisk tidsgräns i källbeslutet'}</dd></div>
      <div><dt className="font-semibold">Teknisk bevakning till</dt><dd>{decision.timeBasis.technicalDueAt??'Ingen aktiv teknisk tidsgräns'}</dd></div>
      <div><dt className="font-semibold">Tillåtna åtgärder</dt><dd>{decision.allowedActions.map(action=>action==='read_source'?'Läsa källbeslut':'Granska manuellt').join(', ')||'Läsbehörighet krävs'}. Ingen automatisk omsändning.</dd></div>
    </dl>
  </div>
}

