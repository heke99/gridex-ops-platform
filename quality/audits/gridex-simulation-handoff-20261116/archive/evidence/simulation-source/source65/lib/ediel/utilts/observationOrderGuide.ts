import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { canonicalUtiltsTransactions } from './canonicalObservationScope'
import type { UtiltsValidationIssue } from '@/lib/ediel/utiltsEngine.part-1'

/** U §3.6.18: either block order is allowed; never repair physical order. */
export function utiltsObservationOrderGuideIssues(raw: string): UtiltsValidationIssue[] {
  const wire = tokenizeEdifact(raw)
  const start = wire.segments.findIndex(segment => segment.tag === 'UNH')
  if (start < 0) return []
  const issues: UtiltsValidationIssue[] = []
  for (const transaction of canonicalUtiltsTransactions(wire.segments.slice(start), wire.una, 0)) {
    const seenBlocks = new Set<string>()
    const lastTime = new Map<string, string>()
    const readings = new Set<string>()
    let block: string | null = null
    let register: string | null = null
    let meter: string | null = null
    const report = (code: string, description: string, field: string,occurrence:{segmentIndex:number;elementIndex:number;componentIndex:number}) => {
      if (issues.some(issue => issue.code === code && issue.referenceNumber === transaction.transactionId)) return
      issues.push({severity:'error',kind:'application',code,title:'Felaktig observationsordning',description,
        aperakErcCode:'42',aperakFieldCode:field,aperakText:'INCORRECT DATA',
        aperakInvalidOccurrence:occurrence,
        referenceQualifier:transaction.transactionId ? 'ACW' : null, referenceNumber:transaction.transactionId,lineItemReference:transaction.transactionId})
    }
    for (const observation of transaction.observations) {
      for (const reference of observation.references.filter(reference => reference.directReferenceSlot)) {
        if (reference.qualifier === 'AES') register = reference.value
        if (reference.qualifier === 'MG' || reference.qualifier === 'SE') meter = reference.value
      }
      for (const quantity of observation.quantities) {
        const type = quantity.qualifier === '136' ? 'energy' : quantity.qualifier === '220' ? 'reading' : null
        if (!type) continue
        if (block !== type) {
          if (seenBlocks.has(type)) report('UTILTS_OBSERVATION_BLOCK_NOT_CONTIGUOUS','Energi respektive mätarställningar måste ligga i var sitt sammanhängande block.','QTY/6063',{segmentIndex:quantity.segmentIndex,elementIndex:1,componentIndex:0})
          seenBlocks.add(type)
          block = type
        }
        const date = observation.segments.find(segment => segment.tag === 'DTM' && segmentComposite(segment,1,wire.una)[0] === '597')
        const components = date ? segmentComposite(date,1,wire.una) : []
        // Only compare source-supported compact calendar forms of equal format.
        // Missing/invalid dates belong to their field guide, never a guessed time.
        const time = components[1]
        const format = components[2]
        const valid = Boolean(time && ((format === '203' && /^\d{12}$/.test(time)) || (format === '204' && /^\d{14}$/.test(time)) || (format === '102' && /^\d{8}$/.test(time))))
        if (!valid) continue
        const timestamp = format === '203' ? `${time}00` : time
        const calendarKind = format === '102' ? 'date' : 'timestamp'
        const registerScope = type === 'reading' ? JSON.stringify([register,meter]) : ''
        const key = `${type}:${registerScope}:${calendarKind}`
        const previous = lastTime.get(key)
        if (previous && timestamp < previous) report('UTILTS_OBSERVATION_TIME_ORDER','Observationerna inom varje block och eget register måste ligga i tidsordning.','DTM/2380',{segmentIndex:date!.index,elementIndex:1,componentIndex:1})
        lastTime.set(key,timestamp)
        if (type === 'reading') {
          const value = quantity.value
          if (value === null || value === 'NULL') continue
          // Numeric lexical variants represent the same reading; no float conversion.
          const canonical = value && /^-?\d+(?:[.,]\d+)?$/.test(value)
            ? value.replace(',', '.').replace(/^(-?)0+(?=\d)/,'$1').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'').replace(/^-0$/,'0') : value
          const identity = JSON.stringify([registerScope,canonical,calendarKind,timestamp])
          if (readings.has(identity)) report('UTILTS_METER_READING_DUPLICATED','Samma mätarställning med tid får inte dupliceras inom transaktionen.','517',{segmentIndex:quantity.segmentIndex,elementIndex:1,componentIndex:1})
          readings.add(identity)
        }
      }
    }
  }
  return issues
}
