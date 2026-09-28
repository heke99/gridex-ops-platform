import {
  getCustomerPortalContext,
  listPortalCases,
} from "@/lib/customer-portal/db";
import { formatDate } from "@/lib/customer-portal/format";

export const dynamic = "force-dynamic";

function tone(status: string) {
  if (["resolved", "closed", "done"].includes(String(status)))
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "waiting_for_customer")
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
          Här visas ärenden som kundservice har publicerat till dig.
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
                  {item.public_title}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Publicerat {formatDate(item.published_at)}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(item.public_status)}`}
              >
                {item.public_status === "waiting_for_customer" ? "Väntar på dig" : item.public_status === "resolved" ? "Löst" : item.public_status === "closed" ? "Avslutat" : "Öppet"}
              </span>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.public_body}</p>
          </article>
        ))}

        {cases.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            Inga ärenden har publicerats till ditt kundkonto.
          </div>
        ) : null}
      </section>
    </div>
  );
}
