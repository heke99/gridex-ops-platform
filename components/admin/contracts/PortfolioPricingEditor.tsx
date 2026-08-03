"use client";

import { useState } from "react";
import { PRICING_CALCULATION_BASES } from "@/components/admin/contracts/PricingCalculationBaseField";

export type PortfolioOption = {
  id: string;
  name: string;
  code: string;
};

export default function PortfolioPricingEditor({
  portfolios = [],
  defaultPortfolioId = "",
  defaultSpotWeight = 0,
  defaultPortfolioWeight = 100,
  defaultFixedWeight = 0,
  defaultManagementFeeAmount = "",
  defaultManagementFeeUnit = "ore_per_kwh",
  defaultManagementFeeCalculationBase = "portfolio_cost",
  defaultManagementFeeVisible = false,
  defaultPortfolioPriceVisible = true,
  defaultSettlementTiming = "after_month_close",
  defaultEstimateRule = "none",
  onFixedWeightChange,
  compact = false,
}: {
  portfolios?: PortfolioOption[];
  defaultPortfolioId?: string;
  defaultSpotWeight?: number;
  defaultPortfolioWeight?: number;
  defaultFixedWeight?: number;
  defaultManagementFeeAmount?: string | number;
  defaultManagementFeeUnit?: string;
  defaultManagementFeeCalculationBase?: string;
  defaultManagementFeeVisible?: boolean;
  defaultPortfolioPriceVisible?: boolean;
  defaultSettlementTiming?: string;
  defaultEstimateRule?: string;
  onFixedWeightChange?: (value: number) => void;
  compact?: boolean;
}) {
  const [unit, setUnit] = useState(defaultManagementFeeUnit);
  const [estimateRule, setEstimateRule] = useState(defaultEstimateRule);
  const controlClass = compact
    ? "mt-1.5 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
    : "mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3";
  const visibilityClass = compact
    ? "mt-2 flex items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold leading-4 text-slate-700"
    : "mt-3 flex items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-white px-4 py-3 text-xs font-semibold text-slate-700";

  return (
    <section
      className={`border border-indigo-200 bg-indigo-50 ${
        compact ? "rounded-2xl p-4" : "rounded-3xl p-5"
      }`}
    >
      <h3 className="text-sm font-black text-indigo-950">
        Canonical portföljmetod
      </h3>
      <p className="mt-1 text-xs leading-5 text-indigo-900">
        Avtalet låser portfölj, andelar, avgift och beräkningsmetod. Månadens
        faktiska utfallspris uppstår först efter månadsstängning i den gemensamma
        avräkningsvyn och lagras aldrig som ett framtida avtalspris.
      </p>

      <div className={`grid gap-3 md:grid-cols-2 ${compact ? "mt-3" : "mt-4"}`}>
        <label className="text-xs font-semibold text-slate-700">
          Canonical portfölj
          <select
            name="portfolio_id"
            defaultValue={defaultPortfolioId}
            className={controlClass}
          >
            <option value="">Välj portfölj</option>
            {portfolios.map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name} · {portfolio.code}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Slutlig avräkning
          <select
            name="portfolio_settlement_timing"
            defaultValue={defaultSettlementTiming}
            className={controlClass}
          >
            <option value="after_month_close">Efter månadsstängning</option>
            <option value="preliminary_then_final">
              Preliminär följd av slutlig avräkning
            </option>
          </select>
        </label>
      </div>

      <div className={`grid sm:grid-cols-3 ${compact ? "mt-3 gap-2" : "mt-4 gap-3"}`}>
        <label className="text-xs font-semibold text-slate-700">
          Rörlig andel %
          <input type="number" name="spot_weight_percent" defaultValue={defaultSpotWeight} inputMode="decimal" min="0" max="100" step="0.0001" className={controlClass} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Portföljandel %
          <input type="number" name="portfolio_weight_percent" defaultValue={defaultPortfolioWeight} inputMode="decimal" min="0" max="100" step="0.0001" className={controlClass} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Fast andel %
          <input
            type="number"
            name="fixed_weight_percent"
            defaultValue={defaultFixedWeight}
            inputMode="decimal"
            min="0"
            max="100"
            step="0.0001"
            onChange={(event) =>
              onFixedWeightChange?.(Number(event.target.value || 0))
            }
            className={controlClass}
          />
        </label>
      </div>
      <p className="mt-2 text-xs font-semibold text-indigo-900">
        Andelarna valideras till 0–100 % och måste tillsammans vara exakt 100 %.
      </p>

      <div className={`grid ${compact ? "mt-3 gap-2 md:grid-cols-[1fr_0.85fr_1.35fr]" : "mt-4 gap-3 lg:grid-cols-[1fr_1fr_1.4fr]"}`}>
        <label className="text-xs font-semibold text-slate-700">
          Portföljförvaltningsavgift
          <input name="portfolio_management_fee_amount" defaultValue={defaultManagementFeeAmount} inputMode="decimal" className={controlClass} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Enhet
          <select name="portfolio_management_fee_unit" value={unit} onChange={(event) => setUnit(event.target.value)} className={controlClass}>
            <option value="ore_per_kwh">öre/kWh</option>
            <option value="sek_per_kwh">kr/kWh</option>
            <option value="sek_month">kr/månad</option>
            <option value="sek_invoice">kr/faktura</option>
            <option value="sek_once">kr engångsvis</option>
            <option value="percent">procent</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Beräkningsbas {unit === "percent" ? "(obligatorisk)" : ""}
          <select name="portfolio_management_fee_calculation_base" defaultValue={defaultManagementFeeCalculationBase} disabled={unit !== "percent"} className={`${controlClass} disabled:bg-slate-100`}>
            {PRICING_CALCULATION_BASES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={visibilityClass}>
        <span>Visa förvaltningsavgiften på hemsidan</span>
        <input type="checkbox" name="show_portfolio_management_fee_on_website" defaultChecked={defaultManagementFeeVisible} />
      </label>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">
          Regel för icke-bindande indikation
          <select name="portfolio_estimate_rule" value={estimateRule} onChange={(event) => setEstimateRule(event.target.value)} className={controlClass}>
            <option value="none">Ingen siffra</option>
            <option value="latest_final">Senaste finala månad</option>
            <option value="rolling_3">Rullande tre finala månader</option>
            <option value="forecast">Sparad prognos</option>
            <option value="manual">Manuell indikation</option>
          </select>
        </label>
        <div className="rounded-xl border border-indigo-200 bg-white p-3 text-xs leading-5 text-slate-700">
          {estimateRule === "none"
            ? "Hemsidan visar metod och historiska finala priser, men ingen prognossiffra."
            : "Indikationen märks alltid som uppskattning och icke bindande. Den används aldrig i slutlig fakturering."}
        </div>
      </div>
      <label className={visibilityClass}>
        <span>Visa historiska finala avräkningspriser</span>
        <input type="checkbox" name="portfolio_show_historical_final" defaultChecked />
      </label>
      <label className={visibilityClass}>
        <span>Visa tillgänglig indikation som icke bindande</span>
        <input type="checkbox" name="portfolio_show_indication" defaultChecked={defaultEstimateRule !== "none"} />
      </label>
      <label className={visibilityClass}>
        <span>Visa portföljmetoden på hemsidans avtalskort</span>
        <input type="checkbox" name="show_portfolio_price_on_website" defaultChecked={defaultPortfolioPriceVisible} />
      </label>
    </section>
  );
}
