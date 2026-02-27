import { describe, it, expect } from 'vitest';
import { buildResultsTable } from '../src/respond';
import type { ScoringResult, CheckResult, Verdict } from '../src/scoring';

function makeResult(overrides: Partial<ScoringResult> = {}): ScoringResult {
  return {
    finalScore: 0,
    verdict: 'pass' as Verdict,
    checks: [],
    weightedChecks: [],
    summary: 'All checks passed.',
    ...overrides,
  };
}

// ============================================================
// buildResultsTable
// ============================================================
describe('buildResultsTable', () => {
  it('should generate a markdown table with headers', () => {
    const result = makeResult();
    const table = buildResultsTable(result);
    expect(table).toContain('| Check |');
    expect(table).toContain('| Raw Score |');
    expect(table).toContain('| Weight |');
    expect(table).toContain('| Weighted |');
    expect(table).toContain('| Details |');
  });

  it('should include the final score in the output', () => {
    const result = makeResult({ finalScore: 42, verdict: 'warn' });
    const table = buildResultsTable(result);
    expect(table).toContain('42/100');
    expect(table).toContain('WARN');
  });

  it('should include weighted check rows', () => {
    const result = makeResult({
      finalScore: 50,
      verdict: 'warn',
      weightedChecks: [
        {
          name: 'velocity',
          score: 80,
          reason: 'High velocity detected.',
          weight: 80,
          weightedScore: 64,
        },
        {
          name: 'placeholder',
          score: 30,
          reason: 'Minor placeholder code.',
          weight: 70,
          weightedScore: 21,
        },
      ],
    });
    const table = buildResultsTable(result);
    expect(table).toContain('PR Velocity');
    expect(table).toContain('Placeholder Code');
    expect(table).toContain('High velocity detected.');
    expect(table).toContain('64.0');
    expect(table).toContain('21.0');
  });

  it('should show empty table body for no checks', () => {
    const result = makeResult();
    const table = buildResultsTable(result);
    expect(table).toContain('0/100');
    expect(table).toContain('PASS');
  });

  it('should display BLOCK verdict in uppercase', () => {
    const result = makeResult({ finalScore: 95, verdict: 'block' });
    const table = buildResultsTable(result);
    expect(table).toContain('BLOCK');
  });

  it('should display FLAG verdict in uppercase', () => {
    const result = makeResult({ finalScore: 65, verdict: 'flag' });
    const table = buildResultsTable(result);
    expect(table).toContain('FLAG');
  });
});
