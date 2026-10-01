import { servicePriceMinorSchema } from '@washqueue/contracts';

/** Bounded whole-string parsing; no binary fractional multiplication or rounding. */
export function parseKztPrice(value: string): number | null {
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const minor = BigInt(match[1] ?? '') * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (minor < 1n || minor > 100000000n) return null;
  const parsed = servicePriceMinorSchema.safeParse(Number(minor));
  return parsed.success ? parsed.data : null;
}
/** Exact editable major-unit text from an already-minor-unit response. */
export function kztPriceInput(priceMinor: number): string {
  servicePriceMinorSchema.parse(priceMinor);
  return `${Math.floor(priceMinor / 100)}.${String(priceMinor % 100).padStart(2, '0')}`;
}
export function formatKztPrice(priceMinor: number): string {
  servicePriceMinorSchema.parse(priceMinor);
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'KZT',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(priceMinor / 100);
}
