import assert from 'node:assert/strict'
const ADMIN_SELECTED_COMPANY_COOKIE='company'
const selectedCompanyId='synthetic-company-B'
const canonicalGuardCompanyId=selectedCompanyId
let memberships: unknown[]=[{companyId:'synthetic-company-A',companyName:'A',companySlug:null,orgNumber:null,membershipRole:'owner',status:'active',companyStatus:'active'}]
const TENANT_COMPANY_REQUIRED_MESSAGE='No company'
class TenantCompanyRequiredError extends Error {}
const cache=(fn: unknown)=>fn
const cookies=async()=>({get:(name: string)=>({value:selectedCompanyId})})
const listOperationalCompaniesForUser=async(userId: string)=>memberships
const isPlatformAdminUser=async(userId: string)=>true
async function getSelectedMembershipCompany(
  memberships: CompanyMembershipSummary[]
): Promise<CompanyMembershipSummary | null> {
  const cookieStore = await cookies()
  const selectedCompanyId = cookieStore.get(ADMIN_SELECTED_COMPANY_COOKIE)?.value?.trim()
  if (!selectedCompanyId) return null

  return memberships.find((row) => row.companyId === selectedCompanyId) ?? null
}

export const getOperationalCompanyScope = cache(async function getOperationalCompanyScope(
  userId: string
): Promise<OperationalCompanyScope> {
  const memberships = await listOperationalCompaniesForUser(userId)
  const selectedMembership = await getSelectedMembershipCompany(memberships)

  if (selectedMembership) {
    return {
      companyId: selectedMembership.companyId,
      companyName: selectedMembership.companyName,
      memberships,
      requiresCompany: false,
      message: null,
      selectedByPlatformAdmin: false,
    }
  }

  if (memberships.length === 0) {
    // Callers read companyId=null as "all companies" (platform view). A tenant
    // user without an operational company must never get that, so fail closed.
    if (!(await isPlatformAdminUser(userId))) {
      throw new TenantCompanyRequiredError()
    }
    return {
      companyId: null,
      companyName: null,
      memberships,
      requiresCompany: true,
      message:
        'Kontot saknar ett bolag som är aktivt, under onboarding eller tillfälligt pausat. Avstängda, arkiverade och stängda bolag är inte valbara i tenantläget.',
      selectedByPlatformAdmin: false,
    }
  }

  const preferred = memberships.find((row) => row.membershipRole === 'owner') ?? memberships[0]

  return {
    companyId: preferred.companyId,
    companyName: preferred.companyName,
    memberships,
    requiresCompany: false,
    message: null,
    selectedByPlatformAdmin: false,
  }
})


const memberScope=await getOperationalCompanyScope('synthetic-admin')
assert.equal(memberScope.companyId,'synthetic-company-A')
assert.notEqual(memberScope.companyId,canonicalGuardCompanyId)
memberships=[]
const globalScope=await getOperationalCompanyScope('synthetic-admin')
assert.equal(globalScope.companyId,null)
console.log(JSON.stringify({status:'CONFIRMED',canonicalGuardCompanyId,withOtherMembership:memberScope.companyId,withoutMembership:globalScope.companyId},null,2))
