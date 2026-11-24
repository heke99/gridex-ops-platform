const pricingSource = new URL("../../lib/pricing/contractPricingVersioning.ts", import.meta.url).href;
const vatSource = new URL("../../lib/pricing/vat.ts", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/pricing/vat" && context.parentURL === pricingSource) {
    return nextResolve(vatSource, context);
  }
  return nextResolve(specifier, context);
}
