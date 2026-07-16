export type ContractPricingModel =
  | "spot"
  | "variable_monthly"
  | "variable_hourly"
  | "variable_quarterly"
  | "fixed"
  | "portfolio"
  | "mixed";
export type ContractCustomerType = "private" | "business" | "both";

export type ContractPricingInput = {
  name: string;
  contractType: ContractPricingModel;
  customerType: ContractCustomerType;
  monthlyFeeSek?: unknown;
  invoiceFeeSek?: unknown;
  markupOrePerKwh?: unknown;
  spotMarkupOrePerKwh?: unknown;
  variableFeeOrePerKwh?: unknown;
  fixedPriceOrePerKwh?: unknown;
  fixedPricesByArea?: unknown;
  greenFeeMode?: unknown;
  greenFeeValue?: unknown;
  electricityCertificateOrePerKwh?: unknown;
  startFeeSek?: unknown;
  administrationFeeSek?: unknown;
  breakFeeSek?: unknown;
  portfolioManagementFeeOrePerKwh?: unknown;
  discountValue?: unknown;
  discountUnit?: unknown;
  discountMonths?: unknown;
  vatRate?: unknown;
  spotWeightPercent?: unknown;
  portfolioWeightPercent?: unknown;
  fixedWeightPercent?: unknown;
  spotIntervalResolution?: unknown;
  priceAreas?: unknown;
  validFrom?: string | null;
  validTo?: string | null;
  bindingMonths?: unknown;
  noticeMonths?: unknown;
  automaticRenewal?: boolean;
  powerOfAttorneyRequired?: boolean;
  optionalFeeLines?: unknown;
};

type PricingComponent = {
  component_code: string;
  component_type: string;
  name: string;
  amount: number;
  calculation_type: string;
  unit: string;
  vat_applicable: boolean;
  invoice_line_visible: boolean;
  priority: number;
  metadata?: Record<string, unknown>;
};

type BasePriceComponent = {
  source_type: "spot" | "fixed" | "portfolio" | "manual";
  label: string;
  weight_percent: number;
  fixed_price_sek_per_kwh: number | null;
  price_area: string | null;
  metadata?: Record<string, unknown>;
};

export type NormalizedContractPricing = {
  planName: string;
  pricingModel: "spot" | "fixed" | "portfolio" | "mixed";
  contractType: ContractPricingModel;
  customerType: ContractCustomerType;
  publicPriceText: string;
  snapshot: {
    schema_version: 2;
    contract_type: ContractPricingModel;
    customer_type: ContractCustomerType;
    price_areas: string[];
    valid_from: string | null;
    valid_to: string | null;
    binding_months: number | null;
    notice_months: number | null;
    automatic_renewal: boolean;
    power_of_attorney_required: boolean;
    base_components: BasePriceComponent[];
    price_components: PricingComponent[];
    public_price_text: string;
    vat_rate: number;
    vat_rate_percent: number;
    interval_resolution:
      "monthly" | "hourly" | "quarterly" | "fixed" | "portfolio" | "mixed";
  };
};

function optionalNumber(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number | null {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(parsed))
    throw new Error(`${label} måste vara ett giltigt tal.`);
  if (options.integer && !Number.isInteger(parsed))
    throw new Error(`${label} måste vara ett heltal.`);
  if (options.min !== undefined && parsed < options.min)
    throw new Error(`${label} får inte vara lägre än ${options.min}.`);
  if (options.max !== undefined && parsed > options.max)
    throw new Error(`${label} får inte vara högre än ${options.max}.`);
  return parsed;
}

function parsePriceAreas(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map(String)
    : String(value ?? "").split(/[\s,;]+/);
  const normalized = Array.from(
    new Set(raw.map((item) => item.trim().toUpperCase()).filter(Boolean)),
  );
  const invalid = normalized.filter(
    (item) => !["SE1", "SE2", "SE3", "SE4"].includes(item),
  );
  if (invalid.length > 0)
    throw new Error(`Ogiltigt prisområde: ${invalid.join(", ")}.`);
  return normalized;
}

function parseFixedPricesByArea(
  value: unknown,
): Partial<Record<"SE1" | "SE2" | "SE3" | "SE4", number>> {
  if (value === null || value === undefined || String(value).trim() === "")
    return {};
  let candidate: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{")) {
      try {
        candidate = JSON.parse(trimmed);
      } catch {
        throw new Error(
          "Fastpris per prisområde måste vara giltig JSON eller rader som SE1|99,50.",
        );
      }
    } else {
      candidate = Object.fromEntries(
        trimmed
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const [area, amount] = line.split("|").map((part) => part.trim());
            return [area?.toUpperCase(), amount];
          }),
      );
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    throw new Error("Fastpris per prisområde måste anges som ett objekt.");
  const result: Partial<Record<"SE1" | "SE2" | "SE3" | "SE4", number>> = {};
  for (const [rawArea, rawAmount] of Object.entries(
    candidate as Record<string, unknown>,
  )) {
    const area = rawArea.toUpperCase();
    if (!["SE1", "SE2", "SE3", "SE4"].includes(area))
      throw new Error(`Ogiltigt prisområde för fastpris: ${rawArea}.`);
    const amount = optionalNumber(rawAmount, `Fast pris ${area}`, { min: 0 });
    if (amount === null || amount <= 0)
      throw new Error(`Fast pris ${area} måste vara över 0 öre/kWh.`);
    result[area as keyof typeof result] = amount;
  }
  return result;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 4 }).format(
    value,
  );
}

function addComponent(
  target: PricingComponent[],
  input: Omit<PricingComponent, "vat_applicable" | "invoice_line_visible"> & {
    vat_applicable?: boolean;
    invoice_line_visible?: boolean;
  },
) {
  target.push({
    ...input,
    vat_applicable: input.vat_applicable ?? true,
    invoice_line_visible: input.invoice_line_visible ?? true,
    metadata: {
      component_key: input.component_code,
      ...(input.metadata ?? {}),
    },
  });
}

function parseOptionalFeeLines(value: unknown): PricingComponent[] {
  const rows = String(value ?? "").trim();
  if (!rows) return [];
  return rows.split(/\r?\n/).map((line, index) => {
    const [nameRaw, amountRaw, unitRaw] = line
      .split("|")
      .map((part) => part.trim());
    if (!nameRaw)
      throw new Error(`Övrig avgift på rad ${index + 1} saknar namn.`);
    const amount = optionalNumber(
      amountRaw,
      `Övrig avgift på rad ${index + 1}`,
      { min: 0 },
    );
    if (amount === null)
      throw new Error(`Övrig avgift på rad ${index + 1} saknar belopp.`);
    const unit = unitRaw || "sek_once";
    const allowedUnits = new Set([
      "sek_once",
      "sek_contract",
      "sek_invoice",
      "sek_month",
      "ore_per_kwh",
    ]);
    if (!allowedUnits.has(unit))
      throw new Error(`Övrig avgift på rad ${index + 1} har en ogiltig enhet.`);
    const lifecycle =
      unit === "sek_invoice"
        ? "per_invoice"
        : unit === "sek_once" || unit === "sek_contract"
          ? "once_per_contract"
          : "recurring";
    return {
      component_code: `optional_${index + 1}`,
      component_type: "optional_fee",
      name: nameRaw,
      amount,
      calculation_type: unit.includes("kwh")
        ? "per_kwh"
        : unit.includes("month")
          ? "per_month"
          : unit === "sek_invoice"
            ? "per_invoice"
            : "fixed_once",
      unit,
      vat_applicable: true,
      invoice_line_visible: true,
      priority: 900 + index,
      metadata: { lifecycle, component_key: `optional_${index + 1}` },
    };
  });
}

export function normalizeContractPricing(
  input: ContractPricingInput,
): NormalizedContractPricing {
  const planName = input.name.trim();
  if (!planName) throw new Error("Avtalsnamn krävs.");

  const monthlyFeeSek = optionalNumber(input.monthlyFeeSek, "Månadsavgift", {
    min: 0,
  });
  const invoiceFeeSek = optionalNumber(input.invoiceFeeSek, "Fakturaavgift", {
    min: 0,
  });
  const markupOrePerKwh = optionalNumber(
    input.markupOrePerKwh,
    "Generellt påslag",
    { min: 0 },
  );
  const spotMarkupOrePerKwh = optionalNumber(
    input.spotMarkupOrePerKwh,
    "Spotpåslag",
    { min: 0 },
  );
  const variableFeeOrePerKwh = optionalNumber(
    input.variableFeeOrePerKwh,
    "Rörlig avgift",
    { min: 0 },
  );
  const fixedPricesByArea = parseFixedPricesByArea(input.fixedPricesByArea);
  const fixedPriceOrePerKwh = optionalNumber(
    input.fixedPriceOrePerKwh,
    "Fast pris",
    { min: 0 },
  );
  const greenFeeValue = optionalNumber(input.greenFeeValue, "Grön el-avgift", {
    min: 0,
  });
  const electricityCertificateOrePerKwh = optionalNumber(
    input.electricityCertificateOrePerKwh,
    "Elcertifikat",
    { min: 0 },
  );
  const startFeeSek = optionalNumber(input.startFeeSek, "Startavgift", {
    min: 0,
  });
  const administrationFeeSek = optionalNumber(
    input.administrationFeeSek,
    "Administrativ avgift",
    { min: 0 },
  );
  const breakFeeSek = optionalNumber(input.breakFeeSek, "Brytavgift", {
    min: 0,
  });
  const portfolioManagementFeeOrePerKwh = optionalNumber(
    input.portfolioManagementFeeOrePerKwh,
    "Portföljförvaltningsavgift",
    { min: 0 },
  );
  const discountValue = optionalNumber(input.discountValue, "Rabatt", {
    min: 0,
  });
  const discountMonths = optionalNumber(input.discountMonths, "Rabattperiod", {
    min: 1,
    integer: true,
  });
  const vatRate =
    optionalNumber(input.vatRate, "Moms", { min: 0, max: 100 }) ?? 25;
  const bindingMonths = optionalNumber(input.bindingMonths, "Bindningstid", {
    min: 0,
    integer: true,
  });
  const noticeMonths = optionalNumber(input.noticeMonths, "Uppsägningstid", {
    min: 0,
    integer: true,
  });

  const requestedSpotIntervalResolution = String(
    input.spotIntervalResolution ?? "monthly",
  ).trim();
  if (
    !["monthly", "hourly", "quarterly"].includes(
      requestedSpotIntervalResolution,
    )
  )
    throw new Error(
      "Spotandelens intervall måste vara monthly, hourly eller quarterly.",
    );

  const defaultWeights =
    input.contractType === "mixed"
      ? { spot: 50, portfolio: 50, fixed: 0 }
      : input.contractType === "portfolio"
        ? { spot: 0, portfolio: 100, fixed: 0 }
        : input.contractType === "fixed"
          ? { spot: 0, portfolio: 0, fixed: 100 }
          : { spot: 100, portfolio: 0, fixed: 0 };

  const spotWeight =
    optionalNumber(input.spotWeightPercent, "Rörlig andel", {
      min: 0,
      max: 100,
    }) ?? defaultWeights.spot;
  const portfolioWeight =
    optionalNumber(input.portfolioWeightPercent, "Portföljandel", {
      min: 0,
      max: 100,
    }) ?? defaultWeights.portfolio;
  const fixedWeight =
    optionalNumber(input.fixedWeightPercent, "Fast andel", {
      min: 0,
      max: 100,
    }) ?? defaultWeights.fixed;
  const weightSum =
    Math.round((spotWeight + portfolioWeight + fixedWeight) * 1_000_000) /
    1_000_000;

  if (["mixed", "portfolio"].includes(input.contractType) && weightSum !== 100)
    throw new Error("Prisandelarna måste tillsammans bli exakt 100 procent.");
  const hasAreaFixedPrices = Object.keys(fixedPricesByArea).length > 0;
  if (
    input.contractType === "fixed" &&
    (fixedPriceOrePerKwh === null || fixedPriceOrePerKwh <= 0) &&
    !hasAreaFixedPrices
  )
    throw new Error(
      "Fastprisavtal kräver ett generellt fastpris eller pris per prisområde.",
    );
  if (
    input.contractType === "mixed" &&
    fixedWeight > 0 &&
    (fixedPriceOrePerKwh === null || fixedPriceOrePerKwh <= 0) &&
    !hasAreaFixedPrices
  )
    throw new Error(
      "Mixavtal med fast andel kräver ett generellt fastpris eller pris per prisområde.",
    );
  if (input.contractType === "portfolio" && portfolioWeight <= 0)
    throw new Error("Portföljavtal måste ha en portföljandel över 0 procent.");
  if (input.validFrom && input.validTo && input.validTo < input.validFrom)
    throw new Error("Slutdatum får inte ligga före startdatum.");
  if (discountValue !== null && discountMonths === null)
    throw new Error("Rabatt kräver en angiven rabattperiod i månader.");

  const priceAreas = parsePriceAreas(input.priceAreas);
  for (const area of Object.keys(fixedPricesByArea)) {
    if (!priceAreas.includes(area))
      throw new Error(
        `Fastpris har angetts för ${area}, men området finns inte i avtalets prisområden.`,
      );
  }
  if (
    (input.contractType === "fixed" ||
      (input.contractType === "mixed" && fixedWeight > 0)) &&
    fixedPriceOrePerKwh === null
  ) {
    const missingAreas = priceAreas.filter(
      (area) =>
        fixedPricesByArea[area as keyof typeof fixedPricesByArea] === undefined,
    );
    if (missingAreas.length > 0)
      throw new Error(
        `Fastpris saknas för prisområde: ${missingAreas.join(", ")}.`,
      );
  }
  const componentAreas = priceAreas.length > 0 ? priceAreas : [null];
  const baseComponents: BasePriceComponent[] = [];
  for (const priceArea of componentAreas) {
    if (spotWeight > 0)
      baseComponents.push({
        source_type: "spot",
        label: "Spotpris",
        weight_percent: spotWeight,
        fixed_price_sek_per_kwh: null,
        price_area: priceArea,
      });
    if (portfolioWeight > 0)
      baseComponents.push({
        source_type: "portfolio",
        label: "Portföljpris",
        weight_percent: portfolioWeight,
        fixed_price_sek_per_kwh: null,
        price_area: priceArea,
      });
    if (fixedWeight > 0 || input.contractType === "fixed")
      baseComponents.push({
        source_type: "fixed",
        label: "Fast pris",
        weight_percent: fixedWeight || 100,
        fixed_price_sek_per_kwh: (() => {
          const areaPrice = priceArea
            ? fixedPricesByArea[priceArea as keyof typeof fixedPricesByArea]
            : undefined;
          const ore = areaPrice ?? fixedPriceOrePerKwh;
          return ore === null || ore === undefined
            ? null
            : Math.round((ore / 100) * 100_000_000) / 100_000_000;
        })(),
        price_area: priceArea,
      });
  }

  const components: PricingComponent[] = [];
  if (monthlyFeeSek !== null)
    addComponent(components, {
      component_code: "monthly_fee",
      component_type: "monthly_fee",
      name: "Månadsavgift",
      amount: monthlyFeeSek,
      calculation_type: "per_month",
      unit: "sek_month",
      priority: 100,
    });
  if (invoiceFeeSek !== null)
    addComponent(components, {
      component_code: "invoice_fee",
      component_type: "invoice_fee",
      name: "Fakturaavgift",
      amount: invoiceFeeSek,
      calculation_type: "per_invoice",
      unit: "sek_invoice",
      priority: 110,
    });
  const effectiveSpotMarkupOrePerKwh = spotMarkupOrePerKwh ?? markupOrePerKwh;
  if (effectiveSpotMarkupOrePerKwh !== null)
    addComponent(components, {
      component_code: "spot_markup",
      component_type: "spot_markup",
      name: "Spotpåslag",
      amount: effectiveSpotMarkupOrePerKwh,
      calculation_type: "per_kwh",
      unit: "ore_per_kwh",
      priority: 130,
      metadata: { replaces_legacy_markup: true },
    });
  if (variableFeeOrePerKwh !== null)
    addComponent(components, {
      component_code: "variable_fee",
      component_type: "variable_fee",
      name: "Rörlig avgift",
      amount: variableFeeOrePerKwh,
      calculation_type: "per_kwh",
      unit: "ore_per_kwh",
      priority: 140,
    });
  if (greenFeeValue !== null)
    addComponent(components, {
      component_code: "green_energy_fee",
      component_type: "green_energy_fee",
      name: "Grön el-avgift",
      amount: greenFeeValue,
      calculation_type:
        String(input.greenFeeMode) === "sek_month" ? "per_month" : "per_kwh",
      unit:
        String(input.greenFeeMode) === "sek_month"
          ? "sek_month"
          : "ore_per_kwh",
      priority: 150,
    });
  if (electricityCertificateOrePerKwh !== null)
    addComponent(components, {
      component_code: "electricity_certificate",
      component_type: "electricity_certificate",
      name: "Elcertifikat",
      amount: electricityCertificateOrePerKwh,
      calculation_type: "per_kwh",
      unit: "ore_per_kwh",
      priority: 160,
    });
  if (startFeeSek !== null)
    addComponent(components, {
      component_code: "start_fee",
      component_type: "start_fee",
      name: "Startavgift",
      amount: startFeeSek,
      calculation_type: "fixed_once",
      unit: "sek_contract",
      priority: 170,
      metadata: { lifecycle: "once_per_contract", event: "contract_started" },
    });
  if (administrationFeeSek !== null)
    addComponent(components, {
      component_code: "administration_fee",
      component_type: "administration_fee",
      name: "Administrativ avgift",
      amount: administrationFeeSek,
      calculation_type: "fixed_once",
      unit: "sek_contract",
      priority: 180,
      metadata: { lifecycle: "once_per_contract", event: "contract_started" },
    });
  if (breakFeeSek !== null)
    addComponent(components, {
      component_code: "break_fee",
      component_type: "break_fee",
      name: "Brytavgift",
      amount: breakFeeSek,
      calculation_type: "event_only",
      unit: "sek_event",
      priority: 190,
      metadata: { lifecycle: "event_only", event: "early_termination" },
    });
  if (portfolioManagementFeeOrePerKwh !== null)
    addComponent(components, {
      component_code: "portfolio_management_fee",
      component_type: "portfolio_management_fee",
      name: "Portföljförvaltningsavgift",
      amount: portfolioManagementFeeOrePerKwh,
      calculation_type: "per_kwh",
      unit: "ore_per_kwh",
      priority: 200,
    });
  if (discountValue !== null) {
    const discountUnit = String(input.discountUnit || "sek_month");
    addComponent(components, {
      component_code: "campaign_discount",
      component_type: "campaign_discount",
      name: "Kampanjrabatt",
      amount: discountValue,
      calculation_type:
        discountUnit === "ore_per_kwh"
          ? "discount_per_kwh"
          : discountUnit === "percent"
            ? "percentage"
            : "discount_fixed",
      unit: discountUnit,
      priority: 300,
      metadata: {
        duration_months: discountMonths,
        starts_on: input.validFrom ?? null,
        lifecycle: "limited_campaign",
      },
    });
  }
  const optionalComponents = parseOptionalFeeLines(input.optionalFeeLines);
  components.push(...optionalComponents);

  const priceParts: string[] = [];
  const areaFixedPriceText = Object.entries(fixedPricesByArea)
    .sort(([areaA], [areaB]) => areaA.localeCompare(areaB))
    .map(([area, amount]) => `${area} ${formatNumber(amount)} öre/kWh`)
    .join(", ");
  if (input.contractType === "fixed" && areaFixedPriceText)
    priceParts.push(`Fast pris per prisområde: ${areaFixedPriceText}`);
  else if (input.contractType === "fixed" && fixedPriceOrePerKwh !== null)
    priceParts.push(`Fast pris ${formatNumber(fixedPriceOrePerKwh)} öre/kWh`);
  else if (input.contractType === "portfolio")
    priceParts.push("Portföljförvaltat elpris");
  else if (input.contractType === "mixed") {
    const intervalLabel =
      requestedSpotIntervalResolution === "quarterly"
        ? "kvartspris"
        : requestedSpotIntervalResolution === "hourly"
          ? "timpris"
          : "månadspris";
    priceParts.push(
      `Mix ${formatNumber(spotWeight)}% rörligt (${intervalLabel}), ${formatNumber(portfolioWeight)}% portfölj${fixedWeight > 0 ? `, ${formatNumber(fixedWeight)}% fast` : ""}`,
    );
  } else
    priceParts.push(
      input.contractType === "variable_monthly"
        ? "Rörligt månadspris"
        : input.contractType === "variable_hourly"
          ? "Rörligt timpris"
          : input.contractType === "variable_quarterly"
            ? "Rörligt kvartspris"
            : "Rörligt spotpris",
    );
  if (effectiveSpotMarkupOrePerKwh !== null)
    priceParts.push(
      `påslag ${formatNumber(effectiveSpotMarkupOrePerKwh)} öre/kWh`,
    );
  if (variableFeeOrePerKwh !== null)
    priceParts.push(
      `rörlig avgift ${formatNumber(variableFeeOrePerKwh)} öre/kWh`,
    );
  if (monthlyFeeSek !== null)
    priceParts.push(`månadsavgift ${formatNumber(monthlyFeeSek)} kr`);
  if (invoiceFeeSek !== null)
    priceParts.push(`fakturaavgift ${formatNumber(invoiceFeeSek)} kr/faktura`);
  if (greenFeeValue !== null)
    priceParts.push(
      `grön el ${formatNumber(greenFeeValue)} ${String(input.greenFeeMode) === "sek_month" ? "kr/mån" : "öre/kWh"}`,
    );
  if (electricityCertificateOrePerKwh !== null)
    priceParts.push(
      `elcertifikat ${formatNumber(electricityCertificateOrePerKwh)} öre/kWh`,
    );
  if (startFeeSek !== null)
    priceParts.push(`startavgift ${formatNumber(startFeeSek)} kr en gång`);
  if (administrationFeeSek !== null)
    priceParts.push(
      `administrationsavgift ${formatNumber(administrationFeeSek)} kr en gång`,
    );
  if (breakFeeSek !== null)
    priceParts.push(
      `brytavgift ${formatNumber(breakFeeSek)} kr vid förtida uppsägning`,
    );
  if (portfolioManagementFeeOrePerKwh !== null)
    priceParts.push(
      `portföljavgift ${formatNumber(portfolioManagementFeeOrePerKwh)} öre/kWh`,
    );
  if (discountValue !== null) {
    const discountUnit = String(input.discountUnit || "sek_month");
    const unitLabel =
      discountUnit === "percent"
        ? "%"
        : discountUnit === "ore_per_kwh"
          ? "öre/kWh"
          : discountUnit === "sek_once"
            ? "kr engångsvis"
            : "kr/mån";
    priceParts.push(
      `rabatt ${formatNumber(discountValue)} ${unitLabel} i ${discountMonths} mån`,
    );
  }
  const optionalUnitLabels: Record<string, string> = {
    sek_once: "kr en gång",
    sek_contract: "kr per avtal",
    sek_invoice: "kr/faktura",
    sek_month: "kr/mån",
    ore_per_kwh: "öre/kWh",
  };
  for (const component of optionalComponents)
    priceParts.push(
      `${component.name.toLocaleLowerCase("sv-SE")} ${formatNumber(component.amount)} ${optionalUnitLabels[component.unit] ?? component.unit}`,
    );
  const publicPriceText = `${priceParts.join(", ")}. Moms ${formatNumber(vatRate)}%.`;

  return {
    planName,
    pricingModel:
      input.contractType === "fixed"
        ? "fixed"
        : input.contractType === "portfolio"
          ? "portfolio"
          : input.contractType === "mixed"
            ? "mixed"
            : "spot",
    contractType: input.contractType,
    customerType: input.customerType,
    publicPriceText,
    snapshot: {
      schema_version: 2,
      contract_type: input.contractType,
      customer_type: input.customerType,
      price_areas: priceAreas,
      valid_from: input.validFrom ?? null,
      valid_to: input.validTo ?? null,
      binding_months: bindingMonths,
      notice_months: noticeMonths,
      automatic_renewal: input.automaticRenewal ?? false,
      power_of_attorney_required: input.powerOfAttorneyRequired ?? true,
      base_components: baseComponents,
      price_components: components,
      public_price_text: publicPriceText,
      vat_rate: vatRate / 100,
      vat_rate_percent: vatRate,
      interval_resolution:
        input.contractType === "variable_quarterly"
          ? "quarterly"
          : input.contractType === "variable_hourly"
            ? "hourly"
            : input.contractType === "mixed"
              ? (requestedSpotIntervalResolution as
                  "monthly" | "hourly" | "quarterly")
              : input.contractType === "variable_monthly" ||
                  input.contractType === "spot"
                ? "monthly"
                : input.contractType === "fixed"
                  ? "fixed"
                  : "portfolio",
    },
  };
}
