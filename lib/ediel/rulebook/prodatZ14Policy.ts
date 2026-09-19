import { prodatDateField, prodatDateSyntaxIssues } from '@/lib/ediel/prodat/prodatDateFields'
import { segmentComposite, segmentElementCount, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna } from '@/lib/ediel/core/una'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { prodatCharacteristicField } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { prodatPartySyntaxIssues } from '@/lib/ediel/prodat/prodatPartyFields'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatSourceSubtypeRule, resolveProdatSourceSubtypeRequirement } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import { prodatEndUserWireSubtype } from '@/lib/ediel/rulebook/prodatEndUserPolicy'
import { prodatProductMarket } from '@/lib/ediel/rulebook/prodatProductScope'
import { validateFieldMatrixPayload, type FieldMatrixEvaluationInput, type RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

// P26.A §2.6 pp57/63/68/72. This finite vocabulary does not infer a
// process/market/temporal permission from the presence of a valid code.
const Z14_CHARACTERISTIC_CODES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '217':Object.freeze(['Z01','Z02','Z03','Z04']), '222':Object.freeze(['D','W','M','Q','Y']),
  '506':Object.freeze(['8716867000030']), '513':Object.freeze(['E17','E18','E19']),
})

/** P26.A p22: both parents precede child presence checks. This overlay owns
 * only the twelve Z14 D cells and these parents' existing R/O/- children. */
export function isZ14DependentField(field: string): boolean {
  return Boolean(prodatSourceSubtypeRule('Z14', field))
    || ['END_USER_GROUP','INSTALLATION_GROUP','229','231','232','316','233','234','235','236','237'].includes(field)
}

/** Outbound only. Scan supplied data before narrowing, then evaluate each
 * actual object reason. Never use a root snapshot, byCell, or another message. */
export function validateProdatZ14Policy(input: FieldMatrixEvaluationInput, rules: readonly RulebookFieldRule[]): EdielRulebookIssue[] {
  if (input.code !== 'Z14' || !rules.some(rule => isZ14DependentField(rule.fieldNumber ?? ''))) return []
  const una = input.una ?? parseUna(null)
  const selected = rules.filter(rule => isZ14DependentField(rule.fieldNumber ?? ''))
  const { groups, tokens } = prodatRegisterGroups(prodatRegisterMessageSegments(input.rawSegments ?? [], una), una, 'Z14')
  const scopes = groups.filter(group => !group.validRegisterChain || group.registerPosition === 1).map(group => group.segments)
  if (!groups.length) scopes.push(tokens.some(t => ['UNH','UNB','BGM'].includes(t.tag)) ? [] : tokens)
  const issues: EdielRulebookIssue[] = []
  const fail = (field: string, code: string, detail: string) => {
    const rule = selected.find(rule => rule.fieldNumber === field)
    if (!rule) return
    issues.push({scope:'prodat_dependent',severity:'error',blocking:true,code,
      title:'PRODAT Z14 följer inte källregeln',fieldPath:rule.segmentPath,
      description:`Z14:${field}, P26.A §2.2 s.16–22 / §2.6: ${detail}.`})
  }
  for (const failure of prodatDateSyntaxIssues(tokens, una)) {
    fail(failure.fieldNumber, 'PRODAT_DEPENDENT_FIELD_FORMAT_INVALID', 'DTM har fel format, placering eller entydighet')
  }
  const allowed = new Map<number, {scope: EdifactTokenizedSegment[]; beforeReference: boolean; beforeParty: boolean}>()
  for (const scope of scopes) {
    let beforeReference = true, beforeParty = true
    for (const token of scope) {
      if (token.tag === 'NAD') beforeParty = false
      if (['NAD','RFF'].includes(token.tag)) beforeReference = false
      allowed.set(token.index,{scope,beforeReference,beforeParty})
    }
  }
  const extra = (token: EdifactTokenizedSegment, last: number) => {
    for (let i = last + 1; i <= segmentElementCount(token,una); i++) if (segmentComposite(token,i,una).some(v=>v.trim())) return true
    return false
  }
  // SG14 CCI/CAV fields: exact components, single adjacent pair, no values
  // outside this object's characteristic group. Empty pairs remain supplied.
  for (const rule of selected) {
    const field = rule.fieldNumber!
    const date = prodatDateField(field)
    if (date) for (const token of tokens) {
      if (token.tag !== 'DTM' || segmentComposite(token,1,una)[0] !== date.dateQualifier) continue
      const scope = allowed.get(token.index)?.scope
      const firstChildGroup = scope?.find(t => ['CCI','RFF','NAD'].includes(t.tag))
      if (!scope || (firstChildGroup && token.index >= firstChildGroup.index)) {
        fail(field,'PRODAT_DEPENDENT_FIELD_SCOPE_INVALID','DTM måste ligga i objektets SG8 före karakteristik, referenser och parter')
      }
    }
    const descriptor = prodatCharacteristicField(field)
    if (!descriptor) continue
    const qualifier = descriptor.segmentPath.slice(5,-4)
    for (const [index, token] of tokens.entries()) {
      const cci = segmentComposite(token,2,una)
      if (token.tag !== 'CCI' || cci[0]?.trim().toUpperCase() !== qualifier) continue
      const placement = allowed.get(token.index)
      if (!placement?.beforeReference) fail(field,'PRODAT_DEPENDENT_FIELD_SCOPE_INVALID','CCI/CAV måste ligga i objektets första SG14 före RFF/NAD')
      const cav = tokens[index+1], parts = cav?.tag === 'CAV' ? segmentComposite(cav,1,una) : []
      const duplicates = placement?.scope.filter(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]?.trim().toUpperCase()===qualifier).length !== 1
      const position = descriptor.cavComponent
      if (duplicates || cci[0] !== qualifier || cci.slice(1).some(v=>v.trim()) || segmentComposite(token,1,una).some(v=>v.trim())
        || extra(token,2) || !cav || cav.tag !== 'CAV' || extra(cav,1) || tokens[index+2]?.tag === 'CAV'
        || !Z14_CHARACTERISTIC_CODES[field]?.includes(parts[position])
        || !parts[position]?.trim() || parts[position].length > (position === 0 ? 3 : 35)
        || parts.some((v,i)=>i!==position && Boolean(v.trim()))) {
        fail(field,'PRODAT_DEPENDENT_FIELD_FORMAT_INVALID','exakt ett korrekt CCI/CAV-par med värdet i rätt komponent krävs')
      }
    }
  }
  // SG16 references: p77 field260 has exactly three characters; p78
  // field325 is an..35. Extra/duplicate/header/party data must not disappear.
  for (const [field, qualifier, maximum] of [['260','Z05',3],['325','Z09',35]] as const) {
    for (const token of tokens) {
      const parts=segmentComposite(token,1,una)
      if (token.tag!=='RFF'||parts[0]?.trim().toUpperCase()!==qualifier) continue
      const placement=allowed.get(token.index)
      if (!placement?.beforeParty) fail(field,'PRODAT_DEPENDENT_FIELD_SCOPE_INVALID','RFF måste ligga i objektets första SG16 före NAD')
      if (parts[0]!==qualifier || !parts[1]?.trim() || parts[1].length>maximum || (field==='260'&&parts[1].length!==3)
        || parts.slice(2).some(v=>v.trim()) || extra(token,1)
        || placement?.scope.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,una)[0]?.trim().toUpperCase()===qualifier).length!==1) {
        fail(field,'PRODAT_DEPENDENT_FIELD_FORMAT_INVALID','referensens längd, entydighet eller komponenter följer inte källtabellen')
      }
    }
  }
  for (const token of tokens) {
    const role=segmentComposite(token,1,una)
    if (token.tag!=='NAD'||!['UD','IT'].includes(role[0]?.trim().toUpperCase())) continue
    const parent=role[0]?.trim().toUpperCase()==='UD'?'END_USER_GROUP':'INSTALLATION_GROUP'
    if (!allowed.has(token.index)) fail(parent,'PRODAT_DEPENDENT_FIELD_SCOPE_INVALID','NAD måste tillhöra objektet, inte meddelandehuvudet')
    if (role.length!==1 || role[0]!==role[0].trim().toUpperCase() || extra(token,9) || prodatPartySyntaxIssues([token],una).length) {
      fail(parent,'PRODAT_DEPENDENT_FIELD_FORMAT_INVALID','angiven part innehåller ogiltiga eller oanvända komponenter')
    }
    const country = segmentComposite(token,9,una)
    if (country.some(v=>v.length) && (country.length!==1 || !/^[A-Z]{2,3}$/.test(country[0]))) {
      fail(parent,'PRODAT_DEPENDENT_FIELD_FORMAT_INVALID','landkoden måste vara en ensam kod utan utfyllnad')
    }
    // Validate decoded widths before the ordinary display readers trim text.
    for (const [element,maxima] of [[2,[35,3,3]],[4,[35,35]],[5,[35,35,35]],[6,[35]],[8,[9]],[9,[3]]] as const) {
      const parts=segmentComposite(token,element,una)
      if (maxima.some((max,i)=>(parts[i]?.length ?? 0)>max)) fail(parent,'PRODAT_DEPENDENT_FIELD_FORMAT_INVALID','partkomponenten överskrider tillåten längd')
    }
  }
  for (const scope of scopes) {
    const reasonIndex=scope.findIndex(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]==='Z13')
    const rawReason=reasonIndex<0?null:segmentComposite(scope[reasonIndex+1],1,una)[0]
    const subtype=rawReason===rawReason?.trim()?prodatEndUserWireSubtype('Z14',scope,una):null
    const identity=segmentComposite(scope.find(t=>t.tag==='LIN'),3,una)[0]
    const context=`Objekt ${identity || '(saknar identitet)'}`
    for (const rule of selected) {
      const field=rule.fieldNumber!
      const source=prodatSourceSubtypeRule('Z14',field)
      const requirement=resolveProdatSourceSubtypeRequirement({messageCode:'Z14',fieldNumber:source?field:'209',subtype,market:prodatProductMarket(input)})
      if (requirement==='undetermined'||requirement===null) {
        fail(field,'PRODAT_DEPENDENT_CONDITION_UNDETERMINED',`${context}: exakt en giltig korrekt placerad transaktionsorsak krävs${source?.market?'; EL måste styrkas av UNB Application Reference':''}`)
        continue
      }
      const parent=['END_USER_GROUP','INSTALLATION_GROUP'].includes(field)
      const role=field==='END_USER_GROUP'?'UD':field==='INSTALLATION_GROUP'?'IT':null
      if (parent && requirement==='required') {
        if (scope.filter(t=>t.tag==='NAD'&&segmentComposite(t,1,una)[0]?.trim().toUpperCase()===role).length!==1) {
          fail(field,'PRODAT_DEPENDENT_PARENT_CARDINALITY_INVALID',`${context}: exakt en ${role}-grupp krävs`)
        }
      }
      // Preserve the matrix's positive-parent O/- children. Only the twelve D
      // fields and two parent presences receive the new required outcome.
      const effective = requirement==='forbidden' ? 'forbidden' : source||parent ? 'required' : rule.requirement
      const failures=validateFieldMatrixPayload({...input,rawSegments:scope.map(t=>t.raw),mode:'parse'},[{...rule,requirement:effective}])
      issues.push(...failures.map(f=>({...f,scope:'prodat_dependent' as const,description:`${context}; Z14:${field}: ${f.description}`})))
      if (field==='233'&&requirement==='required') {
        const party=scope.find(t=>t.tag==='NAD'&&segmentComposite(t,1,una)[0]==='IT')
        if (party && segmentComposite(party,2,una)[0]!==identity) fail(field,'PRODAT_DEPENDENT_INSTALLATION_ID_INVALID',`${context}:233 måste vara samma id som209`)
      }
    }
  }
  return issues
}

export function z14DependentRules(): RulebookFieldRule[] {
  return canonicalProdat26AFieldRules('Z14').filter(rule=>isZ14DependentField(rule.fieldNumber ?? ''))
}

