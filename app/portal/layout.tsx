import type { ReactNode } from "react";
import Link from "next/link";
import { logoutAction } from "@/lib/auth/logoutAction";
import { getCustomerPortalContext } from "@/lib/customer-portal/db";

export const dynamic = "force-dynamic";

export default async function PortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const context = await getCustomerPortalContext();

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {context.branding.portalName}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              Mina sidor
            </h1>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <nav className="flex flex-wrap gap-2">
              <Link
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                href="/portal"
              >
                Översikt
              </Link>
              <Link
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                href="/portal/fakturor"
              >
                Fakturor
              </Link>
              <Link
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                href="/portal/avtal"
              >
                Avtal
              </Link>
              <Link
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                href="/portal/status"
              >
                Status
              </Link>
              <Link
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                href="/portal/arenden"
              >
                Ärenden
              </Link>
              <Link
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                href="/portal/komplettera"
              >
                Komplettera
              </Link>
              <Link
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                href="/portal/forbrukning"
              >
                Förbrukning
              </Link>
              <Link
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                href="/portal/anlaggningar"
              >
                Anläggningar
              </Link>
              <Link
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                href="/portal/koppla-kund"
              >
                Koppla kund
              </Link>
            </nav>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {context.userEmail ?? "Inloggad kund"}
            </div>

            <form action={logoutAction}>
              <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Logga ut
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 sm:px-8">{children}</main>
    </div>
  );
}
