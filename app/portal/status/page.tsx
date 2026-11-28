import { isPortalResponseRequest, requestedPortalFields, targetedRequestFields } from "@/lib/customer-portal/targetedRequestFields";
import { portalCaseStatusLabel, portalInfoRequestStatusLabel, portalInfoRequestTypeLabel } from "@/lib/customer-portal/labels";
import Link from "next/link";
import {
  getCustomerPortalContext,
  listPortalOpenCases,
  listPortalContracts,
  listPortalInfoRequests,
} from "@/lib/customer-portal/db";
import { formatDate } from "@/lib/customer-portal/format";

export const dynamic = "force-dynamic";

export default async function PortalStatusPage({
  searchParams,
}: {
  searchParams?: Promise<{ request_cursor?: string | string[]; case_cursor?: string | string[] }>;
} = {}) {
  const context = await getCustomerPortalContext();
  const { request_cursor, case_cursor } = await searchParams ?? {};
  const [contracts, casePage, requestPage] = await Promise.all([
    listPortalContracts(context),
    listPortalOpenCases(context, case_cursor),
    listPortalInfoRequests(context, { cursor: request_cursor, count: true }),
  ]);

  function statusHref(key: "case_cursor" | "request_cursor", cursor: string | null) {
    const params = new URLSearchParams();
    if (casePage.continued && typeof case_cursor === "string") params.set("case_cursor", case_cursor);
    if (requestPage.continued && typeof request_cursor === "string") params.set("request_cursor", request_cursor);
    if (cursor) params.set(key, cursor);
    else params.delete(key);
    const query = params.toString();
    return query ? `/portal/status?${query}` : "/portal/status";
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          Status
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Samlad status för avtal, uppgiftsbegäran och öppna ärenden i ditt
          kundflöde.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Avtal</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">
            {contracts.length}
          </p>
        </article>
        <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <p className="text-sm font-medium text-amber-900">
            {requestPage.continued ? "Återstående öppna uppgiftsbegäranden" : "Öppna uppgiftsbegäranden"}
          </p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">
            {requestPage.count ?? "–"}
          </p>
        </article>
        <article className="rounded-3xl border border-red-200 bg-red-50 p-6 shadow-sm">
          <p className="text-sm font-medium text-red-900">{casePage.continued ? "Återstående öppna ärenden" : "Öppna ärenden"}</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">
            {casePage.count ?? "–"}
          </p>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-950">
              Uppgiftsbegäran
            </h2>
            <Link
              href="/portal/komplettera"
              className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Komplettera
            </Link>
          </div>
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
                  Status {portalInfoRequestStatusLabel(request.status)} · Uppdaterad{" "}
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
                  <p className="mt-2 text-sm text-slate-600">{request.notes}</p>
                ) : null}
              </div>
            ))}
            {requestPage.requests.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                {requestPage.unavailable ? "Uppgiftsbegäranden kunde inte visas just nu. Ladda om sidan för att försöka igen."
                  : requestPage.continued ? "Inga fler öppna uppgiftsbegäranden." : "Inga öppna uppgiftsbegäran. Vi hör av oss om vi behöver fler uppgifter från dig."}
              </div>
            ) : null}
            {requestPage.continued || requestPage.nextCursor ? (
              <nav aria-label="Sidor med öppna uppgiftsbegäranden" className="flex flex-wrap gap-4 text-sm">
                {requestPage.continued ? <Link href={statusHref("request_cursor", null)} className="underline">Visa första sidan</Link> : null}
                {requestPage.nextCursor ? (
                  <Link href={statusHref("request_cursor", requestPage.nextCursor)} className="underline">Fler öppna uppgiftsbegäranden</Link>
                ) : null}
              </nav>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Öppna ärenden
          </h2>
          <div className="mt-4 space-y-3">
            {casePage.cases.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"
              >
                <Link href={`/portal/arenden/${item.id}`} prefetch={false}
                  className="font-semibold text-slate-950 underline underline-offset-4">
                  {item.title}
                </Link>
                <p className="mt-1 text-xs text-slate-700">{item.customerLabel}{item.siteLabel ? ` · ${item.siteLabel}` : ""}</p>
                <div className="mt-1 text-xs text-slate-500">
                  Status {item.status === "received" ? "Mottaget" : portalCaseStatusLabel(item.status)} · Uppdaterat{" "}
                  {formatDate(item.updatedAt)}
                </div>
              </div>
            ))}
            {casePage.cases.length > 0 ? (
              <Link href="/portal/arenden" className="text-sm font-semibold text-emerald-800 underline underline-offset-4">
                Visa Mina ärenden
              </Link>
            ) : null}
            {casePage.cases.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                {casePage.unavailable ? "Ärenden kunde inte visas just nu. Ladda om sidan för att försöka igen."
                  : casePage.continued ? "Inga fler öppna ärenden." : "Inga öppna ärenden just nu."}
              </div>
            ) : null}
            {casePage.continued || casePage.nextCursor ? (
              <nav aria-label="Sidor med öppna ärenden" className="flex flex-wrap gap-4 text-sm">
                {casePage.continued ? <Link href={statusHref("case_cursor", null)} className="underline">Visa första ärendesidan</Link> : null}
                {casePage.nextCursor ? (
                  <Link href={statusHref("case_cursor", casePage.nextCursor)} className="underline">Fler öppna ärenden</Link>
                ) : null}
              </nav>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
