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
  getEdielCertificationEvidenceSnapshot,
  type EdielCertificationEvidenceSnapshot,
} from "@/lib/ediel/certificationEvidence";
import { TenantWebsiteGoLivePanel } from "@/components/admin/go-live/TenantWebsiteGoLivePanel";
import { CertificationEvidencePanel } from "@/components/admin/go-live/CertificationEvidencePanel";
import { approveCompanyProductionAction } from "@/app/admin/platform/go-live/approval-actions";
import { saveTenantBrpAction } from "@/app/admin/platform/go-live/brp-actions";
import { reconcileTenantOperationalCapabilitiesAction } from "@/app/admin/platform/go-live/capability-actions";
import {
  listTenantOperationalCapabilities,
  type TenantOperationalCapability,
} from "@/lib/integrations/tenantWebsiteReadiness";
import {
  listRegistryBalanceResponsibleActors,
  listTenantBrpVersions,
  type RegistryBalanceResponsibleActor,
  type TenantBrpVersion,
} from "@/lib/ediel/tenantBrp";
import { formatStatusLabel } from '@/lib/ui/format'

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

  const [readinessLoad, setupLoad, websiteLoad, evidenceLoad, brpActorsLoad, brpVersionsLoad, capabilitiesLoad] = await Promise.all([
    safeLoad<ProductionReadinessResult>("production readiness", () =>
      getCompanyProductionReadiness(companyId, { checkedBy: admin.userId }),
    ),
    safeLoad<GoLiveSetupSummary | null>("setup summary", () =>
      getCompanyGoLiveSetupSummary(companyId),
    ),
    safeLoad<TenantWebsiteGoLiveSummary | null>("website readiness", () =>
      getTenantWebsiteGoLiveSummary(companyId),
    ),
    safeLoad<EdielCertificationEvidenceSnapshot>("certification evidence", () =>
      getEdielCertificationEvidenceSnapshot(companyId),
    ),
    safeLoad<RegistryBalanceResponsibleActor[]>("brp registry", () =>
      listRegistryBalanceResponsibleActors(),
    ),
    safeLoad<TenantBrpVersion[]>("brp versions", () => listTenantBrpVersions(companyId)),
    safeLoad<TenantOperationalCapability[]>("operational capabilities", () => listTenantOperationalCapabilities(companyId)),
  ]);

  const readiness = readinessLoad.ok ? readinessLoad.data : null;
  const setupSummary = setupLoad.ok ? setupLoad.data : null;
  const websiteSummary = websiteLoad.ok ? websiteLoad.data : null;
  const certificationEvidence = evidenceLoad.ok ? evidenceLoad.data : null;

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={`Produktionssättning · ${summary.company.name}`}
        subtitle="Normalvägen är en enda superadmin-åtgärd: systemet kör aktuell readiness, production dry run och live-aktivering automatiskt. Detaljstegen finns kvar för felsökning och revision."
        userEmail={admin.email}
        workspaceMode="platform"
      />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">
            Enkel production approval
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-emerald-200 bg-white p-4">
              <div className="text-sm font-black text-slate-950">1. Kontrollera bolaget</div>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                Aktiv tenant, rätt production-actor, BRP, routes, mailbox och giltig certifiering/evidens kontrolleras från aktuella masterdata.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-4">
              <div className="text-sm font-black text-slate-950">2. Kör dry run</div>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                Systemet skapar en aktuell production dry run utan att skicka något Ediel-meddelande.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-4">
              <div className="text-sm font-black text-slate-950">3. Godkänn production</div>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                Om allt passerar sätts canonical production live och send-lock låses upp i samma auditerade flöde.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-4">
              <div className="text-sm font-black text-slate-950">4. Kundintag är separat</div>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">
                Hemsidan kan ta emot giltiga avtal när webb/avtalsreadiness är klar. Ett tillfälligt Ediel send-lock stoppar bara själva marknadsutskicket, inte tenantens försäljning.
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
            className={`rounded-3xl border p-5 text-sm font-semibold ${notice.status === "live" || notice.status === "prepared" || notice.status === "brp_saved" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : notice.status === "blocked" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900"}`}
          >
            {notice.message}
          </div>
        ) : null}

        <section className="rounded-3xl border border-emerald-300 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Primär åtgärd</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Kontrollera & godkänn bolaget</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
                Ett klick kör ny readiness, ny production dry run och canonical live-aktivering. Om bolaget aldrig har haft sin första live-send godkänd ingår även det i samma explicita superadmin-godkännande. Vid en blockerare ändras ingen production-state och orsaken visas direkt.
              </p>
              {readiness ? (
                <p className="mt-3 text-xs font-bold text-slate-600">
                  Nuvarande readiness: {formatStatusLabel(readiness.status)} · {readiness.score}% · {readiness.blockingIssues.length} blockerare.
                </p>
              ) : null}
            </div>
            <form action={approveCompanyProductionAction}>
              <input type="hidden" name="company_id" value={companyId} />
              <input type="hidden" name="redirect_to" value={`/admin/platform/go-live/${companyId}`} />
              <label className="mb-3 block text-sm font-bold text-slate-950">
                Sparat produktionsmeddelande för dry run
                <input name="message_id" required autoComplete="off" placeholder="Meddelandets UUID" className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal" />
              </label>
              <button
                disabled={!readinessLoad.ok}
                className="rounded-2xl bg-emerald-700 px-6 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                Kontrollera & godkänn production
              </button>
            </form>
          </div>
        </section>

        <TenantBrpStep
          companyId={companyId}
          actors={brpActorsLoad.ok ? brpActorsLoad.data : null}
          versions={brpVersionsLoad.ok ? brpVersionsLoad.data : null}
        />

        <TenantOperationalCapabilitiesStep
          companyId={companyId}
          capabilities={capabilitiesLoad.ok ? capabilitiesLoad.data : null}
        />

        <ActorCompanyIdentityCard summary={summary} />

        {setupSummary ? <CompanyGoLiveSetupPanel summary={setupSummary} /> : null}
        {!setupLoad.ok ? (
          <LoadFailure title="Grundkontrollen kunde inte laddas" companyId={companyId} />
        ) : null}

        {certificationEvidence ? (
          <CertificationEvidencePanel
            companyId={companyId}
            records={certificationEvidence.records}
            verifiedAt={certificationEvidence.verifiedAt}
            pilotRequired={certificationEvidence.pilotRequired}
          />
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

        {websiteSummary ? <TenantWebsiteGoLivePanel summary={websiteSummary} /> : null}
        {!websiteLoad.ok || (websiteLoad.ok && !websiteSummary) ? (
          <LoadFailure title="Webb & Mina sidor kunde inte verifieras" companyId={companyId} />
        ) : null}

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

const CAPABILITY_LABELS: Record<string, string> = {
  email_outbound: "Utgående e-post",
  facility_lookup: "Nätägarförfrågan med fullmakt",
  customer_automation: "Kundautomation",
};

function TenantOperationalCapabilitiesStep({
  companyId,
  capabilities,
}: {
  companyId: string;
  capabilities: TenantOperationalCapability[] | null;
}) {
  const shown = capabilities?.filter((capability) => CAPABILITY_LABELS[capability.code]) ?? null;
  return (
    <section id="capabilities" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">Go-live</p>
      <h2 className="mt-2 text-xl font-black text-slate-950">Driftkapabiliteter</h2>
      <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-700">
        Bolaget behöver utgående e-post, nätägarförfrågan och kundautomation även utan webbförsäljning. Kontrollen använder samma krav som webbens go-live: verifierad avsändare, aktiva mallar och regler, driftbrevlåda och automationskonto. Den körs också när bolaget godkänns för production.
      </p>
      {shown === null ? (
        <p className="mt-4 text-sm font-semibold text-red-800">Kapabiliteterna kunde inte läsas. Ladda om sidan.</p>
      ) : (
        <ul className="mt-4 space-y-1 text-sm font-semibold text-slate-800">
          {shown.map((capability) => (
            <li key={capability.code}>
              {CAPABILITY_LABELS[capability.code]}: {capability.ready ? "redo" : `inte redo${capability.blockers.length ? ` (${capability.blockers.join(", ")})` : ""}`}
            </li>
          ))}
        </ul>
      )}
      <form action={reconcileTenantOperationalCapabilitiesAction} className="mt-5">
        <input type="hidden" name="company_id" value={companyId} />
        <button className="rounded-2xl bg-emerald-700 px-6 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-800">
          Kontrollera driftkapabiliteter
        </button>
      </form>
    </section>
  );
}

function TenantBrpStep({
  companyId,
  actors,
  versions,
}: {
  companyId: string;
  actors: RegistryBalanceResponsibleActor[] | null;
  versions: TenantBrpVersion[] | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const current = versions?.find(
    (version) =>
      version.isActive &&
      (!version.validFrom || version.validFrom <= today) &&
      (!version.validTo || version.validTo >= today),
  );
  const currentActor = actors?.find((actor) => actor.edielId === current?.brpEdielId);
  return (
    <section id="brp" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-600">Onboarding</p>
      <h2 className="mt-2 text-xl font-black text-slate-950">Balansansvarig (BRP)</h2>
      <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-700">
        Välj bolagets balansansvariga ur Ediels aktörsregister. Varje leverantörsbyte (Z03) anger den BRP som gäller på startdatumet. En ändring blir en ny version från ett senare datum, och tidigare versioner sparas.
      </p>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-800">
        {versions === null
          ? "BRP-versioner kunde inte läsas."
          : current
            ? `Gäller idag: ${current.brpName} (${current.brpEdielId})${current.validFrom ? ` från ${current.validFrom}` : " utan startdatum"}.`
            : "Ingen BRP gäller idag. Bolaget kan inte gå live förrän en BRP är vald."}
      </div>
      {versions && versions.length > 1 ? (
        <ul className="mt-3 space-y-1 text-xs font-semibold text-slate-600">
          {versions.map((version) => (
            <li key={version.id}>
              {version.brpName} ({version.brpEdielId}): {version.validFrom ?? "utan startdatum"} till {version.validTo ?? "tills vidare"}
            </li>
          ))}
        </ul>
      ) : null}
      {actors === null ? (
        <p className="mt-4 text-sm font-semibold text-red-800">Aktörsregistret kunde inte läsas. Ladda om sidan.</p>
      ) : actors.length === 0 ? (
        <p className="mt-4 text-sm font-semibold text-amber-900">
          Inga balansansvariga finns i aktörsregistret. Importera Ediels aktörslista under{" "}
          <Link href="/admin/ediel/actors" className="underline">Ediel-aktörer</Link> först.
        </p>
      ) : (
        <form action={saveTenantBrpAction} className="mt-5 grid gap-4 md:grid-cols-[2fr_1fr_auto] md:items-end">
          <input type="hidden" name="company_id" value={companyId} />
          <label className="grid gap-1 text-sm font-bold text-slate-950">
            Balansansvarig
            <select
              name="brp_actor_id"
              required
              defaultValue={currentActor?.actorId ?? ""}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal"
            >
              <option value="">Välj ur Ediels register</option>
              {actors.map((actor) => (
                <option key={actor.actorId} value={actor.actorId}>
                  {actor.name} ({actor.edielId}){actor.verified ? "" : ", verifieras vid val"}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-bold text-slate-950">
            Gäller från
            <input
              type="date"
              name="valid_from"
              required
              defaultValue={today}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal"
            />
          </label>
          <button className="rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white hover:bg-emerald-800">
            Spara BRP
          </button>
        </form>
      )}
    </section>
  );
}
