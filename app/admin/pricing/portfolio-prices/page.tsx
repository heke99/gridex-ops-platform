import { redirect } from "next/navigation";

export default async function LegacyPortfolioPricesPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const params = await searchParams;
  const query = params.companyId
    ? `?companyId=${encodeURIComponent(params.companyId)}`
    : "";
  redirect(`/admin/pricing/portfolio-settlements${query}`);
}

