"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { ContractOfferRow, ContractType } from "@/lib/customer-contracts/types";
import {
  saveContractOfferAction,
  type SaveContractOfferState,
} from "@/app/admin/contracts/actions";
import WebsitePricingField from "@/components/admin/contracts/WebsitePricingField";
import PortfolioPricingEditor, {
  type PortfolioOption,
} from "@/components/admin/contracts/PortfolioPricingEditor";
import PricingCalculationBaseField from "@/components/admin/contracts/PricingCalculationBaseField";
import CommercialPricingEditor from "@/components/admin/contracts/CommercialPricingEditor";

const ALL_PRICE_AREAS = ["SE1", "SE2", "SE3", "SE4"] as const;

const INITIAL_SAVE_STATE: SaveContractOfferState = {
  status: "idle",
  message: null,
};

function RequiredMark({ conditional = false }: { conditional?: boolean }) {
  return (
    <span className="ml-1 inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-rose-700">
      {conditional ? "Krävs i detta läge" : "Obligatoriskt"}
    </span>
  );
}

const controlClass =
  "w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";

const WEBSITE_VISIBILITY_ALIASES: Record<string, string> = {
  admin_fee: "administration_fee",
  discount: "campaign_discount",
  green_fee: "green_energy_fee",
};

type GreenFeeMode = "none" | "sek_month" | "ore_per_kwh";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function snapshotValue(
  offer: ContractOfferRow | null,
  key: string,
): unknown {
  const snapshot = offer?.commercial_snapshot ?? {};
  if (key in snapshot) return snapshot[key];
  const pricing = asRecord(snapshot.pricing);
  if (pricing && key in pricing) return pricing[key];

  const rawVisibilityKey = key
    .replace(/^show_/, "")
    .replace(/_on_website$/, "");
  const visibilityKeys = [
    rawVisibilityKey,
    WEBSITE_VISIBILITY_ALIASES[rawVisibilityKey],
  ].filter((value): value is string => Boolean(value));

  for (const source of [
    asRecord(snapshot.website_card_visibility),
    asRecord(snapshot.website_visibility),
  ]) {
    if (!source) continue;
    for (const visibilityKey of visibilityKeys) {
      if (visibilityKey in source) return source[visibilityKey];
    }
  }
  return undefined;
}

function snapshotPricingComponents(
  offer: ContractOfferRow | null,
): Record<string, unknown>[] {
  const snapshot = offer?.commercial_snapshot ?? {};
  return [
    snapshot.commercial_components,
    snapshot.price_components,
    snapshot.price_components_snapshot,
  ].flatMap((candidate) =>
    Array.isArray(candidate)
      ? candidate
          .map(asRecord)
          .filter((value): value is Record<string, unknown> => value !== null)
      : [],
  );
}

function snapshotComponent(
  offer: ContractOfferRow | null,
  codes: readonly string[],
): Record<string, unknown> | null {
  const normalizedCodes = new Set(codes.map((code) => code.toLowerCase()));
  return (
    snapshotPricingComponents(offer).find((component) => {
      const code = String(
        component.component_code ?? component.component_type ?? "",
      )
        .trim()
        .toLowerCase();
      return normalizedCodes.has(code);
    }) ?? null
  );
}

function snapshotComponentAmount(
  offer: ContractOfferRow | null,
  codes: readonly string[],
): number | null {
  const amount = snapshotComponent(offer, codes)?.amount;
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? parsed : null;
}

function snapshotGreenFeeMode(offer: ContractOfferRow | null): GreenFeeMode {
  const component = snapshotComponent(offer, [
    "green_energy_fee",
    "green_fee",
  ]);
  return component?.unit === "sek_month"
    ? "sek_month"
    : component?.unit === "ore_per_kwh"
      ? "ore_per_kwh"
      : "none";
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "visible", "on", "yes", "ja"].includes(normalized))
      return true;
    if (["false", "0", "hidden", "off", "no", "nej"].includes(normalized))
      return false;
  }
  return fallback;
}

function typedWeights(contractType: ContractType) {
  if (contractType === "portfolio") return { spot: 0, portfolio: 100, fixed: 0 };
  if (contractType === "mixed") return { spot: 50, portfolio: 50, fixed: 0 };
  if (contractType === "fixed") return { spot: 0, portfolio: 0, fixed: 100 };
  return { spot: 100, portfolio: 0, fixed: 0 };
}

export default function ContractOfferAdminForm({
  companyId,
  offer,
  portfolios,
}: {
  companyId: string;
  offer: ContractOfferRow | null;
  portfolios: PortfolioOption[];
}) {
  const [saveState, submitAction, isSaving] = useActionState(
    saveContractOfferAction,
    INITIAL_SAVE_STATE,
  );
  const errorBannerRef = useRef<HTMLDivElement>(null);
  const initialType = offer?.contract_type ?? "variable_hourly";
  const [contractType, setContractType] = useState<ContractType>(initialType);
  const [contractName, setContractName] = useState(offer?.name ?? "");
  const [customerType, setCustomerType] = useState<
    "private" | "business" | "both"
  >(offer?.customer_type ?? "both");
  const [bindingMonths, setBindingMonths] = useState(
    offer?.default_binding_months ?? 0,
  );
  const [noticeMonths, setNoticeMonths] = useState(
    offer?.default_notice_months ?? 1,
  );
  const [automaticRenewalTermMonths, setAutomaticRenewalTermMonths] = useState(
    offer?.automatic_renewal_term_months ?? 12,
  );
  const defaultWeights = useMemo(() => {
    if (offer && contractType === initialType) {
      return {
        spot: asNumber(snapshotValue(offer, "spot_weight_percent"), typedWeights(contractType).spot),
        portfolio: asNumber(
          snapshotValue(offer, "portfolio_weight_percent"),
          typedWeights(contractType).portfolio,
        ),
        fixed: asNumber(snapshotValue(offer, "fixed_weight_percent"), typedWeights(contractType).fixed),
      };
    }
    return typedWeights(contractType);
  }, [contractType, initialType, offer]);

  const lifecycle = offer?.lifecycle_status ?? "draft";
  const locked = ["published", "paused", "expired", "archived", "superseded"].includes(lifecycle);
  const editableLifecycle = locked ? "draft" : lifecycle === "ready" ? "ready" : "draft";
  const formKey = `${offer?.id ?? "new"}:${contractType}`;
  const initialPriceAreas = Array.isArray(snapshotValue(offer, "price_areas"))
    ? (snapshotValue(offer, "price_areas") as unknown[])
        .map(String)
        .filter((area): area is (typeof ALL_PRICE_AREAS)[number] =>
          ALL_PRICE_AREAS.includes(area as (typeof ALL_PRICE_AREAS)[number]),
        )
    : [...ALL_PRICE_AREAS];
  const [priceAreas, setPriceAreas] = useState<(typeof ALL_PRICE_AREAS)[number][]>(
    initialPriceAreas.length > 0 ? initialPriceAreas : [...ALL_PRICE_AREAS],
  );
  const [fixedSharePercent, setFixedSharePercent] = useState(
    offer
      ? asNumber(
          snapshotValue(offer, "fixed_weight_percent"),
          typedWeights(initialType).fixed,
        )
      : typedWeights(initialType).fixed,
  );
  const [automaticRenewal, setAutomaticRenewal] = useState(
    offer?.automatic_renewal === true,
  );
  const [productionEnabled, setProductionEnabled] = useState(
    asBoolean(snapshotValue(offer, "production_enabled")),
  );
  const initialGreenFeeMode: GreenFeeMode =
    offer?.green_fee_mode === "sek_month" ||
    offer?.green_fee_mode === "ore_per_kwh"
      ? offer.green_fee_mode
      : snapshotGreenFeeMode(offer);
  const [greenFeeMode, setGreenFeeMode] =
    useState<GreenFeeMode>(initialGreenFeeMode);

  const monthlyFeeDefault =
    offer?.monthly_fee_sek ??
    snapshotComponentAmount(offer, ["monthly_fee"]);
  const invoiceFeeDefault =
    offer?.invoice_fee_sek ??
    snapshotComponentAmount(offer, [
      "invoice_fee",
      "invoice_administration_fee",
    ]) ??
    0;
  const initialGreenFeeValue =
    offer?.green_fee_value ??
    snapshotComponentAmount(offer, ["green_energy_fee", "green_fee"]);
  const [greenFeeValue, setGreenFeeValue] = useState(
    asString(initialGreenFeeValue),
  );
  const startFeeDefault =
    offer?.start_fee_sek ?? snapshotComponentAmount(offer, ["start_fee"]);
  const adminFeeDefault =
    offer?.admin_fee_sek ??
    snapshotComponentAmount(offer, ["administration_fee", "admin_fee"]);
  const breakFeeDefault =
    offer?.break_fee_sek ?? snapshotComponentAmount(offer, ["break_fee"]);

  useEffect(() => {
    if (saveState.status !== "error") return;
    errorBannerRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    errorBannerRef.current?.focus({ preventScroll: true });
  }, [saveState]);

  function submitWithoutReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const submittedData = new FormData(form);
    startTransition(() => submitAction(submittedData));
  }

  return (
    <form
      onSubmit={submitWithoutReset}
      className="mt-6 min-w-0 space-y-5"
      aria-busy={isSaving}
    >
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="id" value={offer?.id ?? ""} />

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
        <p className="font-bold text-slate-950">
          Fält med <RequiredMark /> måste fyllas i innan utkastet kan sparas.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Vid validerings- eller serverfel ligger alla inmatade värden kvar i
          formuläret. Korrigera det markerade felet och försök igen.
        </p>
      </div>

      {saveState.status === "error" && saveState.message ? (
        <div
          ref={errorBannerRef}
          role="alert"
          aria-live="assertive"
          tabIndex={-1}
          className="scroll-mt-24 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm font-semibold leading-6 text-rose-950"
        >
          <p className="font-black">Avtalet kunde inte sparas</p>
          <p className="mt-1 break-words">{saveState.message}</p>
          <p className="mt-2 text-xs font-medium text-rose-800">
            Dina uppgifter är kvar. Du behöver inte börja om.
          </p>
        </div>
      ) : null}

      {offer ? (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">
          <strong>{locked ? "Ny version skapas:" : "Utkastet uppdateras:"}</strong>{" "}
          Produktserie {offer.version_series_id ?? "skapas vid sparning"} · aktuell version {offer.version_number ?? 1} · prisversion {offer.price_version ?? "automatisk"}.
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          Nya avtal skapas som utkast. Publicering är ett separat, readiness-kontrollerat steg.
        </div>
      )}

      <input type="hidden" name="slug" value={offer?.slug ?? ""} />
      <input type="hidden" name="lifecycle_status" value={editableLifecycle} />

      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              Steg 1 av 3
            </p>
            <h3 className="mt-1 text-lg font-black text-emerald-950">
              Grunduppgifter
            </h3>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800">
            Utkast sparas först
          </span>
        </div>
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-3">
          <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">
            <span>Avtalsnamn <RequiredMark /></span>
            <input
              name="name"
              required
              value={contractName}
              onChange={(event) => setContractName(event.target.value)}
              placeholder="Exempel: Rörligt elpris"
              className={controlClass}
            />
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">
            <span>Avtalstyp <RequiredMark /></span>
            <select
              name="contract_type"
              required
              value={contractType}
              onChange={(event) => {
                const nextType = event.target.value as ContractType;
                setContractType(nextType);
                setFixedSharePercent(
                  offer && nextType === initialType
                    ? asNumber(
                        snapshotValue(offer, "fixed_weight_percent"),
                        typedWeights(nextType).fixed,
                      )
                    : typedWeights(nextType).fixed,
                );
              }}
              className={controlClass}
            >
              <option value="fixed">Fast pris</option>
              <option value="variable_monthly">Rörligt månadspris</option>
              <option value="variable_hourly">Rörligt timpris</option>
              <option value="variable_quarterly">Rörligt kvartspris</option>
              <option value="portfolio">Portföljpris</option>
              <option value="mixed">Mixavtal</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">
            <span>Kundtyp <RequiredMark /></span>
            <select
              name="customer_type"
              required
              value={customerType}
              onChange={(event) =>
                setCustomerType(
                  event.target.value as "private" | "business" | "both",
                )
              }
              className={controlClass}
            >
              <option value="private">Privatkund</option>
              <option value="business">Företagskund</option>
              <option value="both">Privat och företag</option>
            </select>
          </label>
        </div>
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-black text-slate-800">
          Beskrivning och kampanj (valfritt)
        </summary>
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          <input name="campaign_name" defaultValue={offer?.campaign_name ?? ""} placeholder="Kampanjnamn" className={controlClass} />
          <input name="campaign_code" defaultValue={offer?.campaign_code ?? ""} placeholder="Kampanjkod" className={controlClass} />
          <input name="campaign_version" defaultValue={offer?.campaign_version ?? "v1"} placeholder="Kampanjversion" className={controlClass} />
          <input name="terms_version" defaultValue={offer?.terms_version ?? "v1"} placeholder="Villkorsversion" className={controlClass} />
        </div>
        <textarea name="description" defaultValue={offer?.description ?? ""} rows={3} placeholder="Beskrivning" className={`${controlClass} mt-4`} />
      </details>

      <section className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
          Steg 2 av 3
        </p>
        <h3 className="mt-1 font-black text-slate-950">
          Pris
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          Endast fälten för vald avtalstyp skickas till servern. Typbyte
          avmonterar föregående prismodell så att dolda värden inte kan följa
          med.
        </p>
        <div className="mt-4 min-w-0 rounded-2xl border border-emerald-200 bg-white p-4">
          <input type="hidden" name="price_areas" value={priceAreas.join(",")} />
          <h4 className="text-sm font-black text-slate-950">
            Elområden där avtalet gäller <RequiredMark />
          </h4>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Välj minst ett område. Samma områden följer genom publicering, kundavtal,
            prisversion och fakturering. Fastpris anges separat per valt område.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {ALL_PRICE_AREAS.map((area) => {
              const selected = priceAreas.includes(area);
              return (
                <label
                  key={area}
                  className={`flex min-w-0 items-center justify-between gap-3 rounded-xl border px-3 py-3 text-sm font-black transition ${
                    selected
                      ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                >
                  {area}
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) =>
                      setPriceAreas((current) =>
                        event.target.checked
                          ? [...ALL_PRICE_AREAS].filter(
                              (candidate) => current.includes(candidate) || candidate === area,
                            )
                          : current.filter((candidate) => candidate !== area),
                      )
                    }
                  />
                </label>
              );
            })}
          </div>
          {priceAreas.length === 0 ? (
            <p className="mt-2 text-xs font-bold text-rose-700">
              Välj minst ett elområde innan avtalet sparas.
            </p>
          ) : null}
        </div>

        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
          {contractType === "fixed" ? (
            <div className="rounded-2xl border border-indigo-200 bg-white p-4 text-sm text-indigo-950 md:col-span-2">
              Ange fast pris per valt elområde i standardalternativet nedan.
              <input
                type="hidden"
                name="show_fixed_price_on_website"
                value="true"
              />
            </div>
          ) : (
            <WebsitePricingField
              name="spot_markup_ore_per_kwh"
              label="Påslag, öre/kWh"
              placeholder="Exempel: 4"
              visibilityName="show_spot_markup_on_website"
              defaultValue={offer?.spot_markup_ore_per_kwh}
              defaultVisible={asBoolean(
                snapshotValue(offer, "show_spot_markup_on_website"),
                true,
              )}
            />
          )}
        </div>

        <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-black text-slate-800">
            Fler energikomponenter (valfritt)
          </summary>
          <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
            {contractType !== "fixed" ? (
              <WebsitePricingField
                name="variable_fee_ore_per_kwh"
                placeholder="Rörlig avgift öre/kWh"
                visibilityName="show_variable_fee_on_website"
                defaultValue={offer?.variable_fee_ore_per_kwh}
                defaultVisible={asBoolean(
                  snapshotValue(offer, "show_variable_fee_on_website"),
                )}
              />
            ) : (
              <input type="hidden" name="variable_fee_ore_per_kwh" value="" />
            )}
            <WebsitePricingField
              name="electricity_certificate_ore_per_kwh"
              placeholder="Elcertifikat öre/kWh"
              visibilityName="show_electricity_certificate_on_website"
              defaultValue={asString(
                snapshotValue(offer, "electricity_certificate_ore_per_kwh"),
              )}
              defaultVisible={asBoolean(
                snapshotValue(
                  offer,
                  "show_electricity_certificate_on_website",
                ),
              )}
            />
            {contractType === "portfolio" || contractType === "mixed" ? (
              <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">
                <span>Prisintervall <RequiredMark /></span>
                <select
                  name="spot_interval_resolution"
                  required
                  defaultValue={asString(
                    snapshotValue(offer, "spot_interval_resolution"),
                    "monthly",
                  )}
                  className={controlClass}
                >
                  <option value="monthly">Månadspris</option>
                  <option value="hourly">Timpris</option>
                  <option value="quarterly">Kvartspris</option>
                </select>
              </label>
            ) : (
              <input
                type="hidden"
                name="spot_interval_resolution"
                value={
                  contractType === "variable_hourly"
                    ? "hourly"
                    : contractType === "variable_quarterly"
                      ? "quarterly"
                      : contractType === "variable_monthly"
                        ? "monthly"
                        : ""
                }
              />
            )}
          </div>
        </details>
      </section>

      {(contractType === "portfolio" || contractType === "mixed") && (
        <PortfolioPricingEditor
          key={formKey}
          portfolios={portfolios}
          defaultPortfolioId={asString(snapshotValue(offer, "portfolio_id"))}
          defaultSpotWeight={defaultWeights.spot}
          defaultPortfolioWeight={defaultWeights.portfolio}
          defaultFixedWeight={defaultWeights.fixed}
          onFixedWeightChange={setFixedSharePercent}
          defaultManagementFeeAmount={asString(snapshotValue(offer, "portfolio_management_fee_amount"))}
          defaultManagementFeeUnit={asString(snapshotValue(offer, "portfolio_management_fee_unit"), "ore_per_kwh")}
          defaultManagementFeeCalculationBase={asString(snapshotValue(offer, "portfolio_management_fee_calculation_base"), "portfolio_cost")}
          defaultManagementFeeVisible={asBoolean(snapshotValue(offer, "show_portfolio_management_fee_on_website"))}
          defaultPortfolioPriceVisible={asBoolean(snapshotValue(offer, "show_portfolio_price_on_website"), true)}
          defaultSettlementTiming={asString(snapshotValue(offer, "portfolio_settlement_timing"), "after_month_close")}
          defaultEstimateRule={asString(snapshotValue(offer, "portfolio_estimate_rule"), "none")}
        />
      )}

      <section className="min-w-0 overflow-hidden rounded-3xl border border-sky-200 bg-sky-50 p-4 sm:p-5">
        <h3 className="font-black text-sky-950">Avgifter</h3>
        <p className="mt-1 text-xs leading-5 text-sky-900">
          För ett normalt avtal räcker månadsavgift och fakturaavgift. Övriga
          avgifter ligger under valfria inställningar.
        </p>
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
          <WebsitePricingField
            name="monthly_fee_sek"
            label="Månadsavgift, kr/månad"
            placeholder="Exempel: 49"
            visibilityName="show_monthly_fee_on_website"
            defaultValue={monthlyFeeDefault}
            defaultVisible={asBoolean(
              snapshotValue(offer, "show_monthly_fee_on_website"),
              true,
            )}
            type="number"
            min={0}
            step={0.01}
            helpText="Lämna tomt om avtalet saknar månadsavgift. Ange 0 om nollbeloppet ska vara uttryckligt."
          />
          <WebsitePricingField
            name="invoice_fee_sek"
            label="Fakturaavgift, kr per faktura"
            placeholder="Ange 0 om avgiftsfritt"
            visibilityName="show_invoice_fee_on_website"
            defaultValue={invoiceFeeDefault}
            defaultVisible={asBoolean(
              snapshotValue(offer, "show_invoice_fee_on_website"),
              true,
            )}
            required
            type="number"
            min={0}
            step={0.01}
            helpText="Ange alltid ett värde. Skriv 0 när avtalet är avgiftsfritt."
          />
        </div>

        <details className="mt-4 rounded-2xl border border-sky-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-black text-sky-950">
            Fler avgifter (valfritt)
          </summary>
          <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            <WebsitePricingField
              name="start_fee_sek"
              label="Startavgift, kr per avtal"
              placeholder="Valfri engångsavgift"
              visibilityName="show_start_fee_on_website"
              defaultValue={startFeeDefault}
              defaultVisible={asBoolean(
                snapshotValue(offer, "show_start_fee_on_website"),
                true,
              )}
              type="number"
              min={0}
              step={0.01}
            />
            <WebsitePricingField
              name="admin_fee_sek"
              label="Administrationsavgift, kr per avtal"
              placeholder="Valfri engångsavgift"
              visibilityName="show_admin_fee_on_website"
              defaultValue={adminFeeDefault}
              defaultVisible={asBoolean(
                snapshotValue(offer, "show_admin_fee_on_website"),
                true,
              )}
              type="number"
              min={0}
              step={0.01}
            />
            <WebsitePricingField
              name="break_fee_sek"
              label="Brytavgift, kr vid förtida avslut"
              placeholder="Valfri händelseavgift"
              visibilityName="show_break_fee_on_website"
              defaultValue={breakFeeDefault}
              defaultVisible={asBoolean(
                snapshotValue(offer, "show_break_fee_on_website"),
                true,
              )}
              type="number"
              min={0}
              step={0.01}
            />
            <div className="min-w-0 overflow-hidden rounded-2xl border border-sky-200 bg-white p-3">
              <label className="grid min-w-0 gap-2 text-xs font-semibold text-slate-700">
                Miljöavgiftens modell
                <select
                  name="green_fee_mode"
                  value={greenFeeMode}
                  onChange={(event) =>
                    setGreenFeeMode(event.target.value as GreenFeeMode)
                  }
                  className="w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                >
                  <option value="none">Ingen miljöavgift</option>
                  <option value="sek_month">kr/månad</option>
                  <option value="ore_per_kwh">öre/kWh</option>
                </select>
              </label>
              {greenFeeMode === "none" ? (
                <input type="hidden" name="green_fee_value" value="" />
              ) : null}
              <label className="mt-3 block min-w-0 text-xs font-semibold text-slate-700">
                <span>
                  Miljöavgiftens belopp
                  {greenFeeMode !== "none" ? <RequiredMark conditional /> : null}
                </span>
                <input
                  name={greenFeeMode === "none" ? undefined : "green_fee_value"}
                  type="number"
                  min="0"
                  step="0.0001"
                  required={greenFeeMode !== "none"}
                  disabled={greenFeeMode === "none"}
                  value={greenFeeValue}
                  onChange={(event) => setGreenFeeValue(event.target.value)}
                  placeholder={
                    greenFeeMode === "sek_month"
                      ? "Belopp i kr/månad"
                      : greenFeeMode === "ore_per_kwh"
                        ? "Belopp i öre/kWh"
                        : "Välj avgiftsmodell först"
                  }
                  className="mt-2 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>
              <label className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3 text-xs font-semibold leading-4 text-slate-700">
                <span className="min-w-0 break-words">
                  Visa miljöavgiften på hemsidan
                </span>
                <input
                  type="checkbox"
                  name="show_green_fee_on_website"
                  defaultChecked={asBoolean(
                    snapshotValue(offer, "show_green_fee_on_website"),
                    true,
                  )}
                  disabled={greenFeeMode === "none"}
                  className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
            </div>
          </div>
        </details>
      </section>

      <CommercialPricingEditor
        key={`commercial:${formKey}`}
        contractType={contractType}
        applicableAreas={priceAreas}
        requiresAreaPrices={
          contractType === "fixed" ||
          (contractType === "mixed" && fixedSharePercent > 0)
        }
        snapshot={offer?.commercial_snapshot ?? null}
        simpleDefaults={{
          customerName: contractName,
          customerType,
          bindingMonths,
          noticeMonths,
          autoRenewEnabled: automaticRenewal,
          renewalTermMonths: automaticRenewal
            ? automaticRenewalTermMonths
            : null,
        }}
      />

      <details className="min-w-0 overflow-hidden rounded-3xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
        <summary className="cursor-pointer font-black text-amber-950">
          Rabatt och kampanjvillkor (valfritt)
        </summary>
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <WebsitePricingField name="discount_value" placeholder="Rabattvärde" visibilityName="show_discount_on_website" defaultValue={offer?.discount_value} defaultVisible={asBoolean(snapshotValue(offer, "show_discount_on_website"), true)} />
          <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">Rabattenhet
            <select name="discount_unit" defaultValue={offer?.discount_unit ?? "sek_month"} className={controlClass}>
              <option value="sek_month">kr/månad</option><option value="ore_per_kwh">öre/kWh</option><option value="percent">procent</option><option value="sek_once">kr engångsvis</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">
            <span>Rabattperiod, månader <RequiredMark conditional /></span>
            <input name="discount_months" type="number" min="1" defaultValue={offer?.discount_months ?? ""} className={controlClass} />
          </label>
          <PricingCalculationBaseField name="discount_calculation_base" defaultValue={offer?.discount_calculation_base ?? "total_energy_cost"} />
          <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">Rabatten börjar
            <select name="discount_starts_on_mode" defaultValue={offer?.discount_starts_on_mode ?? "contract_start"} className={controlClass}>
              <option value="contract_start">Vid avtalsstart</option><option value="calendar_month">Nästa hela kalendermånad</option>
            </select>
          </label>
        </div>
      </details>

      <section className="min-w-0 overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
          Steg 3 av 3
        </p>
        <h3 className="mt-1 font-black text-emerald-950">Avtalsvillkor</h3>
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">Bindningstid, månader
            <input name="default_binding_months" type="number" min="0" value={bindingMonths} onChange={(event) => setBindingMonths(Number(event.target.value))} className={controlClass} />
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">Uppsägningstid, månader
            <input name="default_notice_months" type="number" min="0" value={noticeMonths} onChange={(event) => setNoticeMonths(Number(event.target.value))} className={controlClass} />
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-950">
            <input
              type="checkbox"
              name="automatic_renewal"
              checked={automaticRenewal}
              onChange={(event) => setAutomaticRenewal(event.target.checked)}
            />
            Automatisk förlängning
          </label>
          {automaticRenewal ? (
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">
              <span>Förlängningsperiod, månader <RequiredMark /></span>
              <input
                name="automatic_renewal_term_months"
                required
                type="number"
                min="1"
                value={automaticRenewalTermMonths}
                onChange={(event) =>
                  setAutomaticRenewalTermMonths(Number(event.target.value))
                }
                className={controlClass}
              />
            </label>
          ) : (
            <input type="hidden" name="automatic_renewal_term_months" value="" />
          )}
        </div>

        <details className="mt-4 rounded-2xl border border-emerald-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-black text-emerald-950">
            Juridik, kapacitet och giltighetsdatum
          </summary>
          <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">Max antal samtidiga kunder
              <input name="max_customers" type="number" min="1" defaultValue={offer?.max_customers ?? ""} className={controlClass} />
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">
              <span>Moms, procent <RequiredMark /></span>
              <input name="vat_rate" required type="number" min="0" max="100" step="0.01" defaultValue={offer?.vat_rate ?? 25} className={controlClass} />
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">
              <span>Fullmaktsregel <RequiredMark /></span>
              <select name="power_of_attorney_mode" required defaultValue={offer?.power_of_attorney_mode ?? "required_when_information_missing"} className={controlClass}>
                <option value="always_required">Alltid obligatorisk</option><option value="required_when_information_missing">När anläggningsuppgifter saknas</option><option value="not_required">Krävs inte</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">Giltig från
              <input type="date" name="valid_from" defaultValue={offer?.valid_from ?? ""} className={controlClass} />
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-700">Giltig till
              <input type="date" name="valid_to" defaultValue={offer?.valid_to ?? ""} className={controlClass} />
            </label>
          </div>
        </details>
      </section>

      <details className="min-w-0 overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
        <summary className="cursor-pointer font-black text-emerald-950">
          Produktionsavtal (valfritt)
        </summary>
        <label className="mt-4 flex items-center gap-3 text-sm font-semibold text-emerald-950">
          <input
            type="checkbox"
            name="production_enabled"
            checked={productionEnabled}
            onChange={(event) => setProductionEnabled(event.target.checked)}
          />
          Avtalet kan avräkna producerad överskottsel
        </label>
        {productionEnabled ? (
          <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            <WebsitePricingField
              name="production_compensation_ore_per_kwh"
              placeholder="Produktionsersättning öre/kWh"
              visibilityName="show_production_compensation_on_website"
              defaultValue={asString(
                snapshotValue(offer, "production_compensation_ore_per_kwh"),
              )}
              required
              helpText="Obligatorisk och måste vara över 0 när produktionsavräkning är aktiverad."
            />
            <input name="production_vat_rate" defaultValue={asString(snapshotValue(offer, "production_vat_rate"), "0")} placeholder="Moms på ersättning %" className={controlClass} />
            <select name="production_settlement_mode" defaultValue={asString(snapshotValue(offer, "production_settlement_mode"), "credit_invoice")} className={controlClass}>
              <option value="credit_invoice">Kreditunderlag</option><option value="self_billing">Självfakturering</option>
            </select>
          </div>
        ) : (
          <>
            <input type="hidden" name="production_compensation_ore_per_kwh" value="" />
            <input type="hidden" name="production_vat_rate" value="0" />
            <input type="hidden" name="production_settlement_mode" value="credit_invoice" />
          </>
        )}
      </details>

      <button
        type="submit"
        disabled={isSaving || priceAreas.length === 0}
        className="w-full rounded-2xl bg-emerald-700 px-5 py-4 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {isSaving
          ? "Sparar utan att rensa formuläret…"
          : offer
            ? locked
              ? "Skapa ny immutable version"
              : "Spara avtalsutkast"
            : "Skapa canonical avtalsutkast"}
      </button>
    </form>
  );
}
