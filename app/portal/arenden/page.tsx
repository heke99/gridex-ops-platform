import {
  getCustomerPortalContext,
  listPortalCases,
} from "@/lib/customer-portal/db";
import { formatDate } from "@/lib/customer-portal/format";

export const dynamic = "force-dynamic";

function tone(status: string | null) {
  if (["resolved", "closed", "done"].includes(String(status)))
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (["action_required", "blocked", "failed"].includes(String(status)))
    return "border-red-200 bg-red-50 text-red-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default async function PortalCasesPage() {
  const context = await getCustomerPortalContext();
  const cases = await listPortalCases(context);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          Mina ärenden
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Här visas pågående och historiska ärenden kopplade till dina avtal,
          anläggningar, mätvärden och fakturaunderlag.
        </p>
      </section>

      <section className="space-y-4">
        {cases.map((item) => (
          <article
            key={item.id}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {item.title ?? "Kundärende"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Skapat {formatDate(item.created_at)} · Uppdaterat{" "}
                  {formatDate(item.updated_at)}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(item.status)}`}
              >
                {item.status ?? "okänd status"}
              </span>
            </div>
            {item.description ? (
              <p className="mt-4 text-sm leading-6 text-slate-700">
                {item.description}
              </p>
            ) : null}
            {item.next_action ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <strong>Nästa åtgärd:</strong> {item.next_action}
              </div>
            ) : null}
          </article>
        ))}

        {cases.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            Inga ärenden finns för ditt kundkonto.
          </div>
        ) : null}
      </section>
    </div>
  );
}
