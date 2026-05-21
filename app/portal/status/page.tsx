import Link from "next/link";
import {
  getCustomerPortalContext,
  listPortalCases,
  listPortalContracts,
  listPortalInfoRequests,
} from "@/lib/customer-portal/db";
import { formatDate } from "@/lib/customer-portal/format";

export const dynamic = "force-dynamic";

export default async function PortalStatusPage() {
  const context = await getCustomerPortalContext();
  const [contracts, cases, infoRequests] = await Promise.all([
    listPortalContracts(context),
    listPortalCases(context),
    listPortalInfoRequests(context),
  ]);

  const openCases = cases.filter(
    (item) => !["resolved", "closed", "done"].includes(String(item.status)),
  );
  const openRequests = infoRequests.filter(
    (item) =>
      !["completed", "closed", "cancelled"].includes(String(item.status)),
  );

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
            Öppna uppgiftsbegäran
          </p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">
            {openRequests.length}
          </p>
        </article>
        <article className="rounded-3xl border border-red-200 bg-red-50 p-6 shadow-sm">
          <p className="text-sm font-medium text-red-900">Öppna ärenden</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">
            {openCases.length}
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
            {infoRequests.slice(0, 8).map((request) => (
              <div
                key={request.id}
                className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"
              >
                <div className="font-semibold text-slate-950">
                  {request.request_type ?? "Uppgiftsbegäran"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Status {request.status ?? "—"} · Uppdaterad{" "}
                  {formatDate(request.updated_at)}
                </div>
                {request.notes ? (
                  <p className="mt-2 text-sm text-slate-600">{request.notes}</p>
                ) : null}
              </div>
            ))}
            {infoRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                Inga öppna uppgiftsbegäran.
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Öppna ärenden
          </h2>
          <div className="mt-4 space-y-3">
            {openCases.slice(0, 8).map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"
              >
                <div className="font-semibold text-slate-950">
                  {item.title ?? "Ärende"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Status {item.status ?? "—"} · Uppdaterat{" "}
                  {formatDate(item.updated_at)}
                </div>
              </div>
            ))}
            {openCases.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                Inga öppna ärenden.
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
