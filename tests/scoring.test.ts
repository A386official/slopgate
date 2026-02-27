import { describe, it, expect } from 'vitest';
import {
  calculateScore,
  getVerdict,
  formatCheckName,
} from '../src/scoring';
import type { CheckResult } from '../src/scoring';
import { DEFAULT_CONFIG } from '../src/config';
import type { SlopGateConfig } from '../src/config';

function makeCheck(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    name: 'velocity',
    score: 0,
    reason: 'Normal activity.',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<SlopGateConfig> = {}): SlopGateConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ============================================================
// getVerdict
// ============================================================
describe('getVerdict', () => {
  it('should return pass for score below warn threshold', () => {
    expect(getVerdict(0, DEFAULT_CONFIG)).toBe('pass');
    expect(getVerdict(29, DEFAULT_CONFIG)).toBe('pass');
  });

  it('should return warn for score at warn threshold', () => {
    expect(getVerdict(30, DEFAULT_CONFIG)).toBe('warn');
  });

  it('should return warn for score between warn and flag thresholds', () => {
    expect(getVerdict(45, DEFAULT_CONFIG)).toBe('warn');
    expect(getVerdict(59, DEFAULT_CONFIG)).toBe('warn');
  });

  it('should return flag for score at flag threshold', () => {
    expect(getVerdict(60, DEFAULT_CONFIG)).toBe('flag');
  });

  it('should return flag for score between flag and block thresholds', () => {
    expect(getVerdict(70, DEFAULT_CONFIG)).toBe('flag');
    expect(getVerdict(79, DEFAULT_CONFIG)).toBe('flag');
  });

  it('should return block for score at block threshold', () => {
    expect(getVerdict(80, DEFAULT_CONFIG)).toBe('block');
  });

  it('should return block for score above block threshold', () => {
    expect(getVerdict(100, DEFAULT_CONFIG)).toBe('block');
  });

  it('should respect custom thresholds', () => {
    const config = makeConfig({
      thresholds: { warn: 20, flag: 40, block: 60 },
    });
    expect(getVerdict(19, config)).toBe('pass');
    expect(getVerdict(20, config)).toBe('warn');
    expect(getVerdict(40, config)).toBe('flag');
    expect(getVerdict(60, config)).toBe('block');
  });
});

// ============================================================
// calculateScore
// ============================================================
describe('calculateScore', () => {
  it('should return score 0 and pass for all-zero checks', () => {
    const checks = [
      makeCheck({ name: 'velocity', score: 0 }),
      makeCheck({ name: 'placeholder', score: 0 }),
    ];
    const result = calculateScore(checks, DEFAULT_CONFIG);
    expect(result.finalScore).toBe(0);
    expect(result.verdict).toBe('pass');
  });

  it('should return score 0 for empty checks array', () => {
    const result = calculateScore([], DEFAULT_CONFIG);
    expect(result.finalScore).toBe(0);
    expect(result.verdict).toBe('pass');
  });

  it('should properly weight check scores', () => {
    const checks = [
      makeCheck({ name: 'velocity', score: 100 }),
    ];
    const result = calculateScore(checks, DEFAULT_CONFIG);
    // velocity weight is 80, score is 100
    // weightedScore = (100 * 80) / 100 = 80
    // finalScore = (80 / 80) * 100 = 100
    expect(result.finalScore).toBe(100);
  });

  it('should skip disabled checks (weight = 0)', () => {
    const config = makeConfig({
      weights: {
        ...DEFAULT_CONFIG.weights,
        velocity: 0,
      },
    });
    const checks = [
      makeCheck({ name: 'velocity', score: 100 }),
      makeCheck({ name: 'placeholder', score: 0 }),
    ];
    const result = calculateScore(checks, config);
    // velocity skipped (weight 0), placeholder score 0
    expect(result.finalScore).toBe(0);
  });

  it('should include checks in weightedChecks output', () => {
    const checks = [
      makeCheck({ name: 'velocity', score: 50 }),
      makeCheck({ name: 'placeholder', score: 30 }),
    ];
    const result = calculateScore(checks, DEFAULT_CONFIG);
    expect(result.weightedChecks.length).toBe(2);
    expect(result.weightedChecks[0].weight).toBeGreaterThan(0);
  });

  it('should sort weightedChecks by weightedScore descending', () => {
    const checks = [
      makeCheck({ name: 'velocity', score: 10 }),
      makeCheck({ name: 'shotgun', score: 90 }),
      makeCheck({ name: 'placeholder', score: 50 }),
    ];
    const result = calculateScore(checks, DEFAULT_CONFIG);
    for (let i = 1; i < result.weightedChecks.length; i++) {
      expect(result.weightedChecks[i - 1].weightedScore).toBeGreaterThanOrEqual(
        result.weightedChecks[i].weightedScore
      );
    }
  });

  it('should generate a summary string', () => {
    const checks = [
      makeCheck({ name: 'velocity', score: 80 }),
    ];
    const result = calculateScore(checks, DEFAULT_CONFIG);
    expect(result.summary).toBeTruthy();
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('should generate clean summary for all-passing checks', () => {
    const checks = [
      makeCheck({ name: 'velocity', score: 0 }),
      makeCheck({ name: 'placeholder', score: 0 }),
    ];
    const result = calculateScore(checks, DEFAULT_CONFIG);
    expect(result.summary).toContain('All checks passed');
  });

  it('should handle checks with unknown names using default weight', () => {
    const checks = [
      makeCheck({ name: 'unknown_check', score: 50 }),
    ];
    const result = calculateScore(checks, DEFAULT_CONFIG);
    // Unknown checks get default weight of 50
    expect(result.weightedChecks[0].weight).toBe(50);
    expect(result.finalScore).toBe(50);
  });

  it('should produce correct verdict for high-scoring checks', () => {
    const checks = [
      makeCheck({ name: 'velocity', score: 100 }),
      makeCheck({ name: 'shotgun', score: 100 }),
      makeCheck({ name: 'placeholder', score: 100 }),
      makeCheck({ name: 'hallucinated_import', score: 100 }),
    ];
    const result = calculateScore(checks, DEFAULT_CONFIG);
    expect(result.verdict).toBe('block');
  });

  it('should preserve original checks array in result', () => {
    const checks = [
      makeCheck({ name: 'velocity', score: 30 }),
    ];
    const result = calculateScore(checks, DEFAULT_CONFIG);
    expect(result.checks).toBe(checks);
    expect(result.checks.length).toBe(1);
  });
});

// ============================================================
// formatCheckName
// ============================================================
describe('formatCheckName', () => {
  it('should format known check names', () => {
    expect(formatCheckName('velocity')).toBe('PR Velocity');
    expect(formatCheckName('abandonment')).toBe('Abandonment Rate');
    expect(formatCheckName('shotgun')).toBe('Shotgun Pattern');
    expect(formatCheckName('new_account')).toBe('New Account');
    expect(formatCheckName('placeholder')).toBe('Placeholder Code');
    expect(formatCheckName('hallucinated_import')).toBe('Hallucinated Imports');
    expect(formatCheckName('docstring_inflation')).toBe('Docstring Inflation');
    expect(formatCheckName('copy_paste')).toBe('Internal Duplication');
    expect(formatCheckName('generic_description')).toBe('Generic Description');
    expect(formatCheckName('oversized_diff')).toBe('Oversized Diff');
    expect(formatCheckName('unrelated_changes')).toBe('Unrelated Changes');
    expect(formatCheckName('formatting_only')).toBe('Formatting Only');
  });

  it('should return the raw name for unknown checks', () => {
    expect(formatCheckName('unknown_check')).toBe('unknown_check');
  });
});
