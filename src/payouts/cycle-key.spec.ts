import { formatISOWeek, parseISOWeek } from './cycle-key';

describe('formatISOWeek', () => {
  it('should format a Monday in 2026 as ISO week', () => {
    expect(formatISOWeek(new Date('2026-05-11T09:00:00Z'))).toBe('2026-W20');
  });

  it('should treat week 1 as the week containing Jan 4', () => {
    expect(formatISOWeek(new Date('2025-12-29T09:00:00Z'))).toBe('2026-W01');
  });

  it('should pad single-digit week to 2 digits', () => {
    expect(formatISOWeek(new Date('2026-02-02T09:00:00Z'))).toBe('2026-W06');
  });

  it('should correctly handle year boundary cases', () => {
    expect(formatISOWeek(new Date('2025-12-31T09:00:00Z'))).toBe('2026-W01');
  });
});

describe('parseISOWeek', () => {
  it('should round-trip a known key', () => {
    const key = formatISOWeek(new Date('2026-05-11T09:00:00Z'));
    const parsed = parseISOWeek(key);
    expect(parsed.year).toBe(2026);
    expect(parsed.week).toBe(20);
  });

  it('should reject malformed keys', () => {
    expect(() => parseISOWeek('not-a-key')).toThrow();
    expect(() => parseISOWeek('2026-W99')).toThrow();
  });
});
