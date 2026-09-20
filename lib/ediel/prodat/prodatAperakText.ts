import type {ProdatDiagnostic} from './prodatFieldDiagnostic'

/** PRODAT26.A r3 §2.2 pp16–23, Swedish column; suffix rows share A904.
 * Source spelling is retained, including field253's published spelling. */
export const PRODAT_APERAK_FIELD_NAMES: Readonly<Record<string,string>> = Object.freeze({
  '311':'Application Reference','312':'Version','202':'Meddelandenamn','203':'Meddelandeidentifikation',
  '204':'Meddelandefunktion','313':'Kvittensbegäran','205':'Meddelandedatum','206':'Tidszon',
  '301':'Fritext (huvud)','207':'Avsändare (Ediel-ID)','315':'Avsändarens org.nr','208':'Mottagare (Ediel-ID)',
  '314':'Sekvensnummer','209':'Anläggnings-id','258':'Sekvensnummer','210':'Avtal, startdatum',
  '211':'Avtal, slutdatum','302':'Rapportstartdatum','321':'Rapportslutdatum','216':'Giltighetsdatum – giltig from',
  '212':'Datum för första mätaravläsning','249':'Födelsedatum','508':'Tidslängd (tidsperiod)',
  '326':'Tillståndets tidstämpel','327':'Tjänsten/rapporteringen upphör','303':'Fritext (per anläggning)',
  '213':'Uppskattad årsenergi','214':'Konstant för mätare','215':'Konstant, gammal mätare','217':'Mätmetod',
  '218':'Antal siffror, mätare','219':'Antal siffror, gammal mätare','306':'Installationsstatus','307':'Tariffkod',
  '220':'Prioritet','222':'Rapporteringsfrekvens','223':'Transaktionstyp (undertyp)',
  '259':'Mätare, tidsintervall (räkneverkskod)','254':'Avräkningsmetod (dygns/månads)','242':'Produktkod',
  '506':'Produkt id (Energiprodukt)','310':'Kundstatus','513':'Riktning (Typ av anläggning)',
  '322':'Tillståndets status','323':'Tillståndets syfte','324':'Orsak till tillståndets upphörande',
  '224':'Mätarnummer','225':'Gammalt mätarnummer','308':'Leverantörens avtalsnr','260':'Nätområdesid',
  '320':'Värmevärdesområde','240':'Serie-id','319':'Referens till anläggning','261':'Referens till avtal/fullmakt',
  '226':'Ärendereferens','325':'Tillståndets id','227':'Kund-id','228':'Namn-elanvändare','229':'Adress-elanvändare',
  '231':'Postnr-elanvändare','232':'Postort-elanvändare','316':'Land-elanvändare','233':'Anläggnings-id',
  '234':'Adress-anläggning','235':'Postnr-anläggning','236':'Postort-anläggning','237':'Land-anläggning',
  '250':'Fakturamottagare ID','251':'Namn-fakturamottagare','252':'Adress-fakturamottagare',
  '253':'Postnr-fakturamottgare','317':'Postort-fakturamottagare','318':'Land-fakturamottagare','262':'Balansansvarig',
})
export type ProdatAperakText =
  | {kind:'ready';text:string;fallback:'not_needed'|'included'|'unavailable'}
  | {kind:'unready';reason:'capacity'|'failure_evidence_unavailable'|'label_unavailable'}

/** P93–94 ingredients, P104 decoded capacity. Punctuation/recovery are the
 * approved bounded design conventions; no national identity is decided here. */
export function composeProdatAperakText(diagnostic: ProdatDiagnostic): ProdatAperakText {
  let text: string
  let fallback: Extract<ProdatAperakText,{kind:'ready'}>['fallback'] = 'not_needed'
  if (diagnostic.kind === 'application') text = 'En period anges där endast en dag/tidpunkt förväntas'
  else if (diagnostic.kind === 'field') {
    const label = PRODAT_APERAK_FIELD_NAMES[diagnostic.fieldNumber]
    if (!label) return {kind:'unready',reason:'label_unavailable'}
    if (diagnostic.errorKind === 'missing') {
      text = `${label} saknas`
      const own = diagnostic.occurrence.ownReferences
      if(!own || ![own.objectId,own.lineItemReference,own.customerId].every(v=>v&&(['absent','unavailable'].includes(v.kind)||v.kind==='present'&&typeof v.value==='string'&&v.value.length>0))) return {kind:'unready',reason:'failure_evidence_unavailable'}
      if (own && (own.objectId.kind === 'absent' || own.lineItemReference.kind === 'absent')) {
        if (own.customerId.kind === 'present') {text += `, kundid=${own.customerId.value}`;fallback = 'included'}
        else fallback = 'unavailable'
      }
    } else {
      const evidence = diagnostic.failureEvidence
      if (!Array.isArray(evidence) || !evidence.length || evidence.some(e => !e || typeof e.content !== 'string' || !e.content.length || !e.raw || !e.locator)) return {kind:'unready',reason:'failure_evidence_unavailable'}
      text = `Felaktigt ${label} ${evidence.map(e=>e.content).join(' / ')}`
    }
  } else return {kind:'unready',reason:'failure_evidence_unavailable'}
  return Array.from(text).length > 70 ? {kind:'unready',reason:'capacity'} : {kind:'ready',text,fallback}
}
