import type {
  BillingUnderlayInput,
  PriceComponent,
  PricingPreviewLine,
} from "@/lib/pricing/types";
import {
  displayPricingUnit,
  normalizePricingUnitForComponent,
  sekPerKwhFromComponent,
} from "@/lib/pricing/unitConversion";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function daysBetween(start: string, end: string): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs)
    return 0;
  return Math.ceil((endMs - startMs) / 86_400_000);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Supplied calendar days of a billed segment over the days of its calendar month (FINDINGS H3d B4, owner decisions
 * 19 and 20, 2026-10-23: the fixed retail monthly fee of a month in which supply starts or ends is spread per day of
 * supply and stops at the actual supply end; nothing is charged for a notice period after supply ended).
 *
 * "Calendar day" (documented choice): a day of the Swedish calendar month the underlay belongs to
 * (underlay_year/underlay_month), counted as whole dates and never as hours, so a 23- or 25-hour DST day is one day.
 *   * monthDays    = the number of dates of that calendar month (28/29/30/31).
 *   * suppliedDays = billing_period_end - billing_period_start in whole dates. The underlay store writes both as the
 *     Stockholm civil dates of the segment's instants (gridex_store_billing_underlay), and the segment is the supply
 *     window the billing engine computed (supplyPeriodBillingSegment in lib/billing/underlayEngine.ts, built on
 *     supplyPeriodStartInstant/supplyPeriodEndInstant in lib/billing/supplyPeriodEnd.ts). billing_period_end is
 *     therefore the first date that is no longer supplied: a manual move-out on the 15th (last supplied day) ends at
 *     civil midnight -> the 16th; a Z05 end "1 November 00:00" (Ediel fixed normal time, exclusive) -> 1 November;
 *     an Ediel month (00:00 +0100 on the 1st, owner decision 8) starts on the 1st at 00:00 in winter and 01:00 in
 *     summer, i.e. on the date of the 1st, so a full Ediel month counts every date of its calendar month.
 *   A day on which supply starts or ends during the day (market instant inside the day) counts as a supplied day.
 * Returns null when the segment or month is not known (callers other than the monthly billing run), and then the fee
 * keeps its previous full-period behaviour.
 */
export function suppliedCalendarDays(
  underlay: Pick<BillingUnderlayInput, "periodStart" | "periodEnd" | "billingMonth">,
): { suppliedDays: number; monthDays: number } | null {
  const month = /^(\d{4})-(\d{2})$/.exec(underlay.billingMonth ?? "");
  const start = ISO_DATE.exec(String(underlay.periodStart ?? "").slice(0, 10));
  const end = ISO_DATE.exec(String(underlay.periodEnd ?? "").slice(0, 10));
  if (!month || !start || !end) return null;
  const year = Number(month[1]);
  const monthIndex = Number(month[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  const monthDays = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const startMs = Date.UTC(Number(start[1]), Number(start[2]) - 1, Number(start[3]));
  const endMs = Date.UTC(Number(end[1]), Number(end[2]) - 1, Number(end[3]));
  const monthStartMs = Date.UTC(year, monthIndex, 1);
  const monthEndMs = Date.UTC(year, monthIndex + 1, 1);
  const from = Math.max(startMs, monthStartMs);
  const to = Math.min(endMs, monthEndMs);
  const suppliedDays = to > from ? Math.round((to - from) / 86_400_000) : 0;
  return { suppliedDays, monthDays };
}

function periodizationFactor(
  underlay: BillingUnderlayInput,
  component: PriceComponent,
): number {
  if (
    component.periodizationMode !== "active_days" &&
    component.periodizationMode !== "prorated_by_days"
  )
    return 1;
  // Over the days of the calendar month when the month is known (H3d B4), otherwise over the segment itself.
  const totalDays = Math.max(
    suppliedCalendarDays(underlay)?.monthDays ??
      daysBetween(underlay.periodStart, underlay.periodEnd),
    1,
  );
  const activeStart =
    underlay.activeFrom && underlay.activeFrom > underlay.periodStart
      ? underlay.activeFrom
      : underlay.periodStart;
  const activeEnd =
    underlay.activeTo && underlay.activeTo < underlay.periodEnd
      ? underlay.activeTo
      : underlay.periodEnd;
  const activeDays = Math.min(
    Math.max(daysBetween(activeStart, activeEnd), 0),
    totalDays,
  );
  return activeDays / totalDays;
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataBoolean(
  metadata: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return metadata?.[key] === true;
}

function explicitMonthlyProrationEnabled(component: PriceComponent): boolean {
  // A monthly fee is a full-period customer fee by default. Legacy rows can contain
  // periodization_mode = prorated_by_days/active_days even when the business rule is
  // still full month. Only prorate when the price component explicitly carries a
  // proration policy in metadata, so normal monthly fees never become quantity 0.
  if (component.periodizationMode !== "prorated_by_days") return false;

  const policy =
    metadataString(component.metadata, "billing_policy") ??
    metadataString(component.metadata, "proration_policy") ??
    metadataString(component.metadata, "monthly_fee_policy");

  return (
    policy === "prorated_by_days" ||
    metadataBoolean(component.metadata, "proration_enabled") ||
    metadataBoolean(component.metadata, "explicit_proration")
  );
}

function fixedMonthlyQuantity(
  underlay: BillingUnderlayInput,
  component: PriceComponent,
): number {
  if (!explicitMonthlyProrationEnabled(component)) {
    // H3d B4 / owner decision 20: supplied calendar days / days of the calendar month (1 for a fully supplied month).
    const days = suppliedCalendarDays(underlay);
    if (!days) return 1;
    return Math.min(days.suppliedDays / days.monthDays, 1);
  }
  // An explicit proration policy additionally limits the fee to the contract's active window (unchanged rule),
  // over the days of the calendar month when it is known.
  return Math.max(periodizationFactor(underlay, component), 0);
}

/**
 * Fees that are never part of the regular monthly billing run (owner decision 20, 2026-10-23): a break fee
 * (brytavgift, component 'break_fee', event 'early_termination') and every other event-only charge. They are handled
 * through the operator's fee review (customer_operation_tasks 'break_fee_review') as a separate underlay or invoice;
 * the monthly run never adds them, whatever the underlay payload or the pricing snapshot's events say.
 */
export function isOutsideRegularMonthlyBilling(component: PriceComponent): boolean {
  const metadata = component.metadata;
  const lifecycle = component.lifecycle ?? metadataString(metadata, "lifecycle");
  return (
    component.componentType === "break_fee" ||
    component.componentCode === "break_fee" ||
    metadataString(metadata, "component_key") === "break_fee" ||
    metadataString(metadata, "component_code") === "break_fee" ||
    metadataString(metadata, "event") === "early_termination" ||
    lifecycle === "event_only" ||
    component.unit === "sek_event" ||
    component.calculationType === "event_only"
  );
}

function isPercentOfSpot(component: PriceComponent): boolean {
  const raw =
    `${component.calculationType ?? ""} ${component.unit ?? ""}`.toLowerCase();
  return raw.includes("percent_of_spot");
}

function normalizedCalculationType(component: PriceComponent): string {
  if (isPercentOfSpot(component)) return "percent_of_spot";

  const unit = normalizePricingUnitForComponent({
    unit: component.unit,
    calculationType: component.calculationType,
    componentType: component.componentType,
  });

  if (component.calculationType === "discount_per_kwh")
    return "discount_per_kwh";
  if (component.calculationType === "discount_fixed") return "discount_fixed";
  if (component.calculationType === "rounding") return "rounding";
  if (unit === "ore_per_kwh" || unit === "sek_per_kwh") return "per_kwh";
  if (unit === "sek_month" || component.unit === "sek_site_month")
    return "fixed_monthly";
  if (component.unit === "sek_year") return "fixed_once";
  if (component.unit === "sek_event") return "event_only";
  if (unit === "sek_invoice" || unit === "sek_once") return "fixed_once";
  if (unit === "percentage") return "percentage";
  return component.calculationType;
}

export function calculatePriceComponents(input: {
  underlay: BillingUnderlayInput;
  components: PriceComponent[];
  baseAmountExVat: number;
  /**
   * The spot-sourced portion of the base amount (SEK ex VAT). Required for
   * percent_of_spot components; when null/undefined those components are
   * blocked with an explicit error instead of being silently skipped.
   */
  spotAmountExVat?: number | null;
  portfolioAmountExVat?: number | null;
  vatRate: number;
  startSortOrder?: number;
}): { lines: PricingPreviewLine[]; warnings: string[]; errors: string[] } {
  const lines: PricingPreviewLine[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const quantityKwh = input.underlay.quantityKwh;
  let sortOrder = input.startSortOrder ?? 100;
  let runningSubtotalExVat = input.baseAmountExVat;
  let monthlyFixedAmountExVat = 0;

  const activeComponents = [...input.components].sort(
    (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
  );
  for (const component of activeComponents) {
    if (
      component.calculationInclusion === "excluded" ||
      component.selected === false ||
      component.eligible === false
    ) {
      continue;
    }
    if (
      component.lifecycle === "per_invoice" &&
      input.underlay.invoiceCreated === false
    ) {
      continue;
    }
    if (
      component.lifecycle === "once_per_contract" &&
      input.underlay.isFirstContractPeriod === false
    ) {
      continue;
    }
    if (
      component.lifecycle === "once_per_site" &&
      input.underlay.isFirstSitePeriod === false
    ) {
      continue;
    }
    if (
      component.lifecycle === "annual" &&
      input.underlay.annualChargeDue === false
    ) {
      continue;
    }
    if (
      component.lifecycle === "event_only" &&
      (!input.underlay.contractEvent ||
        input.underlay.contractEvent !==
          metadataString(component.metadata, "event"))
    ) {
      continue;
    }
    const type = normalizedCalculationType(component);
    let quantity: number | null = 1;
    let unit = component.unit ?? "st";
    let unitPriceExVat: number | null = component.amount;
    let amountExVat = 0;
    let fixedFeeProration: Record<string, unknown> | null = null;

    if (type === "per_kwh" || type === "per_kwh_ore") {
      if (quantityKwh === null || !Number.isFinite(quantityKwh)) {
        errors.push(`${component.name} kräver kWh för perioden.`);
        continue;
      }
      quantity = quantityKwh;
      unit = "kWh";
      const sekPerKwh =
        type === "per_kwh_ore"
          ? component.amount / 100
          : sekPerKwhFromComponent(component);
      unitPriceExVat = sekPerKwh;
      amountExVat = quantityKwh * sekPerKwh;
      unit = "kWh";
    } else if (type === "fixed_monthly") {
      // Fixed monthly fees are charged once per billing period by default. The unit
      // conversion layer may normalize legacy `sek` rows to `sek_month`, but the
      // monetary rule is still: one monthly charge per invoice period.
      const siteMultiplier =
        component.unit === "sek_site_month"
          ? Math.max(input.underlay.siteCount ?? 1, 1)
          : 1;
      const monthlyQuantity =
        fixedMonthlyQuantity(input.underlay, component) * siteMultiplier;
      quantity = monthlyQuantity;
      const days = suppliedCalendarDays(input.underlay);
      if (days && days.suppliedDays < days.monthDays) {
        fixedFeeProration = {
          rule: "supplied_calendar_days_of_month",
          supplied_days: days.suppliedDays,
          month_days: days.monthDays,
          billing_month: input.underlay.billingMonth ?? null,
          segment_start_date: input.underlay.periodStart,
          segment_end_date_exclusive: input.underlay.periodEnd,
        };
      }
      unit =
        component.unit === "sek_site_month"
          ? "anläggningsmånad"
          : "månad";
      unitPriceExVat = component.amount;
      amountExVat = component.amount * monthlyQuantity;
    } else if (type === "fixed_once" || type === "event_only") {
      const siteMultiplier =
        component.lifecycle === "once_per_site"
          ? Math.max(input.underlay.siteCount ?? 1, 1)
          : 1;
      quantity = siteMultiplier;
      amountExVat = component.amount * siteMultiplier;
      unit =
        component.lifecycle === "once_per_site" ? "anläggning" : "st";
    } else if (type === "percentage") {
      const calculationBase =
        component.calculationBase ??
        metadataString(component.metadata, "calculation_base") ??
        "energy_cost_ex_vat";
      let baseValue: number | null;
      if (calculationBase === "spot_cost") {
        baseValue = input.spotAmountExVat ?? null;
      } else if (calculationBase === "portfolio_cost") {
        baseValue = input.portfolioAmountExVat ?? null;
      } else if (calculationBase === "energy_cost_inc_vat") {
        baseValue = input.baseAmountExVat * (1 + input.vatRate);
      } else if (calculationBase === "total_variable_cost") {
        baseValue = runningSubtotalExVat - monthlyFixedAmountExVat;
      } else if (calculationBase === "invoice_subtotal") {
        baseValue = runningSubtotalExVat;
      } else if (calculationBase === "monthly_fixed_amount") {
        baseValue = monthlyFixedAmountExVat;
      } else {
        baseValue = input.baseAmountExVat;
      }
      if (baseValue === null || !Number.isFinite(baseValue)) {
        errors.push(
          `${component.name}: beräkningsbasen ${calculationBase} saknas för perioden.`,
        );
        continue;
      }
      amountExVat = baseValue * (component.amount / 100);
      unit = "%";
      quantity = component.amount;
      unitPriceExVat = baseValue;
    } else if (type === "percent_of_spot") {
      const spotAmount = input.spotAmountExVat;
      if (
        spotAmount === null ||
        spotAmount === undefined ||
        !Number.isFinite(spotAmount)
      ) {
        errors.push(
          `${component.name}: procent av spot kräver spotprisbas för perioden och elområdet.`,
        );
        continue;
      }
      amountExVat = spotAmount * (component.amount / 100);
      unit = "% av spot";
    } else if (type === "discount_per_kwh") {
      if (quantityKwh === null || !Number.isFinite(quantityKwh)) {
        errors.push(`${component.name} kräver kWh för perioden.`);
        continue;
      }
      quantity = quantityKwh;
      unit = "kWh";
      const sekPerKwh = Math.abs(sekPerKwhFromComponent(component));
      unitPriceExVat = -sekPerKwh;
      amountExVat = quantityKwh * unitPriceExVat;
    } else if (type === "discount_fixed") {
      unitPriceExVat = -Math.abs(component.amount);
      amountExVat = unitPriceExVat;
    } else if (type === "rounding") {
      const roundedBase = Math.round(input.baseAmountExVat);
      amountExVat = roundedBase - input.baseAmountExVat;
      unitPriceExVat = amountExVat;
    } else {
      warnings.push(
        `Okänd beräkningstyp för ${component.name}: ${component.calculationType}`,
      );
      continue;
    }

    if (
      [
        "discount_ore_per_kwh",
        "discount_fixed_amount",
        "campaign_discount",
      ].includes(component.componentType) &&
      amountExVat > 0
    ) {
      amountExVat = -Math.abs(amountExVat);
      if (unitPriceExVat !== null) unitPriceExVat = -Math.abs(unitPriceExVat);
    }

    const vatRate = component.vatApplicable === false ? 0 : input.vatRate;
    const roundedExVat = roundMoney(amountExVat);
    const vatAmount = roundMoney(roundedExVat * vatRate);
    runningSubtotalExVat += roundedExVat;
    if (type === "fixed_monthly") monthlyFixedAmountExVat += roundedExVat;
    lines.push({
      lineType: component.componentType,
      description: component.name,
      quantity,
      unit,
      unitPriceExVat,
      amountExVat: roundedExVat,
      vatRate,
      vatAmount,
      amountIncVat: roundMoney(roundedExVat + vatAmount),
      sortOrder,
      metadata: {
        ...(component.metadata ?? {}),
        component_reference: component.componentReference ?? null,
        component_code: component.componentCode ?? null,
        component_type: component.componentType,
        calculation_type: component.calculationType,
        calculation_base:
          component.calculationBase ??
          metadataString(component.metadata, "calculation_base"),
        input_amount: component.amount,
        input_unit: component.unit ?? component.calculationType ?? null,
        normalized_pricing_unit: normalizePricingUnitForComponent({
          unit: component.unit,
          calculationType: component.calculationType,
          componentType: component.componentType,
        }),
        display_pricing_unit: displayPricingUnit(
          normalizePricingUnitForComponent({
            unit: component.unit,
            calculationType: component.calculationType,
            componentType: component.componentType,
          }),
        ),
        vat_rate_explicit: true,
        selection_policy: component.selectionPolicy ?? null,
        calculation_inclusion:
          component.calculationInclusion ?? "included",
        selected: component.selected ?? true,
        selection_source: component.selectionSource ?? null,
        // Ineligible components are filtered above and can never become rows.
        eligibility: "eligible",
        lifecycle:
          component.lifecycle ??
          metadataString(component.metadata, "lifecycle"),
        periodization_rule: component.periodizationRule ?? null,
        invoice_delivery_method:
          component.invoiceDeliveryMethod ?? null,
        ...(fixedFeeProration ? { fixed_fee_proration: fixedFeeProration } : {}),
      },
    });
    sortOrder += 10;
  }

  return { lines, warnings, errors };
}
