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
    const report = (code: string, description: string, field: string) => {
      if (issues.some(issue => issue.code === code && issue.referenceNumber === transaction.transactionId)) return
      issues.push({severity:'error',kind:'application',code,title:'Felaktig observationsordning',description,
        aperakErcCode:'42',aperakFieldCode:field,aperakText:'INCORRECT DATA',
        referenceQualifier:transaction.transactionId ? 'ACW' : null, referenceNumber:transaction.transactionId,lineItemReference:transaction.transactionId})
    }
    for (const observation of transaction.observations) {
      for (const quantity of observation.quantities) {
        const type = quantity.qualifier === '136' ? 'energy' : quantity.qualifier === '220' ? 'reading' : null
        if (!type) continue
        if (block !== type) {
          if (seenBlocks.has(type)) report('UTILTS_OBSERVATION_BLOCK_NOT_CONTIGUOUS','Energi respektive mätarställningar måste ligga i var sitt sammanhängande block.','QTY/6063')
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
        const key = `${type}:${format}`
        const previous = lastTime.get(key)
        if (previous && time < previous) report('UTILTS_OBSERVATION_TIME_ORDER','Observationerna inom varje block måste ligga i tidsordning.','DTM/2380')
        lastTime.set(key,time)
        if (type === 'reading') {
          const value = quantity.value
          // Numeric lexical variants represent the same reading; no float conversion.
          const canonical = value && /^-?\d+(?:[.,]\d+)?$/.test(value)
            ? value.replace(',', '.').replace(/^(-?)0+(?=\d)/,'$1').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'').replace(/^-0$/,'0') : value
          const identity = JSON.stringify([canonical,format,time])
          if (readings.has(identity)) report('UTILTS_METER_READING_DUPLICATED','Samma mätarställning med tid får inte dupliceras inom transaktionen.','517')
          readings.add(identity)
        }
      }
    }
  }
  return issues
}
