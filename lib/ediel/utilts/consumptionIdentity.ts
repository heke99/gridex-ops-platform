import { singleMessage, legalParty } from './receivedStructuralSources'
import { segmentComposite } from '@/lib/ediel/core/edifactTokenizer'

/** Namespace authority is independent of meter/register comparison policy.
 * Until an agency89 owner exists, a plain-text alias cannot authorize its data. */
export function supportedUtiltsConsumptionIdentity(raw: string, index: number): { transactionId: string; point: string } | null {
  try {
    const ast = singleMessage(raw, 'UTILTS')
    if (!ast || !Number.isSafeInteger(index) || index < 0
      || !legalParty(ast, 'MS', 'IDE', ['SVK', '260']) || !legalParty(ast, 'MR', 'IDE', ['SVK', '260'])) return null
    const transactions = ast.messages[0].utiltsTransactions ?? [], transaction = transactions[index]
    if (!transaction || transaction.identityQualifier !== '24' || transaction.identityComponents.length !== 1
      || !transaction.transactionId || transactions.filter(t => t.transactionId === transaction.transactionId).length !== 1) return null
    const stop = transaction.segments.findIndex(segment => segment.tag === 'SEQ')
    const header = stop < 0 ? transaction.segments : transaction.segments.slice(0, stop)
    const locations = header.filter(segment => segment.tag === 'LOC' && segmentComposite(segment, 1, ast.una)[0] === '172')
    if (locations.length !== 1 || segmentComposite(locations[0], 1, ast.una).length !== 1) return null
    const point = segmentComposite(locations[0], 2, ast.una)
    if (point.length !== 3 || point[1] !== '' || point[2] !== '9' || !point[0] || point[0] !== point[0].trim()
      || /[\u0000-\u001f\u007f]/.test(point[0])) return null
    return { transactionId: transaction.transactionId, point: point[0] }
  } catch { return null }
}
