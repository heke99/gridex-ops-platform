#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function mustContain(rel, needle, label = needle) {
  if (!exists(rel)) {
    failures.push(`${rel} saknas`);
    return;
  }
  const text = read(rel);
  if (!text.includes(needle)) failures.push(`${rel} saknar: ${label}`);
}

function mustNotContain(rel, needle, label = needle) {
  if (!exists(rel)) return;
  const text = read(rel);
  if (text.includes(needle))
    failures.push(`${rel} innehåller förbjudet mönster: ${label}`);
}

mustContain("lib/admin/guards.ts", "requirePlatformAdminAccess");
mustContain("lib/admin/guards.ts", "requirePlatformAdminActionAccess");
mustContain("lib/admin/guards.ts", "isPlatformAdminContext");
mustContain("lib/admin/guards.ts", "return input.roles.some");
mustNotContain(
  "lib/admin/guards.ts",
  "input.permissions.includes('tenants.write')",
  "platform access via tenants.write",
);
mustNotContain(
  "lib/admin/guards.ts",
  "input.permissions.includes('roles.manage')",
  "platform access via roles.manage",
);
mustNotContain(
  "proxy.ts",
  "permissions.includes('tenants.write')",
  "proxy platform access via tenants.write",
);
mustContain("app/dashboard/page.tsx", "isPlatformAdmin ?");
mustContain("app/dashboard/page.tsx", 'href="/admin/company-settings"');
mustNotContain(
  "app/dashboard/page.tsx",
  'title="Admin Console"',
  "company dashboard hardcoded Admin Console card",
);
mustNotContain(
  "app/dashboard/page.tsx",
  'title="Företag och användare"',
  "company dashboard hardcoded company onboarding card",
);
mustNotContain(
  "app/admin/company-settings/page.tsx",
  "href={`/admin/companies/${companyId}`}",
  "company settings link to platform company detail",
);
mustContain("app/admin/companies/actions.ts", "parseCompanyAssignableRoleKey");
mustContain("proxy.ts", "isPlatformAdminPath");
mustContain("proxy.ts", "pathname === '/admin/companies'");
mustContain("proxy.ts", "pathname === '/admin/users'");
mustContain("proxy.ts", "pathname === '/admin/roles'");
mustContain("proxy.ts", "pathname.startsWith('/admin/platform/')");
mustContain(
  "supabase/migrations/20260520_batch_6e_hard_platform_roles_only.sql",
  "gridex_user_is_platform_admin",
);
mustContain(
  "supabase/migrations/20260520_batch_6e_hard_platform_roles_only.sql",
  "r.key not in ('super_admin', 'superadmin', 'platform_admin')",
);
mustContain(
  "supabase/migrations/20260520_batch_6e_hard_platform_roles_only.sql",
  "p.key in ('tenants.write', 'permissions.manage', 'roles.manage')",
);
mustContain("app/admin/companies/page.tsx", "requirePlatformAdminAccess");
mustContain(
  "app/admin/companies/actions.ts",
  "requirePlatformAdminActionAccess",
);
mustContain("app/admin/companies/actions.ts", "assertCanManageCompanyUsers");
mustNotContain(
  "app/admin/companies/actions.ts",
  "requireAdminActionAccess({ anyOf: ['tenants.write', 'users.write'] })",
  "tenants.write OR users.write på company governance",
);
mustContain("app/admin/users/page.tsx", "requirePlatformAdminAccess");
mustContain("app/admin/users/actions.ts", "requirePlatformAdminActionAccess");
mustContain("app/admin/users/[id]/page.tsx", "requirePlatformAdminAccess");
mustContain(
  "app/admin/users/[id]/actions.ts",
  "requirePlatformAdminActionAccess",
);
mustContain("app/admin/roles/page.tsx", "requirePlatformAdminAccess");
mustContain("components/admin/AdminSidebar.tsx", "platformOnly?: boolean");
mustContain("components/admin/AdminSidebar.tsx", "isPlatformAdmin");
mustContain("app/admin/page.tsx", "isPlatformAdminContext");
mustContain("app/admin/page.tsx", 'href="/admin/company-settings"');
mustContain("lib/ediel/summary.ts", "companyId?: string | null");
mustContain(
  "app/admin/platform/ediel/rules/page.tsx",
  "requirePlatformAdminAccess",
);
mustContain(
  "app/admin/platform/ediel/versions/page.tsx",
  "requirePlatformAdminAccess",
);
mustContain(
  "app/admin/platform/ediel/routes/page.tsx",
  "requirePlatformAdminAccess",
);

mustContain("lib/tenant/entityGuards.ts", "loadCustomerTenantContext");
mustContain("lib/tenant/entityGuards.ts", "assertCompanyAccessForGuard");
mustContain("lib/tenant/entityGuards.ts", "assertCustomerSiteTenant");
mustContain("lib/tenant/entityGuards.ts", "assertMeteringPointTenant");
mustContain(
  "app/admin/customers/[id]/actions.ts",
  "requireCustomerMutationContext",
);
mustContain(
  "app/admin/customers/[id]/actions.ts",
  "assertCustomerSiteTenant",
);
mustContain(
  "app/admin/customers/[id]/actions.ts",
  "assertPowerOfAttorneyTenant",
);
mustContain(
  "app/admin/customers/[id]/switch-actions.ts",
  "assertCompanyAccessForGuard",
);
mustContain(
  "app/admin/customers/[id]/switch-create-actions.ts",
  "const companyId = await assertCompanyAccessForGuard(site.company_id, guard)",
);
mustContain(
  "app/admin/customer-info-requests/actions.ts",
  "communication.send",
);
mustContain(
  "lib/onboarding/infoRequests.ts",
  "const anchors = await resolveCustomerInfoRequestAnchors",
);
mustContain(
  "supabase/migrations/20260526_debug_batch_2_tenant_rbac_server_actions.sql",
  "gridex_debug_batch2_tenant_policy_gaps_v",
);
mustContain(
  "supabase/migrations/20260526_debug_batch_2_tenant_rbac_server_actions.sql",
  "customer_info_requests",
);
mustContain(
  "supabase/migrations/20260526_debug_batch_2_tenant_rbac_server_actions.sql",
  "power_of_attorney_scopes",
);

const reviewedServiceClientFiles = new Set([
  // Reviewed 2026-07-03 (production readiness audit): each file guards access
  // via requirePlatformAdminActionAccess / requirePlatformAdminAccess /
  // requireAdminActionAccess / requireAdminPageKeyAccess (+ tenant read scope
  // where applicable) before any supabaseService usage.
  "app/admin/companies/[id]/company-profile-actions.ts",
  "app/admin/companies/[id]/email-automation-actions.ts",
  "app/admin/companies/[id]/legal-actions.ts",
  "app/admin/customers/[id]/business-actions.ts",
  "app/admin/ediel/auto-readiness/actions.ts",
  "app/admin/ediel/auto-readiness/page.tsx",
  "app/admin/facility-requests/actions.ts",
  "app/admin/manual-mailboxes/actions.ts",
  "app/admin/manual-mailboxes/page.tsx",
  "app/admin/messages/[id]/page.tsx",
  "app/admin/messages/page.tsx",
  "app/admin/network-owners/[id]/contact-channels/actions.ts",
  "app/admin/platform/companies/[companyId]/testing/page.tsx",
  "app/admin/platform/customers/archived/page.tsx",
  "app/admin/platform/ediel/messages/page.tsx",
  "app/admin/platform/legal-templates/actions.ts",
  // Reviewed 2026-07-27: contracts/page obtains contracts.read and resolves an
  // operational company scope before its tenant-scoped readiness RPC.
  "app/admin/contracts/page.tsx",
  // Portfolio settlement pages use an authenticated admin context, then the
  // database permission RPCs scope every read/write by actor, company and
  // portfolio. The service client never bypasses those domain checks.
  "app/admin/pricing/portfolio-settlements/actions.ts",
  "app/admin/pricing/portfolio-settlements/page.tsx",
  "app/admin/website-applications/[id]/page.tsx",
  "app/admin/audit/page.tsx",
  "app/admin/agreements/grid-owners/actions.ts",
  "app/admin/agreements/grid-owners/documents/route.ts",
  "app/admin/agreements/grid-owners/page.tsx",
  "app/admin/billing/import/actions.ts",
  "app/admin/billing/import/page.tsx",
  "app/admin/customers/duplicates/actions.ts",
  "app/admin/platform/actor-testing/actions.ts",
  "app/admin/platform/go-live/[companyId]/route-wizard/actions.ts",
  "app/admin/platform/go-live/[companyId]/route-wizard/page.tsx",
  "app/admin/cis/actions.ts",
  "app/admin/companies/actions.ts",
  "app/admin/companies/[id]/ediel-actions.ts",
  "app/admin/companies/[id]/email-actions.ts",
  "app/admin/companies/[id]/email-template-actions.ts",
  "app/admin/companies/[id]/page.tsx",
  "app/admin/companies/[id]/TenantPlatformControls.tsx",
  "app/admin/companies/[id]/tenant-platform-actions.ts",
  "app/admin/company-settings/actions.ts",
  "app/admin/contracts/actions.ts",
  "app/admin/customers/[id]/actions.ts",
  "app/admin/customers/[id]/email-actions.ts",
  "app/admin/customers/[id]/document-actions.ts",
  "app/admin/customers/[id]/grid-owner-import-actions.ts",
  "app/admin/customers/[id]/profile-actions.ts",
  "app/admin/customers/[id]/switch-actions.ts",
  "app/admin/customers/[id]/switch-create-actions.ts",
  "app/admin/customers/actions.ts",
  "app/admin/customers/page.tsx",
  "app/admin/controltower/page.tsx",
  "app/admin/ediel/control-tower/page.tsx",
  "app/admin/customers/segments/page.tsx",
  "app/admin/data-quality/page.tsx",
  "app/admin/ediel/actors/actions.ts",
  "app/admin/ediel/actors/page.tsx",
  "app/admin/ediel/certificates/actions.ts",
  "app/admin/ediel/certificates/page.tsx",
  "app/admin/ediel/mailboxes/page.tsx",
  "app/admin/ediel/portal-feedback/actions.ts",
  "app/admin/ediel/readiness/actions.ts",
  "app/admin/ediel/readiness/page.tsx",
  "app/admin/ediel/route-readiness/actions.ts",
  "app/admin/ediel/route-readiness/page.tsx",
  "app/admin/ediel/routes/page.tsx",
  "app/admin/ediel/rule-profiles/actions.ts",
  "app/admin/ediel/actions.ts",
  "app/admin/ediel/agt/actions.ts",
  "app/admin/ediel/system-tests/actions.ts",
  "app/admin/ediel/system-tests/page.tsx",
  "app/admin/ediel/test-center/actions.ts",
  "app/admin/ediel/test-center/page.tsx",
  "app/admin/ediel/system-tests/cases/[id]/page.tsx",
  "app/admin/inbound-mail/[id]/page.tsx",
  "app/admin/inbound-mail/actions.ts",
  "app/admin/inbound-mail/page.tsx",
  "app/admin/operations/actions.ts",
  "app/admin/operations/control-actions.ts",
  "app/admin/platform/api-clients/actions.ts",
  "app/admin/platform/api-clients/page.tsx",
  "app/admin/platform/data-cleanup/actions.ts",
  "app/admin/system/auth-diagnostics/page.tsx",
  "app/admin/system-health/page.tsx",
  "app/admin/outbound/unresolved/actions.ts",
  "app/admin/users/[id]/actions.ts",
  "app/admin/users/actions.ts",
  "app/admin/webhooks/actions.ts",
  "app/admin/website-applications/actions.ts",
]);

const serviceClientFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".git"
    )
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const rel = path.relative(root, full);
      const text = fs.readFileSync(full, "utf8");
      if (text.includes("supabaseService") && rel.startsWith("app/admin/"))
        serviceClientFiles.push(rel);
    }
  }
}
walk(path.join(root, "app"));

const unreviewedServiceClientFiles = serviceClientFiles
  .filter((rel) => !reviewedServiceClientFiles.has(rel))
  .sort((a, b) => a.localeCompare(b));
const removedReviewedServiceClientFiles = [...reviewedServiceClientFiles]
  .filter((rel) => !serviceClientFiles.includes(rel))
  .sort((a, b) => a.localeCompare(b));

if (unreviewedServiceClientFiles.length > 0) {
  failures.push(
    `Ogranskad supabaseService i app/admin: ${unreviewedServiceClientFiles.join(", ")}`,
  );
}

if (removedReviewedServiceClientFiles.length > 0) {
  warnings.push(
    `Service-client review-listan innehåller filer som inte längre använder supabaseService: ${removedReviewedServiceClientFiles.join(", ")}`,
  );
}

if (failures.length > 0) {
  console.error("RBAC audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  process.exit(1);
}

console.log(
  `RBAC audit passed: ${24 + warnings.length} checks, ${warnings.length} warning(s).`,
);
for (const warning of warnings) console.warn(`warning: ${warning}`);
