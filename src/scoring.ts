/**
 * SlopGate scoring system.
 * Aggregates individual check results into a final weighted score.
 */

import type { SlopGateConfig, Weights } from './config';
import * as logger from './utils/logger';

export interface CheckResult {
  name: string;
  score: number; // 0-100
  reason: string;
}

export type Verdict = 'pass' | 'warn' | 'flag' | 'block';

export interface ScoringResult {
  finalScore: number;
  verdict: Verdict;
  checks: CheckResult[];
  weightedChecks: Array<CheckResult & { weight: number; weightedScore: number }>;
  summary: string;
}

/**
 * Map check names to their corresponding weight keys.
 */
const CHECK_WEIGHT_MAP: Record<string, keyof Weights> = {
  velocity: 'velocity',
  abandonment: 'abandonment',
  shotgun: 'shotgun',
  new_account: 'new_account',
  placeholder: 'placeholder',
  hallucinated_import: 'hallucinated_import',
  docstring_inflation: 'docstring_inflation',
  copy_paste: 'copy_paste',
  generic_description: 'generic_description',
  oversized_diff: 'oversized_diff',
  unrelated_changes: 'unrelated_changes',
  formatting_only: 'formatting_only',
};

/**
 * Calculate the final weighted score from individual check results.
 */
export function calculateScore(
  checks: CheckResult[],
  config: SlopGateConfig
): ScoringResult {
  const weightedChecks: Array<
    CheckResult & { weight: number; weightedScore: number }
  > = [];

  let totalWeight = 0;
  let totalWeightedScore = 0;

  for (const check of checks) {
    const weightKey = CHECK_WEIGHT_MAP[check.name];
    const weight = weightKey ? config.weights[weightKey] : 50;

    // Skip disabled checks (weight = 0)
    if (weight === 0) {
      logger.debug(`Skipping disabled check: ${check.name}`);
      continue;
    }

    const weightedScore = (check.score * weight) / 100;
    totalWeight += weight;
    totalWeightedScore += weightedScore;

    weightedChecks.push({
      ...check,
      weight,
      weightedScore,
    });
  }

  // Calculate weighted average
  const finalScore =
    totalWeight > 0
      ? Math.round((totalWeightedScore / totalWeight) * 100)
      : 0;

  // Determine verdict
  const verdict = getVerdict(finalScore, config);

  // Sort weighted checks by weighted score (highest first) for reporting
  weightedChecks.sort((a, b) => b.weightedScore - a.weightedScore);

  // Generate summary
  const summary = generateSummary(finalScore, verdict, weightedChecks);

  logger.info(`Final score: ${finalScore}/100 (${verdict})`);

  return {
    finalScore,
    verdict,
    checks,
    weightedChecks,
    summary,
  };
}

/**
 * Determine the verdict based on the final score and configured thresholds.
 */
export function getVerdict(
  score: number,
  config: SlopGateConfig
): Verdict {
  if (score >= config.thresholds.block) return 'block';
  if (score >= config.thresholds.flag) return 'flag';
  if (score >= config.thresholds.warn) return 'warn';
  return 'pass';
}

/**
 * Generate a human-readable summary of the scoring results.
 */
function generateSummary(
  finalScore: number,
  verdict: Verdict,
  weightedChecks: Array<CheckResult & { weight: number; weightedScore: number }>
): string {
  const topIssues = weightedChecks
    .filter((c) => c.score > 0)
    .slice(0, 5);

  if (topIssues.length === 0) {
    return 'All checks passed. No signs of AI-generated slop detected.';
  }

  const issueList = topIssues
    .map(
      (c) =>
        `- **${formatCheckName(c.name)}** (score: ${c.score}, weight: ${c.weight}): ${c.reason}`
    )
    .join('\n');

  const verdictText = {
    pass: 'This PR looks clean.',
    warn: 'This PR has some signals that may warrant closer review.',
    flag: 'This PR shows multiple signals consistent with AI-generated content.',
    block: 'This PR has strong indicators of being AI-generated slop.',
  };

  return `**Score: ${finalScore}/100** (${verdict.toUpperCase()})\n\n${verdictText[verdict]}\n\n### Findings\n\n${issueList}`;
}

/**
 * Format a check name for display.
 */
export function formatCheckName(name: string): string {
  const nameMap: Record<string, string> = {
    velocity: 'PR Velocity',
    abandonment: 'Abandonment Rate',
    shotgun: 'Shotgun Pattern',
    new_account: 'New Account',
    placeholder: 'Placeholder Code',
    hallucinated_import: 'Hallucinated Imports',
    docstring_inflation: 'Docstring Inflation',
    copy_paste: 'Internal Duplication',
    generic_description: 'Generic Description',
    oversized_diff: 'Oversized Diff',
    unrelated_changes: 'Unrelated Changes',
    formatting_only: 'Formatting Only',
  };

  return nameMap[name] || name;
}
