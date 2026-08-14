import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { requirePlatformAdminAccess } from "@/lib/admin/guards";
import { getActorTestingSummary } from "@/lib/ediel/actorTesting";
import {
  ActorCompanyIdentityCard,
  ActorProfileGuide,
  EvidencePackage,
} from "@/components/admin/ediel/ActorTestingViews";
import {
  getCompanyProductionReadiness,
  type ProductionReadinessResult,
} from "@/lib/ediel/productionReadiness";
import { ProductionReadinessPanel } from "@/components/admin/ediel/ProductionReadinessViews";
import {
  getCompanyGoLiveSetupSummary,
  type GoLiveSetupSummary,
} from "@/lib/ediel/platformGoLive";
import { CompanyGoLiveSetupPanel } from "@/components/admin/ediel/GoLiveSetupViews";
import {
  getTenantWebsiteGoLiveSummary,
  type TenantWebsiteGoLiveSummary,
} from "@/lib/integrations/tenantWebsiteGoLive";
import {
  listEdielCertificationEvidence,
  type EdielCertificationEvidenceRecord,
} from "@/lib/ediel/certificationEvidence";
import { TenantWebsiteGoLivePanel } from "@/components/admin/go-live/TenantWebsiteGoLivePanel";
import { CertificationEvidencePanel } from "@/components/admin/go-live/CertificationEvidencePanel";

export const dynamic = "force-dynamic";

type SafeLoad<T> =
  | { ok: true; data: T }
  | { ok: false; code: string };

function loadErrorCode(error: unknown): string {
  const value = error as { code?: unknown; message?: unknown } | null;
  if (typeof value?.code === "string" && value.code.trim()) return value.code;
  if (typeof value?.message === "string" && value.message.trim()) return value.message;
  return "go_live_load_failed";
}

async function safeLoad<T>(
  label: string,
  loader: () => Promise<T>,
): Promise<SafeLoad<T>> {
  try {
    return { ok: true, data: await loader() };
  } catch (error) {
    const code = loadErrorCode(error);
    console.error(`[platform-go-live] ${label} failed`, { code });
    return { ok: false, code };
  }
}

function LoadFailure({
  title,
  companyId,
}: {
  title: string;
  companyId: string;
}) {
  return (
    <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-950 shadow-sm">
      <h2 className="text-lg font-black">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm font-semibold leading-6">
        Ingen produktionsändring har gjorts. Ladda om kontrollen. Om felet kvarstår
        ska det felsökas innan bolaget sätts live.
      </p>
      <Link
        href={`/admin/platform/go-live/${companyId}`}
        className="mt-4 inline-flex rounded-xl bg-red-800 px-4 py-2 text-sm font-black text-white hover:bg-red-900"
      >
        Kör om kontrollen
      </Link>
    </section>
  );
}

export default async function PlatformGoLiveCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams?: Promise<{ status?: string; message?: string }>;
}) {
  const admin = await requirePlatformAdminAccess();
  const { companyId } = await params;
  const notice = searchParams ? await searchParams : {};
  const summary = await getActorTestingSummary(companyId);

  if (!summary) {
    return <div className="p-8">Bolaget hittades inte.</div>;
  }

  const [readinessLoad, setupLoad, websiteLoad, evidenceLoad] = await Promise.all([
    safeLoad<ProductionReadinessResult>("production readiness", () =>
      getCompanyProductionReadiness(companyId, { checkedBy: admin.userId }),
    ),
    safeLoad<GoLiveSetupSummary | null>("setup summary", () =>
      getCompanyGoLiveSetupSummary(companyId),
    ),
    safeLoad<TenantWebsiteGoLiveSummary | null>("website readiness", () =>
      getTenantWebsiteGoLiveSummary(companyId),
    ),
    safeLoad<EdielCertificationEvidenceRecord[]>("certification evidence", () =>
      listEdielCertificationEvidence(companyId),
    ),
  ]);

  const readiness = readinessLoad.ok ? readinessLoad.data : null;
  const setupSummary = setupLoad.ok ? setupLoad.data : null;
  const websiteSummary = websiteLoad.ok ? websiteLoad.data : null;
  const certificationEvidence = evidenceLoad.ok ? evidenceLoad.data : null;

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`Produktionssättning · ${summary.company.name}`}
        subtitle="Ett repeterbart superadmin-flöde: bolagssäkerhet, webb & Mina sidor, production-evidens, readiness, dry run och slutlig aktivering."
        userEmail={admin.email}
        workspaceMode="platform"
      />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">
            Repeterbart go-live-flöde
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-emerald-200 bg-white p-4">
              <div className="text-sm font-black text-slate-950">1. Bolaget är säkert</div>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                Aktivt bolag, rätt roller, bolagsseparerad åtkomst och inga lifecycle-blockerare.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-4">
              <div className="text-sm font-black text-slate-950">2. Webb & Mina sidor</div>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                API-klient, origins, kundportal, juridik, mail och automation verifieras med installationskvitto.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-4">
              <div className="text-sm font-black text-slate-950">3. Bevis + dry run</div>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                Verklig certifiering/pilot, Ediel-routes och dry run måste passera utan genvägar.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-4">
              <div className="text-sm font-black text-slate-950">4. Sätt bolaget live</div>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                Production aktiveras först när backend-gaten är grön. Nya elavtal kräver därefter live-status även vid runtime.
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/platform/go-live"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Alla bolag
          </Link>
          <Link
            href={`/admin/platform/actor-testing/${summary.company.id}`}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            Tester & certifiering
          </Link>
          <Link
            href={`/admin/platform/go-live/${summary.company.id}/route-wizard`}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Ediel routes
          </Link>
        </div>
        {notice?.message ? (
          <div
            className={`rounded-3xl border p-5 text-sm font-semibold ${notice.status === "live" || notice.status === "prepared" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : notice.status === "blocked" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900"}`}
          >
            {notice.message}
          </div>
        ) : null}

        <ActorCompanyIdentityCard summary={summary} />

        {setupSummary ? <CompanyGoLiveSetupPanel summary={setupSummary} /> : null}
        {!setupLoad.ok ? (
          <LoadFailure title="Grundkontrollen kunde inte laddas" companyId={companyId} />
        ) : null}

        {websiteSummary ? <TenantWebsiteGoLivePanel summary={websiteSummary} /> : null}
        {!websiteLoad.ok || (websiteLoad.ok && !websiteSummary) ? (
          <LoadFailure title="Webb & Mina sidor kunde inte verifieras" companyId={companyId} />
        ) : null}

        {certificationEvidence ? (
          <CertificationEvidencePanel companyId={companyId} records={certificationEvidence} />
        ) : null}
        {!evidenceLoad.ok ? (
          <LoadFailure title="Production-evidens kunde inte laddas" companyId={companyId} />
        ) : null}

        {readiness ? (
          <ProductionReadinessPanel
            readiness={readiness}
            returnPath={`/admin/platform/go-live/${summary.company.id}`}
            canManageProduction
          />
        ) : (
          <LoadFailure title="Production readiness kunde inte laddas" companyId={companyId} />
        )}

        <details className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <summary className="cursor-pointer text-sm font-black text-slate-950">
            Avancerat: testprofil, äldre actor-data och evidence package
          </summary>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Den normala go-live-processen ska styras av bolagets production
            actor, BRP, Ediel routes, readiness och dry run. Manuella receivers,
            testmotparter och evidence-detaljer visas här för felsökning och
            revision, inte som primär produktionskonfiguration.
          </p>
          <div className="mt-6 space-y-6">
            <ActorProfileGuide summary={summary} />
            <EvidencePackage summary={summary} />
          </div>
        </details>
      </div>
    </div>
  );
}
