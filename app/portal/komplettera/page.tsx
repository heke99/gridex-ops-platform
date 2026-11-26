import { randomUUID } from "node:crypto";
import { displayNameFromCustomer } from "@/lib/customer-portal/status";
import { isUuid } from "@/lib/validation/uuid";
import Link from "next/link";
import { isPortalResponseRequest, requestedPortalFields, targetedRequestFields } from "@/lib/customer-portal/targetedRequestFields";
import { portalCompletionTypeLabel, portalInfoRequestStatusLabel, portalInfoRequestTypeLabel } from "@/lib/customer-portal/labels";
import {
  getCustomerPortalContext,
  listPortalCompletions,
  listPortalInfoRequests,
  listPortalSites,
} from "@/lib/customer-portal/db";
import { sanitizePortalCompletionBlockedFlash } from "@/lib/customer-portal/completionFlash";
import { formatDate } from "@/lib/customer-portal/format";
import type { CustomerPortalCompletionRow } from "@/lib/customer-portal/types";
import { strictIsoDate } from "@/lib/time/stockholm";
import { submitPortalCompletionAction } from "./actions";
import { formatStatusLabel } from '@/lib/ui/format'

export const dynamic = "force-dynamic";

function requestedMoveOutDate(completion: CustomerPortalCompletionRow): string | null {
  if (completion.completion_type !== "move_out") return null;
  try {
    return strictIsoDate(completion.submitted_payload?.requested_move_out_date);
  } catch {
    return null;
  }
}

export default async function PortalCompletionPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; message?: string; request_cursor?: string | string[]; attempt?: string; customer?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : {};
  const context = await getCustomerPortalContext();
  const selectedCustomer = params.customer === undefined ? context.customers[0] ?? null
    : context.customers.find(customer => customer.id === params.customer) ?? null;
  const requestPageHref = (cursor?: string) => {
    const query = new URLSearchParams();
    if (params.customer !== undefined) query.set("customer", selectedCustomer?.id ?? "");
    if (cursor) query.set("request_cursor", cursor);
    const search = query.toString();
    return search ? `/portal/komplettera?${search}` : "/portal/komplettera";
  };
  const [requestPage, completions, sites] = await Promise.all([
    listPortalInfoRequests(context, { cursor: params.request_cursor }),
    listPortalCompletions(context),
    selectedCustomer ? listPortalSites({ ...context, customerIds: [selectedCustomer.id] }) : [],
  ]);
  const attempt = typeof params.attempt === "string" && isUuid(params.attempt) ? params.attempt : randomUUID();

  return (
    <div className="space-y-6">
      {params?.status === "success" ? (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
          Tack. Dina kompletterande uppgifter har skickats in. Vi går igenom dem
          och återkommer om något mer behövs.
        </section>
      ) : null}
      {params?.status === "blocked" ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
          {sanitizePortalCompletionBlockedFlash(params.message)}
        </section>
      ) : null}

      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          Komplettera uppgifter
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Skicka in saknade uppgifter kring anläggning, mätpunkt,
          kontaktuppgifter eller pågående ärende. Kundservice granskar
          uppgifterna innan masterdata uppdateras.
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-4">
          {context.customers.length > 1 ? (
            <form method="get" action="/portal/komplettera" className="flex flex-wrap items-end gap-3 rounded-3xl border border-slate-200 bg-white p-4">
              <label className="grid flex-1 gap-1 text-sm font-medium text-slate-700">
                Kundkonto
                <select name="customer" required defaultValue={selectedCustomer?.id ?? ""}
                  className="rounded-xl border border-slate-300 bg-white p-2">
                  {!selectedCustomer ? <option value="">Välj kundkonto</option> : null}
                  {context.customers.map(customer => (
                    <option key={customer.id} value={customer.id}>
                      {customer.customer_number ? `Kundnummer ${customer.customer_number}` : displayNameFromCustomer(customer) || "Kundkonto"}
                    </option>
                  ))}
                </select>
              </label>
              <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold">Visa kundkonto</button>
            </form>
          ) : null}
          {selectedCustomer ? (
            <form
              action={submitPortalCompletionAction}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h2 className="text-lg font-semibold text-slate-950">
                Ny komplettering
              </h2>
              <input
                type="hidden"
                name="customer_id"
                value={selectedCustomer.id}
              />
              <input type="hidden" name="expected_company_id" value={context.companyId ?? ""} />
              <input type="hidden" name="intent_id" value={attempt} />
              <div className="mt-5 grid gap-4">
                {sites.length > 0 ? (
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    Anläggning (valfritt)
                    <select name="site_id" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                      <option value="">Välj anläggning</option>
                      {sites.map(site => <option value={site.id} key={site.id}>
                        {[site.site_name, site.street, site.facility_id].filter(Boolean).join(" · ") || "Anläggning"}
                      </option>)}
                    </select>
                  </label>
                ) : null}
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Typ
                  <select
                    name="completion_type"
                    className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm"
                  >
                    <option value="missing_information">Saknad uppgift</option>
                    <option value="metering_point_update">Mätpunktsuppgift</option>
                    <option value="contact_update">Kontaktuppgift</option>
                  </select>
                </label>
                <input
                  name="facility_id"
                  placeholder="Anläggnings-ID"
                  className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                />
                <input
                  name="meter_point_id"
                  placeholder="Mätpunkts-ID"
                  className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                />
                <input
                  name="phone"
                  placeholder="Telefon"
                  className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                />
                <input
                  name="email"
                  type="email"
                  placeholder="E-post"
                  className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                />
                <textarea
                  name="message"
                  placeholder="Beskriv vad du vill komplettera"
                  rows={5}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                />
                <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black">
                  Skicka komplettering
                </button>
              </div>
            </form>
          ) : (
            <p className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-700" role="status">
              {params.customer === undefined ? "Koppla ditt kundkonto för att skicka in uppgifter." : "Det valda kundkontot är inte tillgängligt."}
            </p>
          )}
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">
              Öppna uppgiftsbegäran
            </h2>
            <div className="mt-4 space-y-3">
              {requestPage.requests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"
                >
                  <div className="font-semibold text-slate-950">
                    {portalInfoRequestTypeLabel(request.request_type)}
                  </div>
                  <p className="mt-1 text-sm text-slate-700">
                    {request.customerLabel}{request.siteLabel ? ` · ${request.siteLabel}` : ""}
                  </p>
                  <div className="mt-1 text-xs text-slate-500">
                    Status {portalInfoRequestStatusLabel(request.status)} ·{" "}
                    {formatDate(request.updated_at)}
                  </div>
                  {isPortalResponseRequest(request) ? context.requestResponseCustomerIds?.includes(request.customer_id) && (
                  <div className="mt-2 space-y-2">
                    <p>{requestedPortalFields(request.requested_data_categories).map(key => targetedRequestFields[key].label).join(", ")}</p>
                    <Link href={`/portal/komplettera/${encodeURIComponent(request.id)}`} className="font-semibold text-emerald-800 underline">
                      Svara på uppgiftsbegäran
                    </Link>
                  </div>
                ) : request.notes ? (
                    <p className="mt-2 text-sm text-slate-600">
                      {request.notes}
                    </p>
                  ) : null}
                </div>
              ))}
              {requestPage.requests.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                  {requestPage.unavailable ? "Uppgiftsbegäranden kunde inte visas just nu. Ladda om sidan för att försöka igen."
                    : requestPage.continued ? "Inga fler öppna uppgiftsbegäranden." : "Inga öppna uppgiftsbegäran. Du behöver inte göra något just nu."}
                </div>
              ) : null}
              {requestPage.continued || requestPage.nextCursor ? (
                <nav aria-label="Sidor med öppna uppgiftsbegäranden" className="flex flex-wrap gap-4 text-sm">
                  {requestPage.continued ? <Link href={requestPageHref()} className="underline">Visa första sidan</Link> : null}
                  {requestPage.nextCursor ? (
                    <Link href={requestPageHref(requestPage.nextCursor)} className="underline">Fler öppna uppgiftsbegäranden</Link>
                  ) : null}
                </nav>
              ) : null}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">
              Tidigare kompletteringar
            </h2>
            <div className="mt-4 space-y-3">
              {completions.slice(0, 8).map((completion) => {
                const moveOutDate = requestedMoveOutDate(completion);
                return (
                  <div
                    key={completion.id}
                    className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"
                  >
                    <div className="font-semibold text-slate-950">
                      {portalCompletionTypeLabel(completion.completion_type)}
                    </div>
                    {moveOutDate ? (
                      <p className="mt-1">
                        Önskat utflyttningsdatum <time dateTime={moveOutDate}>{moveOutDate}</time>
                      </p>
                    ) : null}
                    <div className="mt-1 text-xs text-slate-500">
                      Status {formatStatusLabel(completion.status)} ·{" "}
                      {formatDate(completion.created_at)}
                    </div>
                  </div>
                );
              })}
              {completions.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                  Inga kompletteringar inskickade ännu. Använd formuläret för att skicka in saknade uppgifter.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
