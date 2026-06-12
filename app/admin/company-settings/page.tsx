import AdminHeader from "@/components/admin/AdminHeader";
import CompanyUserInviteForm from "@/components/admin/companies/CompanyUserInviteForm";
import { requireAdminPageKeyAccess } from "@/lib/admin/guards";
import { getOperationalCompanyScope } from "@/lib/tenant/scope";
import {
  getCompanyById,
  listCompanyUsersForGovernance,
} from "@/lib/tenant/governance";
import {
  updateCompanyResponsibleUserAction,
  updateCompanySettingsAction,
} from "./actions";
import {
  COMPANY_MEMBERSHIP_ROLE_OPTIONS,
  COMPANY_USER_ROLE_OPTIONS,
  getCompanyMembershipRoleLabel,
  getCompanyUserRoleLabel,
} from "@/lib/tenant/companyUserRoles";

export const dynamic = "force-dynamic";

const emptyState = { ok: false, message: "" };

async function updateCompanySettingsFormAction(formData: FormData) {
  "use server";
  await updateCompanySettingsAction(emptyState, formData);
}

async function updateResponsibleUserFormAction(formData: FormData) {
  "use server";
  await updateCompanyResponsibleUserAction(emptyState, formData);
}

function getBrandingValue(
  branding: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = branding?.[key];
  return typeof value === "string" ? value : "";
}

function roleLabel(value: string) {
  return getCompanyMembershipRoleLabel(value);
}

export default async function CompanySettingsPage() {
  const context = await requireAdminPageKeyAccess("company.settings");
  const scope = await getOperationalCompanyScope(context.userId);
  const companyId = scope.companyId;
  const company = companyId ? await getCompanyById(companyId) : null;
  const users = companyId ? await listCompanyUsersForGovernance(companyId) : [];
  const branding =
    company?.branding && typeof company.branding === "object"
      ? company.branding
      : null;
  const isLiveApproved = Boolean(
    company?.live_ediel_enabled === true &&
    company?.production_status === "live" &&
    company?.live_approved_at,
  );

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Bolagsinställningar"
        subtitle="Uppdatera bolagets kontaktuppgifter, bolagsansvariga och inloggningsuppgifter inom ditt bolag."
        userEmail={context.email}
      />

      <div className="space-y-6 p-8">
        {!company || !companyId ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 shadow-sm">
            Kontot saknar aktiv bolagskoppling. Koppla användaren till ett bolag
            innan bolagsinställningar kan ändras.
          </section>
        ) : (
          <>
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    Bolagsuppgifter
                  </h2>
                  <p className="mt-1 text-sm text-slate-700">
                    Dessa uppgifter används i adminytan, onboarding och
                    kommunikation.
                  </p>
                </div>
              </div>
              <form
                action={updateCompanySettingsFormAction}
                className="mt-5 grid gap-4 lg:grid-cols-2"
              >
                <input type="hidden" name="company_id" value={companyId} />
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Bolagsnamn</span>
                  <input
                    name="name"
                    required
                    defaultValue={company.name}
                    className="rounded-2xl border border-slate-300 px-4 py-3"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">
                    Organisationsnummer
                  </span>
                  <input
                    name="org_number"
                    defaultValue={company.org_number ?? ""}
                    className="rounded-2xl border border-slate-300 px-4 py-3"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">
                    Kundnummerprefix
                  </span>
                  <input
                    name="customer_number_prefix"
                    defaultValue={company.customer_number_prefix ?? ""}
                    className="rounded-2xl border border-slate-300 px-4 py-3 uppercase"
                    placeholder="Ex. DX eller GDX"
                  />
                  <span className="text-xs leading-5 text-slate-500">
                    Används för nya kundnummer, exempelvis DX-100001. Kan bara ändras innan första kunden har fått kundnummer.
                  </span>
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">
                    Kontaktperson
                  </span>
                  <input
                    name="primary_contact_name"
                    defaultValue={company.primary_contact_name ?? ""}
                    className="rounded-2xl border border-slate-300 px-4 py-3"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">
                    Kontakt e-post
                  </span>
                  <input
                    name="primary_contact_email"
                    type="email"
                    defaultValue={company.primary_contact_email ?? ""}
                    className="rounded-2xl border border-slate-300 px-4 py-3"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Telefon</span>
                  <input
                    name="phone"
                    defaultValue={company.phone ?? ""}
                    className="rounded-2xl border border-slate-300 px-4 py-3"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-slate-700">Webbplats</span>
                  <input
                    name="website"
                    defaultValue={company.website ?? ""}
                    className="rounded-2xl border border-slate-300 px-4 py-3"
                  />
                </label>

                <div className="lg:col-span-2 mt-2 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-sm font-semibold text-slate-950">
                    Fakturering och support
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-700">
                    Kontaktuppgifter som används för plattformsadministration,
                    kundkommunikation och framtida faktureringsunderlag.
                  </p>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Faktura-/kontaktmail
                      </span>
                      <input
                        name="billing_contact_email"
                        type="email"
                        defaultValue={company.billing_contact_email ?? ""}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Supportmail
                      </span>
                      <input
                        name="support_email"
                        type="email"
                        defaultValue={company.support_email ?? ""}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                      />
                    </label>
                  </div>
                </div>

                <div className="lg:col-span-2 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-sm font-semibold text-slate-950">
                    Adress
                  </h3>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Adressrad 1
                      </span>
                      <input
                        name="address_line_1"
                        defaultValue={company.address_line_1 ?? ""}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Adressrad 2
                      </span>
                      <input
                        name="address_line_2"
                        defaultValue={company.address_line_2 ?? ""}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Postnummer
                      </span>
                      <input
                        name="postal_code"
                        defaultValue={company.postal_code ?? ""}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">Ort</span>
                      <input
                        name="city"
                        defaultValue={company.city ?? ""}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Landkod
                      </span>
                      <input
                        name="country_code"
                        defaultValue={company.country_code ?? "SE"}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                      />
                    </label>
                  </div>
                </div>

                <div className="lg:col-span-2 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                  <h3 className="text-sm font-semibold text-slate-950">
                    Varumärke och kundkommunikation
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-700">
                    Fälten är valfria. Lämna dem tomma om bolagets juridiska
                    namn och standardavsändare ska användas. Systemet ska inte
                    förifylla testnamn, färger eller kundportalnamn.
                  </p>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Publikt visningsnamn
                      </span>
                      <input
                        name="branding_display_name"
                        defaultValue={getBrandingValue(
                          branding,
                          "display_name",
                        )}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                        placeholder={company.name}
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Logotyp URL
                      </span>
                      <input
                        name="branding_logo_url"
                        defaultValue={getBrandingValue(branding, "logo_url")}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                        placeholder="Lämna tomt om logotyp saknas"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Primärfärg
                      </span>
                      <input
                        name="branding_primary_color"
                        defaultValue={getBrandingValue(
                          branding,
                          "primary_color",
                        )}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                        placeholder="Valfritt, t.ex. #047857"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Avsändarmail för kundutskick
                      </span>
                      <input
                        name="branding_sender_email"
                        type="email"
                        defaultValue={getBrandingValue(
                          branding,
                          "sender_email",
                        )}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                        placeholder={
                          company.primary_contact_email ?? "namn@bolag.se"
                        }
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Kundportalnamn
                      </span>
                      <input
                        name="branding_customer_portal_name"
                        defaultValue={getBrandingValue(
                          branding,
                          "customer_portal_name",
                        )}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                        placeholder={company.name}
                      />
                    </label>
                    <div className="rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-slate-700">
                      <div className="font-semibold text-slate-950">
                        Förhandslogik
                      </div>
                      <p className="mt-1 leading-6">
                        Tomma fält betyder att systemet använder bolagsnamn,
                        kontaktmail och standardtema i kommunikationen. Inga
                        testvärden sparas automatiskt.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-2 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                  <h3 className="text-sm font-semibold text-slate-950">
                    Ediel och driftmiljö
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-700">
                    Bolagets egna aktörsuppgifter. Globala Ediel-versioner och
                    runtime-regler hanteras av superadmin under
                    plattformsinställningar.
                  </p>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Ediel-id
                      </span>
                      <input
                        name="ediel_id"
                        defaultValue={company.ediel_id ?? ""}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                        placeholder="Bolagets Ediel-ID från Edielregistret"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Aktörsroll
                      </span>
                      <input
                        name="actor_role"
                        defaultValue={company.actor_role ?? ""}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                        placeholder="Ex. DDQ / ESP / BRP"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Sender subaddress
                      </span>
                      <input
                        name="sender_sub_address"
                        defaultValue={company.sender_sub_address ?? ""}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                        placeholder="T.ex. PRODAT, eller tom om ej registrerad"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">
                        Ediel-mailbox
                      </span>
                      <input
                        name="ediel_mailbox"
                        defaultValue={company.ediel_mailbox ?? ""}
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium text-slate-700">Miljö</span>
                      <input
                        type="hidden"
                        name="operating_environment"
                        value={
                          isLiveApproved
                            ? (company.operating_environment ?? "test")
                            : "test"
                        }
                      />
                      <select
                        disabled={!isLiveApproved}
                        defaultValue={
                          isLiveApproved
                            ? (company.operating_environment ?? "test")
                            : "test"
                        }
                        className="rounded-2xl border border-slate-300 bg-white px-4 py-3 disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        <option value="test">Test</option>
                        <option value="production">Produktion</option>
                      </select>
                      {!isLiveApproved ? (
                        <span className="text-xs leading-5 text-amber-700">
                          Produktion visas först när superadmin har godkänt
                          go-live. Bolaget kan inte själv slå på live.
                        </span>
                      ) : null}
                    </label>
                  </div>
                </div>

                <div className="lg:col-span-2 flex justify-end">
                  <button className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
                    Spara bolagsuppgifter
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">
                Bjud in användare
              </h2>
              <p className="mt-1 text-sm text-slate-700">
                Lägg till en ny användare i bolaget och välj roll direkt.
                Användaren visas i listan efter att kontot har skapats/kopplats.
              </p>
              <CompanyUserInviteForm companyId={companyId} />
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 className="text-lg font-semibold text-slate-950">
                  Bolagets användare och roller
                </h2>
                <p className="mt-1 text-sm text-slate-700">
                  Ändra namn, telefon, login-e-post och roll för alla användare
                  i bolaget.
                </p>
              </div>

              <div className="divide-y divide-slate-100">
                {users.length === 0 ? (
                  <p className="px-6 py-8 text-sm text-slate-700">
                    Ingen användare är kopplad till bolaget ännu.
                  </p>
                ) : (
                  users.map((user) => (
                    <form
                      key={user.membershipId}
                      action={updateResponsibleUserFormAction}
                      className="grid gap-4 px-6 py-6 xl:grid-cols-[1fr_1fr_150px_160px_190px]"
                    >
                      <input
                        type="hidden"
                        name="company_id"
                        value={companyId}
                      />
                      <input type="hidden" name="user_id" value={user.userId} />
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">Namn</span>
                        <input
                          name="full_name"
                          defaultValue={user.fullName ?? ""}
                          className="rounded-2xl border border-slate-300 px-4 py-3"
                        />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">
                          Login e-post
                        </span>
                        <input
                          name="email"
                          type="email"
                          required
                          defaultValue={user.email ?? user.invitedEmail ?? ""}
                          className="rounded-2xl border border-slate-300 px-4 py-3"
                        />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">
                          Telefon
                        </span>
                        <input
                          name="phone"
                          className="rounded-2xl border border-slate-300 px-4 py-3"
                        />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">
                          Bolagsroll
                        </span>
                        <select
                          name="membership_role"
                          defaultValue={user.membershipRole}
                          className="rounded-2xl border border-slate-300 px-4 py-3"
                        >
                          {COMPANY_MEMBERSHIP_ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium text-slate-700">
                          Systemroll
                        </span>
                        <select
                          name="role_key"
                          defaultValue={user.roleKey ?? "company_admin"}
                          className="rounded-2xl border border-slate-300 px-4 py-3"
                        >
                          {COMPANY_USER_ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="xl:col-span-5 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        <span>
                          {roleLabel(user.membershipRole)} ·{" "}
                          {getCompanyUserRoleLabel(user.roleKey)} ·{" "}
                          {user.email ?? user.userId}
                        </span>
                        <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-black">
                          Uppdatera ansvarig
                        </button>
                      </div>
                    </form>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
