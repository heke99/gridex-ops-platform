import Link from "next/link";
import { portalCaseStatusLabel } from "@/lib/customer-portal/labels";
import {
  getCustomerPortalContext,
  listPortalCases,
} from "@/lib/customer-portal/db";
import { formatDate } from "@/lib/customer-portal/format";

export const dynamic = "force-dynamic";

function tone(status: string) {
  if (["resolved", "closed", "done"].includes(String(status)))
    return "border-emerald-200 bg-emerald-50 text-emerald-800";

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
                {item.status === "received" ? "Mottaget" : portalCaseStatusLabel(item.status)}
              </span>
            </div>
            {item.description ? (
              <p className="mt-4 text-sm leading-6 text-slate-700">
                {item.description}
              </p>
            ) : null}
            <Link href={`/portal/arenden/${item.id}`} prefetch={false}
              className="mt-4 inline-flex rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 underline-offset-4 hover:underline">
              Öppna ärende
            </Link>
          </article>
        ))}

        {cases.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            <p>Inga ärenden finns för ditt kundkonto.</p>
            <Link
              href="/portal/komplettera"
              className="mt-3 inline-block rounded-sm font-semibold text-slate-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              Komplettera uppgifter
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
