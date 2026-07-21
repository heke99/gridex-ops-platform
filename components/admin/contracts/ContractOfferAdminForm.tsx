"use client";

import { useMemo, useState } from "react";
import type { ContractOfferRow, ContractType } from "@/lib/customer-contracts/types";
import { saveContractOfferAction } from "@/app/admin/contracts/actions";
import WebsitePricingField from "@/components/admin/contracts/WebsitePricingField";
import PortfolioPricingEditor, {
  type PortfolioOption,
} from "@/components/admin/contracts/PortfolioPricingEditor";
import PricingCalculationBaseField from "@/components/admin/contracts/PricingCalculationBaseField";

function snapshotValue(
  offer: ContractOfferRow | null,
  key: string,
): unknown {
  const snapshot = offer?.commercial_snapshot ?? {};
  if (key in snapshot) return snapshot[key];
  const pricing = snapshot.pricing;
  if (pricing && typeof pricing === "object" && key in pricing) {
    return (pricing as Record<string, unknown>)[key];
  }
  const visibility = snapshot.website_card_visibility;
  if (visibility && typeof visibility === "object") {
    const visibilityKey = key.replace(/^show_/, "").replace(/_on_website$/, "");
    if (visibilityKey in visibility) {
      return (visibility as Record<string, unknown>)[visibilityKey];
    }
  }
  return undefined;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function optionalFeesText(offer: ContractOfferRow | null): string {
  const rows = Array.isArray(offer?.optional_fee_lines)
    ? offer.optional_fee_lines
    : [];
  return rows
    .map((row, index) => {
      const label = String(row.label ?? row.name ?? `Avgift ${index + 1}`);
      const amount = String(row.amount ?? row.value ?? "");
      const unit = String(row.unit ?? "sek_contract");
      const visible = row.website_visibility === true ? "ja" : "nej";
      const calculationBase = String(row.calculation_base ?? "");
      const vat = String(row.vat_treatment ?? "standard");
      const sortOrder = String(row.sort_order ?? 900 + index);
      return [label, amount, unit, visible, calculationBase, vat, sortOrder].join(" | ");
    })
    .join("\n");
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
  const initialType = offer?.contract_type ?? "variable_hourly";
  const [contractType, setContractType] = useState<ContractType>(initialType);
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

  return (
    <form action={saveContractOfferAction} className="mt-6 space-y-5">
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="id" value={offer?.id ?? ""} />

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

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Avtalsnamn
          <input name="name" required defaultValue={offer?.name ?? ""} className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Intern slug
          <input name="slug" defaultValue={offer?.slug ?? ""} placeholder="Skapas automatiskt om tomt" className="rounded-2xl border border-slate-300 px-4 py-3" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Livscykelstatus
          <select name="lifecycle_status" defaultValue={editableLifecycle} className="rounded-2xl border border-slate-300 px-4 py-3">
            <option value="draft">Utkast</option>
            <option value="ready">Redo för publiceringskontroll</option>
          </select>
          <span className="text-xs font-normal text-slate-500">
            Publicering, pausning och arkivering görs med separata, behörighetskontrollerade kommandon.
          </span>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Avtalstyp
          <select
            name="contract_type"
            value={contractType}
            onChange={(event) => setContractType(event.target.value as ContractType)}
            className="rounded-2xl border border-slate-300 px-4 py-3"
          >
            <option value="fixed">Fast</option>
            <option value="variable_monthly">Rörlig månad</option>
            <option value="variable_hourly">Rörlig tim</option>
            <option value="variable_quarterly">Rörlig kvart</option>
            <option value="portfolio">Portfölj</option>
            <option value="mixed">Mix</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Kundtyp
          <select name="customer_type" defaultValue={offer?.customer_type ?? "both"} className="rounded-2xl border border-slate-300 px-4 py-3">
            <option value="private">Privatkund</option>
            <option value="business">Företagskund</option>
            <option value="both">Privat och företag</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Prisversion
          <input readOnly value={offer?.price_version ?? "Genereras atomärt vid sparning"} className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-slate-600" />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <input name="campaign_name" defaultValue={offer?.campaign_name ?? ""} placeholder="Kampanjnamn" className="rounded-2xl border border-slate-300 px-4 py-3" />
        <input name="campaign_code" defaultValue={offer?.campaign_code ?? ""} placeholder="Kampanjkod" className="rounded-2xl border border-slate-300 px-4 py-3" />
        <input name="campaign_version" defaultValue={offer?.campaign_version ?? "v1"} placeholder="Kampanjversion" className="rounded-2xl border border-slate-300 px-4 py-3" />
        <input name="terms_version" defaultValue={offer?.terms_version ?? "v1"} placeholder="Villkorsversion" className="rounded-2xl border border-slate-300 px-4 py-3" />
      </div>
      <textarea name="description" defaultValue={offer?.description ?? ""} rows={3} placeholder="Beskrivning" className="w-full rounded-2xl border border-slate-300 px-4 py-3" />

      <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <h3 className="font-black text-slate-950">Pris och publik synlighet</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">Dold på avtalskort betyder inte borttagen. Avgiften finns fortsatt i offert, snapshot, avtal och fakturering.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <WebsitePricingField name="fixed_price_ore_per_kwh" placeholder="Fast pris öre/kWh" visibilityName="show_fixed_price_on_website" defaultValue={offer?.fixed_price_ore_per_kwh} defaultVisible={asBoolean(snapshotValue(offer, "show_fixed_price_on_website"), true)} />
          <WebsitePricingField name="spot_markup_ore_per_kwh" placeholder="Spotpåslag öre/kWh" visibilityName="show_spot_markup_on_website" defaultValue={offer?.spot_markup_ore_per_kwh} defaultVisible={asBoolean(snapshotValue(offer, "show_spot_markup_on_website"), true)} />
          <WebsitePricingField name="variable_fee_ore_per_kwh" placeholder="Rörlig avgift öre/kWh" visibilityName="show_variable_fee_on_website" defaultValue={offer?.variable_fee_ore_per_kwh} defaultVisible={asBoolean(snapshotValue(offer, "show_variable_fee_on_website"))} />
          <WebsitePricingField name="monthly_fee_sek" placeholder="Månadsavgift kr" visibilityName="show_monthly_fee_on_website" defaultValue={offer?.monthly_fee_sek} defaultVisible={asBoolean(snapshotValue(offer, "show_monthly_fee_on_website"), true)} />
          <WebsitePricingField name="invoice_fee_sek" label="Fakturaavgift, kr per faktura" placeholder="0 om avgiftsfritt" visibilityName="show_invoice_fee_on_website" helpText="Avgiften används alltid i offert, avtal och fakturering. Synlighetsvalet styr endast avtalskortet." defaultValue={offer?.invoice_fee_sek} defaultVisible={asBoolean(snapshotValue(offer, "show_invoice_fee_on_website"), true)} required={false} />
          <WebsitePricingField name="electricity_certificate_ore_per_kwh" placeholder="Elcertifikat öre/kWh" visibilityName="show_electricity_certificate_on_website" defaultValue={asString(snapshotValue(offer, "electricity_certificate_ore_per_kwh"))} defaultVisible={asBoolean(snapshotValue(offer, "show_electricity_certificate_on_website"))} />
          <label className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-700">
            Miljöavgiftens enhet
            <select name="green_fee_mode" defaultValue={offer?.green_fee_mode ?? "none"} className="rounded-xl border border-slate-300 px-4 py-3 text-sm">
              <option value="none">Ingen miljöavgift</option><option value="sek_month">kr/månad</option><option value="ore_per_kwh">öre/kWh</option>
            </select>
          </label>
          <WebsitePricingField name="green_fee_value" placeholder="Miljöavgift" visibilityName="show_green_fee_on_website" defaultValue={offer?.green_fee_value} defaultVisible={asBoolean(snapshotValue(offer, "show_green_fee_on_website"))} />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Spotintervall
            <select name="spot_interval_resolution" defaultValue={asString(snapshotValue(offer, "spot_interval_resolution"), "monthly")} className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
              <option value="monthly">Månadspris</option><option value="hourly">Timpris</option><option value="quarterly">Kvartspris</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Prisområden
            <input name="price_areas" defaultValue={Array.isArray(snapshotValue(offer, "price_areas")) ? (snapshotValue(offer, "price_areas") as unknown[]).join(",") : "SE1,SE2,SE3,SE4"} className="rounded-2xl border border-slate-300 bg-white px-4 py-3" />
          </label>
        </div>
      </section>

      <PortfolioPricingEditor
        key={formKey}
        portfolios={portfolios}
        defaultPortfolioId={asString(snapshotValue(offer, "portfolio_id"))}
        defaultSpotWeight={defaultWeights.spot}
        defaultPortfolioWeight={defaultWeights.portfolio}
        defaultFixedWeight={defaultWeights.fixed}
        defaultManagementFeeAmount={asString(snapshotValue(offer, "portfolio_management_fee_amount"))}
        defaultManagementFeeUnit={asString(snapshotValue(offer, "portfolio_management_fee_unit"), "ore_per_kwh")}
        defaultManagementFeeCalculationBase={asString(snapshotValue(offer, "portfolio_management_fee_calculation_base"), "portfolio_cost")}
        defaultManagementFeeVisible={asBoolean(snapshotValue(offer, "show_portfolio_management_fee_on_website"))}
        defaultPortfolioPriceVisible={asBoolean(snapshotValue(offer, "show_portfolio_price_on_website"), true)}
        defaultSettlementTiming={asString(snapshotValue(offer, "portfolio_settlement_timing"), "after_month_close")}
        defaultEstimateRule={asString(snapshotValue(offer, "portfolio_estimate_rule"), "none")}
      />

      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
        <h3 className="font-black text-amber-950">Rabatt och övriga avgifter</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <WebsitePricingField name="discount_value" placeholder="Rabattvärde" visibilityName="show_discount_on_website" defaultValue={offer?.discount_value} defaultVisible={asBoolean(snapshotValue(offer, "show_discount_on_website"), true)} />
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Rabattenhet
            <select name="discount_unit" defaultValue={offer?.discount_unit ?? "sek_month"} className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
              <option value="sek_month">kr/månad</option><option value="ore_per_kwh">öre/kWh</option><option value="percent">procent</option><option value="sek_once">kr engångsvis</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Rabattperiod, månader
            <input name="discount_months" type="number" min="1" defaultValue={offer?.discount_months ?? ""} className="rounded-2xl border border-amber-200 bg-white px-4 py-3" />
          </label>
          <PricingCalculationBaseField name="discount_calculation_base" defaultValue={offer?.discount_calculation_base ?? "total_energy_cost"} />
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Rabatten börjar
            <select name="discount_starts_on_mode" defaultValue={offer?.discount_starts_on_mode ?? "contract_start"} className="rounded-2xl border border-amber-200 bg-white px-4 py-3">
              <option value="contract_start">Vid avtalsstart</option><option value="calendar_month">Nästa hela kalendermånad</option>
            </select>
          </label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <WebsitePricingField name="start_fee_sek" placeholder="Startavgift kr" visibilityName="show_start_fee_on_website" defaultValue={offer?.start_fee_sek} />
          <WebsitePricingField name="admin_fee_sek" placeholder="Administrativ avgift kr" visibilityName="show_admin_fee_on_website" defaultValue={offer?.admin_fee_sek} />
          <WebsitePricingField name="break_fee_sek" placeholder="Brytavgift kr" visibilityName="show_break_fee_on_website" defaultValue={offer?.break_fee_sek} />
        </div>
        <label className="mt-4 grid gap-2 text-sm font-semibold text-slate-700">Övriga avgifter – namn | belopp | enhet | synlig | beräkningsbas | moms | sortering
          <textarea name="optional_fee_lines" rows={5} defaultValue={optionalFeesText(offer)} placeholder="Pappersfaktura | 39 | sek_invoice | ja | invoice | standard | 910" className="rounded-2xl border border-amber-200 bg-white px-4 py-3 font-mono text-xs" />
        </label>
        <label className="mt-3 flex items-center justify-between rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
          Visa övriga avgifter på avtalskortet som standard
          <input type="checkbox" name="show_optional_fees_on_website" defaultChecked={asBoolean(snapshotValue(offer, "show_optional_fees_on_website"))} />
        </label>
      </section>

      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
        <h3 className="font-black text-emerald-950">Livscykel, juridik och kapacitet</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Max antal samtidiga kunder
            <input name="max_customers" type="number" min="1" defaultValue={offer?.max_customers ?? ""} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Moms, procent
            <input name="vat_rate" type="number" min="0" max="100" step="0.01" defaultValue={offer?.vat_rate ?? 25} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Fullmaktsregel
            <select name="power_of_attorney_mode" defaultValue={offer?.power_of_attorney_mode ?? "required_when_information_missing"} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3">
              <option value="always_required">Alltid obligatorisk</option><option value="required_when_information_missing">När anläggningsuppgifter saknas</option><option value="not_required">Krävs inte</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Bindningstid, månader
            <input name="default_binding_months" type="number" min="0" defaultValue={offer?.default_binding_months ?? ""} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Uppsägningstid, månader
            <input name="default_notice_months" type="number" min="0" defaultValue={offer?.default_notice_months ?? ""} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Förlängningsperiod, månader
            <input name="automatic_renewal_term_months" type="number" min="1" defaultValue={offer?.automatic_renewal_term_months ?? ""} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3" />
          </label>
        </div>
        <label className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-950">
          <input type="checkbox" name="automatic_renewal" defaultChecked={offer?.automatic_renewal === true} /> Automatisk förlängning
        </label>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Giltig från
            <input type="date" name="valid_from" defaultValue={offer?.valid_from ?? ""} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3" />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-slate-700">Giltig till
            <input type="date" name="valid_to" defaultValue={offer?.valid_to ?? ""} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3" />
          </label>
        </div>
      </section>

      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
        <label className="flex items-center gap-3 text-sm font-semibold text-emerald-950">
          <input type="checkbox" name="production_enabled" defaultChecked={asBoolean(snapshotValue(offer, "production_enabled"))} /> Avtalet kan avräkna producerad överskottsel
        </label>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <WebsitePricingField name="production_compensation_ore_per_kwh" placeholder="Produktionsersättning öre/kWh" visibilityName="show_production_compensation_on_website" defaultValue={asString(snapshotValue(offer, "production_compensation_ore_per_kwh"))} />
          <input name="production_vat_rate" defaultValue={asString(snapshotValue(offer, "production_vat_rate"), "0")} placeholder="Moms på ersättning %" className="rounded-2xl border border-emerald-200 bg-white px-4 py-3" />
          <select name="production_settlement_mode" defaultValue={asString(snapshotValue(offer, "production_settlement_mode"), "credit_invoice")} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3">
            <option value="credit_invoice">Kreditunderlag</option><option value="self_billing">Självfakturering</option>
          </select>
        </div>
      </section>

      <button className="w-full rounded-2xl bg-emerald-700 px-5 py-4 text-sm font-black text-white hover:bg-emerald-800">
        {offer ? (locked ? "Skapa ny immutable version" : "Spara avtalsutkast") : "Skapa canonical avtalsutkast"}
      </button>
    </form>
  );
}
