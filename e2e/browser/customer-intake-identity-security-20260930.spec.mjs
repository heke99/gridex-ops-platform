import { test, expect } from '@playwright/test'
import { importJWK, SignJWT } from 'jose'
import { localProofEnabled, localProofFixture, localProofSql, proofQuote, proofGet, proofPost } from '../helpers/customer-api-proof.mjs'

const fixtureEnv='GRIDEX_INTAKE_IDENTITY_SECURITY_FIXTURE_PATH'
const enabled=localProofEnabled('GRIDEX_INTAKE_IDENTITY_SECURITY_LOCAL_E2E',fixtureEnv)
test.skip(!enabled,'Requires the real disposable migrated intake, two-issuer and GoTrue fixture.')
test.describe.configure({mode:'serial',retries:0})
test.use({trace:'off',video:'off',screenshot:'off'})
const f=enabled?localProofFixture(fixtureEnv):null
if(enabled&&['RESEND_API_KEY','EDIEL_SMTP_PASS','EDIEL_SMTP_PASSWORD'].some(key=>Boolean(process.env[key]?.trim())))throw new Error('intake_identity_provider_credentials_forbidden')
const origin='http://127.0.0.1:3000',casesPath='/api/v1/customer/cases',mePath='/api/v1/customer/me'

async function headers(c,method,path,signer=c,claims={}){
  const key=await importJWK(signer.signingKey,'RS256')
  const assertion=await new SignJWT({company_id:c.companyId,api_client_id:c.clientId,customer_id:c.customerId,
    action:`${method} ${path}`,email:f.forms.known.email,...claims})
    .setProtectedHeader({alg:'RS256',kid:signer.kid}).setIssuer(signer.issuer).setAudience('gridex-customer-portal')
    .setSubject(signer.subject).setIssuedAt().setExpirationTime('5m').sign(key)
  return {authorization:`Bearer ${c.key}`,'x-gridex-customer-assertion':assertion,
    'x-gridex-customer-number':c.customerNumber,'x-gridex-customer-email':f.forms.known.email}
}
function denialGraph(){
  const companies=f.companies.map(proofQuote).join(',')
  const tables=['customers','customer_portal_accounts','customer_contacts','customer_addresses','customer_cases','customer_case_events','customer_support_threads',
    'customer_support_messages','canonical_command_results','customer_operation_tasks','customer_contracts','customer_invoices',
    'external_contract_intakes','customer_operation_events','canonical_domain_events','canonical_event_outbox','company_memberships','user_roles','user_permissions']
  return localProofSql(`SELECT jsonb_build_object(${tables.map(table=>`${proofQuote(table)},(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.${table} t WHERE company_id IN(${companies}))`).join(',')});`)
}
function assertNoPrivateResponse(text){
  for(const value of [f.forms.historical.email,f.forms.known.email,f.forms.unknown.email,
    f.historicalRow.id,f.historicalRow.created_customer_id,f.historicalRow.created_case_id,
    'PRIVATE_INTAKE_HISTORY_CANARY','PRIVATE_INTAKE_FINANCE_CANARY',...f.consumers.flatMap(c=>[c.customerId,c.userId,c.displayName])]
    .filter(value=>typeof value==='string'&&value.length>0))expect(text).not.toContain(value)
}
async function localBrowser(context){
  const blocked=[]
  await context.route('**/*',async route=>{
    const host=new URL(route.request().url()).hostname
    if(host!=='127.0.0.1'&&host!=='localhost'){blocked.push(host);await route.abort('blockedbyclient')}
    else await route.continue()
  })
  return blocked
}

test('real anonymous Server Action rejects cross-origin writes and hides historical progress for known and unknown intake',async({page,request})=>{
  test.setTimeout(180_000)
  await localBrowser(page.context())
  await page.goto(`/teckna-avtal?bolag=${encodeURIComponent(f.forms.known.company_slug)}&offer_reference=${encodeURIComponent(f.forms.known.offer_reference)}`)
  const hidden=await page.locator('form input[type="hidden"]').evaluateAll(inputs=>Object.fromEntries(inputs.map(input=>[input.name,input.value])))
  expect(Object.keys(hidden).some(key=>key.startsWith('$ACTION_'))).toBe(true)
  const forged={company_id:f.companies[1],customer_id:f.consumers[1].customerId,actor_user_id:f.admin.userId,
    verified:'true',update_existing:'true',role:'owner',status:'active',billing_profile:'forged',invoice_email:'forged@example.invalid'}
  const before=denialGraph()
  for(const attackOrigin of ['https://cross-origin.example.test','null']){
    const denied=await proofPost(request,'/teckna-avtal',{headers:{origin:attackOrigin},
      multipart:{...hidden,...f.forms.unknown,...forged},maxRedirects:0})
    expect(denied.status()).toBeGreaterThanOrEqual(400)
    assertNoPrivateResponse(await denied.text())
    expect(denialGraph()).toEqual(before)
  }
  const locations=[],durations=[]
  for(const form of [f.forms.historical,f.forms.known,f.forms.unknown]){
    const started=Date.now()
    const received=await proofPost(request,'/teckna-avtal',{headers:{origin},multipart:{...hidden,...form,...forged},maxRedirects:0})
    durations.push(Date.now()-started)
    expect(received.status()).toBe(303)
    const location=received.headers().location
    expect(location).toBeTruthy()
    const url=new URL(location,origin)
    expect(url.pathname).toBe('/teckna-avtal');expect(url.searchParams.get('status')).toBe('success')
    expect(url.searchParams.get('message')).toBe('Tack. Vi har tagit emot avtalet och behöver granska några uppgifter innan flödet går vidare.')
    assertNoPrivateResponse(location);assertNoPrivateResponse(await received.text())
    locations.push(url.pathname+url.search)
  }
  expect(new Set(locations).size).toBe(1)
  // Recorded diagnostic durations are not a constant-time acceptance claim.
  console.log(`INTAKE_ANONYMOUS_HTTP_PASS origin_mismatch_and_null_denied=true denial_graph_unchanged=true historical_known_unknown_same_redirect=true private_history_hidden=true durations_ms=${durations.join(',')}`)
})

test('two valid issuers sharing sub and email resolve their own accounts and reject mixed authority at actual HTTP',async({request})=>{
  test.setTimeout(120_000)
  const [a1,a2,b1]=f.consumers,before=denialGraph()
  expect(a1.subject).toBe(a2.subject);expect(a1.subject).toBe(b1.subject)
  expect(a1.issuer).not.toBe(a2.issuer);expect(a2.issuer).toBe(b1.issuer)
  for(const c of f.consumers){
    const response=await proofGet(request,mePath,{headers:await headers(c,'GET',mePath)})
    expect(response.status()).toBe(200)
    const data=(await response.json()).data
    expect(data).toMatchObject({customer_number:c.customerNumber,display_name:c.displayName,email:f.forms.known.email})
    for(const other of f.consumers.filter(other=>other!==c))expect(JSON.stringify(data)).not.toContain(other.displayName)
  }
  const valid=await headers(a1,'GET',mePath)
  const attacks=[await headers(a1,'GET',mePath,a2),
    {...valid,'x-gridex-customer-number':a2.customerNumber},
    {...valid,'x-gridex-auth-user-id':a2.userId},
    {...valid,authorization:`Bearer ${b1.key}`},
    {authorization:`Bearer ${a1.key}`,'x-gridex-customer-email':f.forms.known.email}]
  for(const attack of attacks){
    const response=await proofGet(request,mePath,{headers:attack})
    expect(response.status()).toBe(403)
    const body=await response.json();expect(body.data).toBeUndefined()
    assertNoPrivateResponse(JSON.stringify(body))
  }
  const anonymous=await proofGet(request,`${mePath}?email=${encodeURIComponent(f.forms.known.email)}`)
  expect(anonymous.status()).toBe(401);expect((await anonymous.json()).data).toBeUndefined()
  expect(denialGraph()).toEqual(before)
  console.log('INTAKE_TWO_ISSUER_HTTP_PASS same_sub_email=true own_profiles=3 crossed_issuer_selector_subject_tenant_denied=true bare_email_not_authority=true graph_unchanged=true')
})

async function login(page,actor,next){
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('E-post').fill(actor.email);await page.getByLabel('Lösenord').fill(actor.password)
  await page.getByRole('button',{name:'Logga in',exact:true}).click()
  await page.waitForURL(url=>!url.pathname.startsWith('/login'))
}
test('forged support fields have no effect and stored anonymous names and customer messages render as text in real UI',async({request,browser})=>{
  test.setTimeout(240_000)
  const a=f.consumers[0],before=denialGraph()
  const base={title:'Synthetic message XSS probe',body:f.messageCanary}
  for(const [key,value] of Object.entries({company_id:f.companies[1],customer_id:f.consumers[1].customerId,actor_user_id:f.admin.userId,
    verified:true,role:'owner',status:'active',billing_profile:{invoice_email:'forged@example.invalid'}})){
    const denied=await proofPost(request,casesPath,{headers:{...await headers(a,'POST',casesPath),'idempotency-key':`intake-forged-${key}`},data:{...base,[key]:value}})
    expect(denied.status()).toBe(422);expect((await denied.json()).data).toBeUndefined()
    expect(denialGraph()).toEqual(before)
  }
  const anonymous=await proofPost(request,casesPath,{data:base})
  expect(anonymous.status()).toBe(401);expect(denialGraph()).toEqual(before)
  const received=await proofPost(request,casesPath,{headers:{...await headers(a,'POST',casesPath),'idempotency-key':'intake-security-authorized-message'},data:base})
  expect(received.status()).toBe(201)
  const saved=(await received.json()).data
  expect(saved).toMatchObject({revision:1,status:'open',replayed:false})
  expect(saved.case_reference).toMatch(/^case_[A-Za-z0-9_-]{32}$/)
  const ownerContext=await browser.newContext({baseURL:origin}),adminContext=await browser.newContext({baseURL:origin})
  try{
    await localBrowser(ownerContext);await localBrowser(adminContext)
    const owner=await ownerContext.newPage()
    await login(owner,f.owner,`/portal/arenden?case_reference=${encodeURIComponent(saved.case_reference)}`)
    await expect(owner.getByText(f.messageCanary,{exact:true})).toBeVisible()
    await expect(owner.locator('img[src="gridex-message-xss-canary"]')).toHaveCount(0)
    expect(await owner.evaluate(()=>window.__GRIDEX_MESSAGE_XSS)).toBeUndefined()
    const admin=await adminContext.newPage()
    await login(admin,f.admin,'/admin/website-applications')
    await expect(admin.getByText(f.nameCanary,{exact:false}).first()).toBeVisible()
    await expect(admin.locator('img[src="gridex-intake-xss-canary"]')).toHaveCount(0)
    expect(await admin.evaluate(()=>window.__GRIDEX_INTAKE_XSS)).toBeUndefined()
    await owner.goto(`/teckna-avtal?status=error&message=${encodeURIComponent('<script>window.__GRIDEX_FLASH_XSS=1</script>')}`)
    await expect(owner.getByText('Avtalet kunde inte tas emot.',{exact:true})).toBeVisible()
    expect(await owner.evaluate(()=>window.__GRIDEX_FLASH_XSS)).toBeUndefined()
    console.log('INTAKE_STORED_XSS_BROWSER_PASS forged_fields_422_no_graph_change=true anonymous_mutation_denied=true authorized_message_stored=true actual_portal_and_ops_literal_text=true public_flash_allowlisted=true external_browser_requests_blocked=true')
  }finally{await Promise.all([ownerContext.close(),adminContext.close()])}
})
