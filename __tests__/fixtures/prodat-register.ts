import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'
// Independent source oracle: original P26.A r3 pp15–16,47,114–116.
// Do NOT derive expected line/register numbering or later-register omissions
// from the runtime descriptor/renderer under test.
export type Parts = readonly (string | readonly string[])[]
export const alphabets = [[":", "+", "?", "'"], ['*', ';', '!', '~'], ['^', '|', '!', '%']] as const
export const line = (sequence: string, id: string, register?: string, agency = '89'): Parts =>
  register === undefined ? ['LIN',sequence,'',[id,'','',agency]] : ['LIN',sequence,'',[id,'','',agency],['1',register]]
export const qty = (value: string): Parts => ['QTY',['31',value,'KWH']]
export const characteristic = (qualifier: string, value: string, position = 0): Parts[] =>
  [['CCI','',qualifier],['CAV',[...Array<string>(position).fill(''),value]]]
export const common = (id: string, name: string, date = '202610010000'): Parts[] => [
  ['DTM',['92',date,'203']], ['DTM',['354','15','806']],
  ...characteristic('Z13','Z22'), ...characteristic('Z04','Z03'),
  ['RFF',['MG',`METER-${id}`]], ['RFF',['Z05',`NET-${id}`]], ['RFF',['LI',`CASE-${id}`]],
  ['NAD','UD',['CUSTOMER-'+id,'','89'],'',name,'Street','City','','12345','SE'],
]
export function raw(body: readonly Parts[], code = 'Z04', alphabet: readonly string[] = alphabets[0]): string {
  const [component, element, release, segment] = alphabet
  const encode = (s: string) => [...s].map(ch => alphabet.includes(ch) ? release + ch : ch).join('')
  const render = (p: Parts) => p.map(v => typeof v === 'string' ? encode(v) : v.map(encode).join(component)).join(element)
  return `UNA${component}${element}.${release} ${segment}` + [
    ['UNB',['UNOC','3'],'S','R',['260917','1200'],'I','','23-DDQ-PRODAT'],
    ['UNH','M',['PRODAT','D','97A','UN','E2SE6A']],['BGM',code,'D','9','AB'],
    ['DTM',['137','202609171200','203']], ['DTM',['ZZZ','1','805']],
    ...body,['UNT',String(body.length + 5),'M'],['UNZ','1','I'],
  ].map(render).join(segment) + segment
}
export function input(payload: string, code = 'Z04') {
  const t = tokenizeEdifact(payload)
  return { family: 'PRODAT', code, rawSegments: t.segments.map(s => s.raw), una: t.una, mode:'parse' as const }
}
export const rule = (field: string, code = 'Z04') => canonicalProdat26AFieldRules(code).find(r => r.fieldNumber === field)!
export function validate(payload: string, fields = ['314','209','258'], code = 'Z04') {
  return validateFieldMatrixPayload(input(payload,code),fields.map(field => rule(field,code)))
}
export const blocked = (payload: string, fields?: string[], code?: string) => validate(payload,fields,code).some(i => i.blocking)

// P26.A p22/79: independent UD prerequisites for E subtype fixtures.
export const endUser = (): Parts => ['NAD','UD',['SYNTHETIC','','89'],'','Synthetic','','Town','','00123','SE']
