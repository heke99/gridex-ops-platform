import {beforeEach,expect,it,vi} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
const state=vi.hoisted(()=>({access:{companyId:'own-company' as string|null,userId:'actor',email:'reader@example.invalid',permissions:['communication.read','customers.read'],roles:['platform_admin'],isAdmin:true,isPlatformAdmin:true},queries:[] as {table:string;filters:[string,unknown][]}[]}))
vi.mock('@/lib/admin/guards',()=>({requireAdminPageAccess:async()=>state.access}))
vi.mock('@/components/admin/AdminHeader',()=>({default:()=>null}))
vi.mock('@/app/admin/ediel/actions',()=>({prepareAiListAction:vi.fn(),sendEdielMessageAction:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({from:(table:string)=>{
 const q={table,filters:[] as [string,unknown][]};state.queries.push(q)
 const chain={select:()=>chain,eq:(k:string,v:unknown)=>{q.filters.push([k,v]);return chain},order:()=>chain,limit:()=>chain,then:(resolve:(v:unknown)=>unknown)=>resolve({data:[],error:null})}
 return chain
}})}))
import Page from '@/app/admin/ediel/ai-list/page'
beforeEach(()=>{state.queries.length=0;state.access.companyId='own-company';state.access.permissions=['communication.read','customers.read']})
it('reads every AI history/customer/site/point through current session and explicit selected company, including platform roles',async()=>{
 await Page()
 expect(state.queries.map(q=>q.table).sort()).toEqual(['customer_sites','customers','ediel_messages','metering_points'])
 for(const q of state.queries)expect(q.filters).toContainEqual(['company_id','own-company'])
 expect(state.queries.find(q=>q.table==='ediel_messages')?.filters).toContainEqual(['message_family','AI_LIST'])
})
it.each([null,'foreign-company'])('does not read private records with missing company or missing company-scoped permissions (%s)',async company=>{
 state.access.companyId=company;state.access.permissions=[]
 expect(renderToStaticMarkup(await Page())).toContain('Välj ett bolag')
 expect(state.queries).toEqual([])
})
it('exposes read-only history without mutation forms or implied export authority',async()=>{
 const html=renderToStaticMarkup(await Page())
 expect(html).toContain('Din aktuella behörighet medger läsning')
 expect(html).not.toContain('<form')
 expect(html).not.toContain('Generera och köa AI-lista')
})
