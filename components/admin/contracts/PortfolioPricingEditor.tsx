"use client";

import { useMemo, useState } from "react";
import { PRICING_CALCULATION_BASES } from "@/components/admin/contracts/PricingCalculationBaseField";

type PortfolioRow = {
  period_month: string;
  price_area_code: "ALL" | "SE1" | "SE2" | "SE3" | "SE4";
  amount_ore_per_kwh: string;
};

function nextMonth(): string {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}

export default function PortfolioPricingEditor({
  defaultSpotWeight = 0,
  defaultPortfolioWeight = 100,
  defaultFixedWeight = 0,
  defaultManagementFeeAmount = "",
  defaultManagementFeeUnit = "ore_per_kwh",
  defaultManagementFeeCalculationBase = "portfolio_cost",
  defaultManagementFeeVisible = false,
  defaultPortfolioPriceVisible = true,
  defaultRows = [],
}: {
  defaultSpotWeight?: number;
  defaultPortfolioWeight?: number;
  defaultFixedWeight?: number;
  defaultManagementFeeAmount?: string | number;
  defaultManagementFeeUnit?: string;
  defaultManagementFeeCalculationBase?: string;
  defaultManagementFeeVisible?: boolean;
  defaultPortfolioPriceVisible?: boolean;
  defaultRows?: Array<{
    period_month?: string | null;
    billing_month?: string | null;
    price_area_code?: string | null;
    price_area?: string | null;
    amount_ore_per_kwh?: number | string | null;
    amount?: number | string | null;
  }>;
}) {
  const initialRows = useMemo<PortfolioRow[]>(() => {
    const normalized = defaultRows
      .map((row) => ({
        period_month: String(row.period_month ?? row.billing_month ?? "").slice(
          0,
          7,
        ),
        price_area_code: String(
          row.price_area_code ?? row.price_area ?? "ALL",
        ).toUpperCase() as PortfolioRow["price_area_code"],
        amount_ore_per_kwh: String(row.amount_ore_per_kwh ?? row.amount ?? ""),
      }))
      .filter((row) => row.period_month && row.amount_ore_per_kwh);
    return normalized.length
      ? normalized
      : [
          {
            period_month: nextMonth(),
            price_area_code: "ALL",
            amount_ore_per_kwh: "",
          },
        ];
  }, [defaultRows]);
  const [rows, setRows] = useState(initialRows);
  const [unit, setUnit] = useState(defaultManagementFeeUnit);

  const serialized = JSON.stringify(
    rows
      .filter((row) => row.period_month && row.amount_ore_per_kwh)
      .map((row) => ({
        period_month: row.period_month,
        price_area_code: row.price_area_code,
        amount_ore_per_kwh: row.amount_ore_per_kwh,
      })),
  );

  return (
    <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-5">
      <h3 className="text-sm font-black text-indigo-950">
        Canonical portföljprissättning
      </h3>
      <p className="mt-1 text-xs leading-5 text-indigo-900">
        Portföljandel, förvaltningsavgift och månadens portföljpris är separata
        uppgifter. Samma låsta prisversion används i offert, kalkyl, avtal och
        fakturering.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-semibold text-slate-700">
          Rörlig andel %
          <input
            name="spot_weight_percent"
            defaultValue={defaultSpotWeight}
            inputMode="decimal"
            className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3"
          />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Portföljandel %
          <input
            name="portfolio_weight_percent"
            defaultValue={defaultPortfolioWeight}
            inputMode="decimal"
            className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3"
          />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Fast andel %
          <input
            name="fixed_weight_percent"
            defaultValue={defaultFixedWeight}
            inputMode="decimal"
            className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1.4fr]">
        <label className="text-xs font-semibold text-slate-700">
          Portföljförvaltningsavgift
          <input
            name="portfolio_management_fee_amount"
            defaultValue={defaultManagementFeeAmount}
            inputMode="decimal"
            className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3"
          />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Enhet
          <select
            name="portfolio_management_fee_unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3"
          >
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
          <select
            name="portfolio_management_fee_calculation_base"
            defaultValue={defaultManagementFeeCalculationBase}
            disabled={unit !== "percent"}
            className="mt-2 w-full rounded-xl border border-indigo-200 bg-white px-4 py-3 disabled:bg-slate-100"
          >
            {PRICING_CALCULATION_BASES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-white px-4 py-3 text-xs font-semibold text-slate-700">
        <span>Visa förvaltningsavgiften på hemsidans avtalskort</span>
        <input
          type="checkbox"
          name="show_portfolio_management_fee_on_website"
          defaultChecked={defaultManagementFeeVisible}
        />
      </label>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-black text-slate-950">
            Portföljpris per månad och elområde
          </h4>
          <p className="text-xs text-slate-600">
            Gemensamt pris expanderas till avtalets valda SE1–SE4 i den låsta
            versionen.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                period_month: nextMonth(),
                price_area_code: "ALL",
                amount_ore_per_kwh: "",
              },
            ])
          }
          className="rounded-xl border border-indigo-300 bg-white px-3 py-2 text-xs font-black text-indigo-800"
        >
          Lägg till månad
        </button>
      </div>
      <input type="hidden" name="portfolio_monthly_prices" value={serialized} />
      <div className="mt-3 grid gap-2">
        {rows.map((row, index) => (
          <div
            key={`${index}-${row.period_month}-${row.price_area_code}`}
            className="grid gap-2 rounded-2xl border border-indigo-200 bg-white p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <input
              type="month"
              value={row.period_month}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, period_month: event.target.value }
                      : item,
                  ),
                )
              }
              className="rounded-xl border border-slate-300 px-3 py-2"
            />
            <select
              value={row.price_area_code}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          price_area_code: event.target
                            .value as PortfolioRow["price_area_code"],
                        }
                      : item,
                  ),
                )
              }
              className="rounded-xl border border-slate-300 px-3 py-2"
            >
              <option value="ALL">Gemensamt SE1–SE4</option>
              <option value="SE1">SE1</option>
              <option value="SE2">SE2</option>
              <option value="SE3">SE3</option>
              <option value="SE4">SE4</option>
            </select>
            <input
              value={row.amount_ore_per_kwh}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, amount_ore_per_kwh: event.target.value }
                      : item,
                  ),
                )
              }
              inputMode="decimal"
              placeholder="öre/kWh exkl. moms"
              className="rounded-xl border border-slate-300 px-3 py-2"
            />
            <button
              type="button"
              onClick={() =>
                setRows((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
              className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-black text-rose-700"
            >
              Ta bort
            </button>
          </div>
        ))}
      </div>
      <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-white px-4 py-3 text-xs font-semibold text-slate-700">
        <span>Visa aktuellt portföljpris på hemsidans avtalskort</span>
        <input
          type="checkbox"
          name="show_portfolio_price_on_website"
          defaultChecked={defaultPortfolioPriceVisible}
        />
      </label>
    </section>
  );
}
