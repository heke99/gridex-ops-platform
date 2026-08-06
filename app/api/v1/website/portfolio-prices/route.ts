import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { customerPortalJson } from "@/lib/customer-portal/externalApi";
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from "@/lib/integrations/apiAuth";
import {
  listPublicContractOffers,
  publicContractResponse,
  publicOfferReference,
} from "@/lib/website/publicContracts";
import { canonicalSwedishPriceArea } from "@/lib/pricing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const auth = await requireIntegrationApiAccess(request, [
    "website_contracts.read",
  ]);
  if (!auth.ok) {
    await logIntegrationApiRequest({
      client: auth.client ?? null,
      request,
      statusCode: auth.status,
      startedAt,
      errorCode: auth.errorCode,
    });
    return customerPortalJson(
      { error: { code: auth.errorCode, message: auth.error } },
      { status: auth.status },
    );
  }

  const offerReference = request.nextUrl.searchParams
    .get("offer_reference")
    ?.trim();
  const priceArea = request.nextUrl.searchParams
    .get("price_area")
    ?.trim()
    .toUpperCase();
  if (!offerReference) {
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 422,
      startedAt,
      errorCode: "offer_reference_required",
    });
    return customerPortalJson(
      {
        error: {
          code: "offer_reference_required",
          message: "offer_reference krävs.",
          field: "offer_reference",
        },
      },
      { status: 422 },
    );
  }
  if (priceArea && !["SE1", "SE2", "SE3", "SE4"].includes(priceArea)) {
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 422,
      startedAt,
      errorCode: "price_area_invalid",
    });
    return customerPortalJson(
      {
        error: {
          code: "price_area_invalid",
          message: "price_area måste vara SE1–SE4.",
          field: "price_area",
        },
      },
      { status: 422 },
    );
  }

  try {
    const offers = await listPublicContractOffers({ client: auth.client });
    const offer = offers.find(
      (candidate) => publicOfferReference(candidate) === offerReference,
    );
    if (!offer || !["portfolio", "mixed"].includes(offer.contract_type)) {
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: 404,
        startedAt,
        errorCode: "portfolio_offer_not_found",
      });
      return customerPortalJson(
        {
          error: {
            code: "portfolio_offer_not_found",
            message: "Publicerat portfölj-/mixavtal hittades inte.",
          },
        },
        { status: 404 },
      );
    }

    const response = publicContractResponse(offer) as Record<string, unknown>;
    const pricing =
      response.pricing &&
      typeof response.pricing === "object" &&
      !Array.isArray(response.pricing)
        ? (response.pricing as Record<string, unknown>)
        : {};
    const historical = records(pricing.portfolio_monthly_prices).filter(
      (row) =>
        !priceArea ||
        canonicalSwedishPriceArea(row.price_area_code) === priceArea,
    );
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: {
        offer_reference: offerReference,
        price_area: priceArea ?? null,
        historical_count: historical.length,
      },
    });
    return customerPortalJson({
      data: {
        offer_reference: offerReference,
        method: pricing.portfolio_method ?? null,
        historical_final_prices: historical,
        market_price_responsibility: "ops_quote",
        calculator_market_price_supplied_by_ops: true,
        final_billing_rule: "locked_settlement_only",
      },
    });
  } catch (error) {
    const traceId = randomUUID();
    console.error("[portfolio-prices-api] failed", { traceId, error });
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 500,
      startedAt,
      errorCode: "portfolio_prices_unavailable",
      metadata: { trace_id: traceId },
    });
    return customerPortalJson(
      {
        error: {
          code: "portfolio_prices_unavailable",
          message: "Portföljprisdata kunde inte hämtas.",
          trace_id: traceId,
        },
      },
      { status: 500 },
    );
  }
}
