/** Exact expectation matching shared by both TGT comparison entry points.
 * Expected register indices are field258, never column ordinals or field314.
 * Anonymous one-column fixtures remain usable for a single actual object. */
export type ExpectedRegister<T> = {data:T; ids:readonly string[]; index:string | null; agency?:string | null}
export type ActualRegister<T> = {data:T; id:string | null; index:string | null; agency:string | null; first:boolean; valid:boolean}
const numericIndex = (value:string | null) => value && /^\d{1,6}$/.test(value) && Number(value)>0 ? Number(value) : null
export function matchProdatRegisterExpectations<A,E>(actual:readonly ActualRegister<A>[], expected:readonly ExpectedRegister<E>[]) {
  const used = new Set<ExpectedRegister<E>>()
  const objectCount = new Set(actual.map(line=>JSON.stringify([line.id,line.agency]))).size
  const matches = actual.map(line=>{
    const scoped = expected.filter(row=>row.ids.includes(line.id ?? '') && (!row.agency || row.agency===line.agency))
    const anonymous = expected.filter(row=>row.ids.length===0)
    const rows = scoped.length ? scoped : objectCount===1 && anonymous.length===expected.length ? anonymous : []
    const explicitlyIndexed = rows.some(row=>row.index!==null)
    let candidates = rows.filter(row=>explicitlyIndexed ? numericIndex(row.index)!==null && numericIndex(row.index)===numericIndex(line.index) : row.index===null)
    const sameIdAgencies = new Set(actual.filter(other=>other.id===line.id).map(other=>other.agency))
    if (sameIdAgencies.size>1 && candidates.some(row=>!row.agency)) candidates=[]
    // One unindexed source column is a partial first-register expectation, not
    // an invented copy of every register's own measurements.
    if (!line.first && !explicitlyIndexed) return {line,expected:null,error:null}
    const found=candidates.length===1 ? candidates[0] : null
    if (found) used.add(found)
    return {line,expected:found,error:!line.valid ? 'register' : found ? null : rows.length ? 'register' : 'identity'}
  })
  return {matches,missing:expected.filter(row=>!used.has(row))}
}
