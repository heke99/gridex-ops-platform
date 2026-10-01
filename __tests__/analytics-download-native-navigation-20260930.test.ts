import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { expect,it,vi } from 'vitest'
import { ReportsList } from '@/app/admin/analytics/_components'

function nodes(value:ReactNode):ReactElement<Record<string,unknown>>[] {
  if(Array.isArray(value)) return value.flatMap(nodes)
  if(!isValidElement(value)) return []
  const node=value as ReactElement<Record<string,unknown>>
  return [node,...nodes(node.props.children as ReactNode)]
}
it('the actual report control leaves attachment download to native navigation in the installed Next click handler',()=>{
  const link=nodes(ReportsList({reports:[{key:'company_monthly_metrics',label:'Synthetic report',description:'Synthetic report'}],month:'2026-09-01'}))
    .find(node=>String(node.props.href??'').startsWith('/admin/analytics/export'))!
  expect(link.props.href).toBe('/admin/analytics/export?report=company_monthly_metrics&month=2026-09')
  const require=createRequire(import.meta.url)
  const installed=readFileSync(require.resolve('next/dist/client/app-dir/link.js'),'utf8')
  const source=installed.slice(installed.indexOf('function isModifiedEvent('),installed.indexOf('function formatStringOrUrl('))
  expect(source).toContain('function linkClicked(')
  const dispatch=vi.fn(),preventDefault=vi.fn()
  // Execute the unmodified installed framework click function. Outer browser
  // location/router dependencies are controlled; no HTTP/browser PASS claim.
  const click=runInNewContext(source+'\nlinkClicked',{window:{},_islocalurl:{isLocalURL:()=>true},
    _react:{default:{startTransition:(callback:()=>void)=>callback()}},_routerreducertypes:{ScrollBehavior:{Default:'default',NoScroll:'none'}},
    require:()=>({dispatchNavigateAction:dispatch})}) as (event:unknown,href:unknown,ref:unknown)=>void
  click({currentTarget:{nodeName:'A',getAttribute:()=>null,hasAttribute:(name:string)=>name==='download' && link.props.download!==undefined && link.props.download!==false},preventDefault},link.props.href,{current:null})
  expect(preventDefault).not.toHaveBeenCalled()
  expect(dispatch).not.toHaveBeenCalled()
})
