import {
  getCustomerPortalContext,
  listPortalCompletions,
  listPortalInfoRequests,
} from "@/lib/customer-portal/db";
import { sanitizePortalCompletionBlockedFlash } from "@/lib/customer-portal/completionFlash";
import { formatDate } from "@/lib/customer-portal/format";
import { submitPortalCompletionAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PortalCompletionPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; message?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const context = await getCustomerPortalContext();
  const [requests, completions] = await Promise.all([
    listPortalInfoRequests(context),
    listPortalCompletions(context),
  ]);
  const primaryCustomer = context.customers[0] ?? null;

  return (
    <div className="space-y-6">
      {params?.status === "success" ? (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
          Tack. Dina kompletterande uppgifter har skickats in och ett ärende har
          skapats för granskning.
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
          <input
            type="hidden"
            name="customer_id"
            value={primaryCustomer?.id ?? ""}
          />
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
              {requests.slice(0, 8).map((request) => (
                <div
                  key={request.id}
                  className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"
                >
                  <div className="font-semibold text-slate-950">
                    {request.request_type ?? "Uppgiftsbegäran"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Status {request.status ?? "—"} ·{" "}
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
                  Inga öppna uppgiftsbegäran.
                </div>
              ) : null}
            </div>
          </section>

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
                    {completion.completion_type}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Status {completion.status} ·{" "}
                    {formatDate(completion.created_at)}
                  </div>
                </div>
              ))}
              {completions.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                  Inga kompletteringar inskickade ännu.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
