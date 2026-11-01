// simulation: T1 component regression; no whole-scenario acceptance.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }));

import { resolveBillingUnderlaySegmentBounds as bounds } from '@/lib/billing/underlayEngine';

const monthStart = '2026-08-31T22:00:00.000Z';
const monthEnd = '2026-09-30T22:00:00.000Z';
const civil = { start_date: '2026-09-01', end_date: '2026-09-30' };
const resolve = (period: Record<string, unknown>) => bounds(period, monthStart, monthEnd);

describe('billing underlay exact market bounds', () => {
  it('excludes the September hour before a fixed UTC+1 SITE market start', () => {
    expect(resolve({ ...civil, market_start_at: '2026-08-31T23:00:00Z' })).toEqual({
      start: '2026-08-31T23:00:00.000Z', end: monthEnd,
    });
  });

  it('intersects both intraday market edges, including an offset timestamp', () => {
    expect(resolve({ ...civil, market_start_at: '2026-09-10T12:15:00+02:00', market_end_at: '2026-09-20T15:30:00Z' })).toEqual({
      start: '2026-09-10T10:15:00.000Z', end: '2026-09-20T15:30:00.000Z',
    });
  });

  it('never widens civil or month boundaries for wider market bounds', () => {
    expect(resolve({ ...civil, market_start_at: '2026-08-01T00:00:00Z', market_end_at: '2026-11-01T00:00:00Z' })).toEqual({ start: monthStart, end: monthEnd });
    expect(resolve({ start_date: '2026-09-10', end_date: '2026-09-11', market_start_at: monthStart, market_end_at: monthEnd })).toEqual({
      start: '2026-09-09T22:00:00.000Z', end: '2026-09-11T22:00:00.000Z',
    });
    expect(resolve({ start_date: '2026-08-01', end_date: '2026-10-31', market_start_at: '2026-08-01T00:00:00Z', market_end_at: '2026-11-01T00:00:00Z' })).toEqual({ start: monthStart, end: monthEnd });
  });

  it('preserves date-only and open-ended legacy periods with absent or null exact fields', () => {
    expect(resolve(civil)).toEqual({ start: monthStart, end: monthEnd });
    expect(resolve({ start_date: civil.start_date, market_start_at: null, market_end_at: null })).toEqual({ start: monthStart, end: monthEnd });
  });

  it.each([
    { market_start_at: '2026-10-01T00:00:00Z' },
    { market_end_at: '2026-08-01T00:00:00Z' },
    { market_start_at: '2026-09-10T00:00:00Z', market_end_at: '2026-09-09T00:00:00Z' },
    { market_start_at: '2026-09-10T00:00:00Z', market_end_at: '2026-09-10T00:00:00Z' },
  ])('leaves empty intersections non-billable: %j', (exact) => {
    const result = resolve({ ...civil, ...exact });
    expect(Date.parse(result.end)).toBeLessThanOrEqual(Date.parse(result.start));
  });

  it.each(['market_start_at', 'market_end_at'])('fails closed for malformed present %s', (field) => {
    for (const value of ['invalid', '', '2026-09-01', '2026-09-01T12:00:00', '2026-02-30T00:00:00Z', '2026-09-01T24:00:00Z', 42]) {
      expect(() => resolve({ ...civil, [field]: value })).toThrow(/market_/);
    }
  });
});
