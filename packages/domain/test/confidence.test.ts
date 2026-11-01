import { describe, expect, it } from 'vitest';
import { confidenceBand, SOURCE_PRECEDENCE } from '../src/index.ts';

describe('confiança', () => {
  it('mapeia número para faixa', () => {
    expect(confidenceBand(0.95)).toBe('high');
    expect(confidenceBand(0.7)).toBe('medium');
    expect(confidenceBand(0.2)).toBe('low');
  });
  it('rejeita valores fora de [0,1]', () => {
    expect(() => confidenceBand(1.5)).toThrow(RangeError);
    expect(() => confidenceBand(Number.NaN)).toThrow(RangeError);
  });
  it('save tem precedência sobre screenshot e inferência', () => {
    expect(SOURCE_PRECEDENCE.save).toBeGreaterThan(SOURCE_PRECEDENCE.manual);
    expect(SOURCE_PRECEDENCE.manual).toBeGreaterThan(SOURCE_PRECEDENCE.screenshot);
    expect(SOURCE_PRECEDENCE.screenshot).toBeGreaterThan(SOURCE_PRECEDENCE.inference);
  });
});
