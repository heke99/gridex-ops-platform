import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import {
  isPlatformAdminContext,
  requireAdminPageAccess,
} from "@/lib/admin/guards";
import { traceContractFlow } from "@/lib/contracts/flowTrace";
import { listPlatformCompanies } from "@/lib/tenant/scope";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function displayValue(row: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const value = row[field];
    if (typeof value === "string" && value) return value;
  }
  return "—";
}

export default async function ContractTracePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const admin = await requireAdminPageAccess({ anyOf: ["contracts.read"] });
  if (!isPlatformAdminContext(admin)) {
    return (
      <div className="p-8 text-sm text-red-700">
        Endast plattformsadministratörer kan använda kedjespårningen.
      </div>
    );
  }
  const params = searchParams ? await searchParams : {};
  const companyId = first(params.company_id) ?? "";
  const search = first(params.q)?.trim() ?? "";
  const companies = (await listPlatformCompanies()).filter(
    (company) => company.status !== "archived",
  );
  const company = companies.find((item) => item.id === companyId) ?? null;
  const invalidCompany = Boolean(companyId && !company);
  const steps = search && company ? await traceContractFlow({ companyId, search }) : [];
  const totalRows = steps.reduce((sum, step) => sum + step.rows.length, 0);

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Spåra avtalskedja"
        subtitle="Läsande supportdiagnostik. Körs endast för ett uttryckligen valt bolag och ett sökvärde."
        userEmail={admin.email}
      />
      <div className="space-y-6 p-8">
        <nav className="flex flex-wrap gap-2 text-sm">
          <Link className="rounded-xl border px-4 py-2 font-semibold" href="/admin/contracts">
            Interna produkter
          </Link>
          <span className="rounded-xl bg-slate-950 px-4 py-2 font-semibold text-white">
            Kedjespårning
          </span>
        </nav>
        <form className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-[minmax(18rem,1fr)_minmax(20rem,2fr)_auto]">
          <label className="text-sm font-semibold text-slate-800">
            Bolag
            <select
              name="company_id"
              required
              defaultValue={companyId}
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2"
            >
              <option value="">Välj bolag</option>
              {companies.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-800">
            ID eller referens
            <input
              name="q"
              required
              maxLength={200}
              defaultValue={search}
              placeholder="quote reference, kundnummer, fakturanummer, UUID…"
              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>
          <button className="self-end rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white">
            Spåra
          </button>
        </form>
        {invalidCompany ? (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
            Det uttryckligen valda bolaget finns inte eller får inte administreras.
          </section>
        ) : null}
        {search && company && totalRows === 0 ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
            Inga steg matchade sökvärdet inom {company.name}. Resultatet innebär
            inte att resursen finns hos ett annat bolag.
          </section>
        ) : null}
        {steps.map((step) => (
          <section key={step.key} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-black text-slate-950">{step.label}</h2>
              <span className="text-xs font-semibold text-slate-500">{step.rows.length} träffar</span>
            </div>
            {step.error ? (
              <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
                Steget kunde inte hämtas: {step.error}
              </p>
            ) : null}
            <div className="mt-4 grid gap-3">
              {step.rows.map((row) => (
                <article key={String(row.id)} className="rounded-2xl border border-slate-200 p-4 text-sm">
                  <div className="grid gap-2 md:grid-cols-4">
                    <p><span className="font-semibold">ID:</span> {String(row.id)}</p>
                    <p><span className="font-semibold">Tenant:</span> {String(row.company_id ?? "—")}</p>
                    <p><span className="font-semibold">Kund:</span> {String(row.customer_id ?? "—")}</p>
                    <p><span className="font-semibold">Status:</span> {displayValue(row, ["status", "lifecycle_status", "publication_status"])}</p>
                    <p><span className="font-semibold">Blockerare:</span> {displayValue(row, ["blocking_reason", "blocker_code", "last_error"])}</p>
                    <p><span className="font-semibold">Skapad:</span> {String(row.created_at ?? "—")}</p>
                    <p><span className="font-semibold">Uppdaterad:</span> {String(row.updated_at ?? "—")}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
