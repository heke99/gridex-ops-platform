import Link from "next/link";
import { portalCompletionTypeLabel, portalInfoRequestStatusLabel, portalInfoRequestTypeLabel } from "@/lib/customer-portal/labels";
import {
  getCustomerPortalContext,
  listPortalCompletions,
  listPortalInfoRequests,
} from "@/lib/customer-portal/db";
import { sanitizePortalCompletionBlockedFlash } from "@/lib/customer-portal/completionFlash";
import { formatDate } from "@/lib/customer-portal/format";
import { displayNameFromCustomer } from "@/lib/customer-portal/status";
import { submitPortalCompletionAction } from "./actions";
import { formatStatusLabel } from '@/lib/ui/format'

export const dynamic = "force-dynamic";

export default async function PortalCompletionPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; message?: string; page?: string | string[]; request?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : {};
  const page = typeof params.page === "string" && /^[1-9]\d{0,5}$/.test(params.page) ? Number(params.page) : 1;
  const requestId = typeof params.request === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(params.request)
    ? params.request.toLowerCase()
    : undefined;
  const context = await getCustomerPortalContext();
  const [open, history, completions] = await Promise.all([
    listPortalInfoRequests(context, { scope: "open", page }),
    listPortalInfoRequests(context, { scope: "history" }),
    listPortalCompletions(context),
  ]);
  const listedRequest = open.requests.find((request) => request.id === requestId);
  const additionalRequest = requestId && !listedRequest
    ? (await listPortalInfoRequests(context, { scope: "open", requestId })).requests[0]
    : undefined;
  const requests = additionalRequest ? [additionalRequest, ...open.requests] : open.requests;
  const selectedRequest = listedRequest ?? additionalRequest;
  const customerId = selectedRequest?.customer_id ?? context.customers[0]?.id ?? "";
  const customerName = context.customers.length > 1
    ? displayNameFromCustomer(context.customers.find((customer) => customer.id === customerId))
    : null;

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
        <form
          action={submitPortalCompletionAction}
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold text-slate-950">
            Ny komplettering
          </h2>
          {customerName ? <p className="mt-2 text-sm text-slate-600">Gäller {customerName}.</p> : null}
          <input type="hidden" name="customer_id" value={customerId} />
          <div className="mt-5 grid gap-4">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Typ
              <select
                name="completion_type"
                className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm"
              >
                <option value="missing_information">Saknad uppgift</option>
                <option value="metering_point_update">Mätpunktsuppgift</option>
                <option value="contact_update">Kontaktuppgift</option>
                <option value="case_reply">Svar på ärende</option>
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

        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">
              Öppna uppgiftsbegäran
            </h2>
            <div className="mt-4 space-y-3">
              {requests.map((request) => (
                <div
                  key={request.id}
                  id={`uppgiftsbegaran-${request.id}`}
                  className="scroll-mt-4 rounded-2xl border border-slate-200 p-4 text-sm text-slate-700 target:border-slate-500"
                >
                  <div className="font-semibold text-slate-950">
                    {portalInfoRequestTypeLabel(request.request_type)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Status {portalInfoRequestStatusLabel(request.status)} ·{" "}
                    {formatDate(request.updated_at)}
                  </div>
                  {request.notes ? (
                    <p className="mt-2 text-sm text-slate-600">
                      {request.notes}
                    </p>
                  ) : null}
                </div>
              ))}
              {requests.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                  Inga öppna uppgiftsbegäran. Du behöver inte göra något just nu.
                </div>
              ) : null}
            </div>
            {open.page > 1 || open.hasMore ? (
              <nav aria-label="Sidor med öppna uppgiftsbegäranden" className="mt-4 flex gap-4 text-sm">
                {open.page > 1 ? <Link className="underline" href={`/portal/komplettera?page=${open.page - 1}`}>Föregående</Link> : null}
                {open.hasMore ? <Link className="underline" href={`/portal/komplettera?page=${open.page + 1}`}>Nästa</Link> : null}
              </nav>
            ) : null}
          </section>

          {history.requests.length > 0 ? (
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Avslutade uppgiftsbegäranden</h2>
              <ul className="mt-4 space-y-3">
                {history.requests.map((request) => (
                  <li key={request.id} className="text-sm text-slate-700">
                    {portalInfoRequestTypeLabel(request.request_type)} · {portalInfoRequestStatusLabel(request.status)} · {formatDate(request.updated_at)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">
              Tidigare kompletteringar
            </h2>
            <div className="mt-4 space-y-3">
              {completions.slice(0, 8).map((completion) => (
                <div
                  key={completion.id}
                  className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"
                >
                  <div className="font-semibold text-slate-950">
                    {portalCompletionTypeLabel(completion.completion_type)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Status {formatStatusLabel(completion.status)} ·{" "}
                    {formatDate(completion.created_at)}
                  </div>
                </div>
              ))}
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
