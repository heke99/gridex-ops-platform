import AdminHeader from "@/components/admin/AdminHeader";
import CustomerLoginSetup, { type CustomerLoginProviderView } from "@/components/admin/customer-login/CustomerLoginSetup";
import { requireAdminPageKeyAccess } from "@/lib/admin/guards";
import { getOperationalCompanyScope } from "@/lib/tenant/scope";
import { tenantSelect } from "@/lib/supabase/tenantQuery";
import { tenantKeyAudience, tenantKeyIssuer } from "@/lib/customer-portal/identityProviderSetup";

export const dynamic = "force-dynamic";

export default async function CustomerLoginPage() {
  const context = await requireAdminPageKeyAccess("company.settings");
  const scope = await getOperationalCompanyScope(context.userId);
  const companyId = scope.companyId;

  let providers: CustomerLoginProviderView[] = [];
  let unavailable = false;
  if (companyId) {
    const { data, error } = await tenantSelect(
      companyId,
      "tenant_customer_identity_providers",
      "purpose,kind,display_name,issuer,audience,enforcement,last_tested_at,last_test_result",
    )
      .eq("is_active", true);
    if (error) unavailable = true;
    else providers = (data as CustomerLoginProviderView[] | null) ?? [];
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Kundinloggning"
        subtitle="Kontrollera kundernas och personalens identitet från ert eget system."
        userEmail={context.email}
      />
      <div className="space-y-6 p-8">
        {!companyId ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 shadow-sm">
            Kontot saknar aktiv bolagskoppling. Koppla användaren till ett bolag först.
          </section>
        ) : unavailable ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 shadow-sm">
            Kundinloggning är inte aktiverad i den här miljön än.
          </section>
        ) : (
          <CustomerLoginSetup
            companyId={companyId}
            providers={providers}
            tenantKeyIssuer={tenantKeyIssuer(companyId)}
            tenantKeyAudience={tenantKeyAudience(companyId)}
          />
        )}
      </div>
    </div>
  );
}
