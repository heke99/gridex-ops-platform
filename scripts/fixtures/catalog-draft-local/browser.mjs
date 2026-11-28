import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { draftSaveButton, openCatalogueDraft } from './driver.ts'

const origin = process.env.GRIDEX_CATALOG_ORIGIN
assert.match(origin ?? '', /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/)
assert(new URL(origin).port)
const requireFromFixture = createRequire(new URL('./source/package.json', import.meta.url))
const { chromium } = requireFromFixture('playwright')
const companyId = 'e1000000-0000-4000-8000-000000000001'
const offerId = 'e3000000-0000-4000-8000-000000000002'
const actorId = 'e2000000-0000-4000-8000-000000000001'
const target = { origin, companyId, offerId, offerName:'Utkast två' }
const active = origin + '/admin/contracts?' + new URLSearchParams({company_id:companyId,view:'active',page:'1'})
const receipt = process.env.GRIDEX_CATALOG_DRAFT_RECEIPT
assert.equal(receipt, fileURLToPath(new URL('./write-receipt.json', import.meta.url)))
assert.equal(existsSync(receipt),false)
const executablePath = process.env.GRIDEX_CATALOG_CHROMIUM || undefined
const browser = await chromium.launch({executablePath,args:[
  '--disable-dev-shm-usage','--disable-background-networking','--no-proxy-server',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
]})
try {
  async function session(javaScriptEnabled) {
    const context = await browser.newContext({javaScriptEnabled,serviceWorkers:'block',viewport:{width:1200,height:850}})
    await context.addCookies([{name:'gridex_admin_selected_company_id',value:companyId,url:origin,httpOnly:true}])
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url())
      if (url.protocol === 'ws:' && url.host === new URL(origin).host) socket.connectToServer()
      else socket.close()
    })
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(25000)
    const posts = []
    page.on('request',request=> {
      if (request.method()==='POST') posts.push({path:new URL(request.url()).pathname,action:request.headers()['next-action']})
    })
    return {context,page,posts}
  }
  const initial = await session(false)
  assert.equal((await initial.page.goto(active,{waitUntil:'domcontentloaded',timeout:60000}))?.status(),200)
  await assert.rejects(draftSaveButton(initial.page,target),/ordinarie Utkast-vy/)
  assert.deepEqual(initial.posts,[])
  assert.equal(existsSync(receipt),false)
  const disabled = await openCatalogueDraft(initial.page,target)
  assert.equal(await disabled.isEnabled(),false)
  assert.deepEqual(initial.posts,[])
  assert.equal(existsSync(receipt),false)
  await initial.context.close()
  console.log('CATALOG478_NORMAL_ROUTE_BEFORE_HYDRATION_DISABLED_NO_POST')

  const live = await session(true)
  const initialResponse = await live.page.goto(active,{waitUntil:'domcontentloaded',timeout:60000})
  assert.equal(initialResponse?.status(),200)
  await assert.rejects(draftSaveButton(live.page,target),/ordinarie Utkast-vy/)
  assert.deepEqual(live.posts,[])
  assert.equal(existsSync(receipt),false)
  console.log('CATALOG478_ACTIVE_VIEW_NO_POST')
  const save = await openCatalogueDraft(live.page,target)
  await live.page.waitForFunction(()=> [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Spara avtalsutkast' && !button.disabled))
  assert.equal(await save.isEnabled(),true)
  assert.deepEqual(live.posts,[])
  assert.equal(existsSync(receipt),false)
  const name = live.page.locator('form').filter({has:save}).locator('input[name="name"]')
  await name.fill('Utkast två, redigerat')
  assert.deepEqual(await save.evaluate(button=>[...button.form.elements]
    .filter(control=>control.validity&&!control.validity.valid)
    .map(control=>[control.name,control.validationMessage])),[])
  await Promise.all([
    live.page.waitForURL(url=>url.searchParams.get('success')?.includes('Avtalsutkastet sparades.')===true,{timeout:30000}),
    save.click(),
  ])
  const redirect = new URL(live.page.url())
  assert.equal(redirect.searchParams.get('company_id'),companyId)
  assert.equal(redirect.searchParams.get('edit_offer'),offerId)
  assert.equal(live.posts.length,1)
  assert.equal(live.posts[0].path,'/admin/contracts')
  assert.match(live.posts[0].action,/^[a-f0-9]+$/)
  assert.deepEqual(JSON.parse(readFileSync(receipt,'utf8')),{
    name:'Utkast två, redigerat',companyId,offerId,actorId,lifecycleStatus:'draft',priceOptions:1,
  })
  assert.equal(await live.page.locator('input[name="name"]').inputValue(),'Utkast två, redigerat')
  assert.equal((await live.page.locator('input[name="lifecycle_status"]').inputValue()),'draft')
  console.log('CATALOG478_NORMAL_NEXT_POST_ONCE_AND_SAME_DRAFT_READBACK')
  await live.context.close()
} finally {
  await browser.close()
}
