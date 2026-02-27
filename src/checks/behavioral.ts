/**
 * Behavioral checks for SlopGate.
 * Analyzes contributor behavior patterns to detect automated or spam PRs.
 */

import { ContributorPR, PullRequestData } from '../github';
import * as logger from '../utils/logger';

export interface CheckResult {
  name: string;
  score: number; // 0-100
  reason: string;
}

/**
 * Velocity check: How many PRs has this contributor opened in the last 24 hours?
 * > 3 = suspicious, > 5 = likely bot
 */
export function velocityCheck(recentPRs: ContributorPR[]): CheckResult {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentCount = recentPRs.filter(
    (pr) => new Date(pr.created_at) >= twentyFourHoursAgo
  ).length;

  logger.debug(`Velocity check: ${recentCount} PRs in last 24h`);

  let score = 0;
  let reason = '';

  if (recentCount <= 3) {
    score = 0;
    reason = `Normal activity: ${recentCount} PR(s) in the last 24 hours.`;
  } else if (recentCount <= 5) {
    score = 50;
    reason = `Elevated activity: ${recentCount} PRs in the last 24 hours. This is above typical contributor behavior.`;
  } else if (recentCount <= 10) {
    score = 80;
    reason = `High velocity: ${recentCount} PRs in the last 24 hours. This pattern is consistent with automated PR generation.`;
  } else {
    score = 100;
    reason = `Extreme velocity: ${recentCount} PRs in the last 24 hours. Almost certainly automated.`;
  }

  return { name: 'velocity', score, reason };
}

/**
 * Abandonment check: What percentage of this contributor's past PRs were
 * closed without merge?
 * > 70% = suspicious
 */
export function abandonmentCheck(stats: {
  total: number;
  abandoned: number;
  rate: number;
}): CheckResult {
  logger.debug(
    `Abandonment check: ${stats.abandoned}/${stats.total} PRs abandoned (${stats.rate.toFixed(1)}%)`
  );

  // Not enough data to judge
  if (stats.total < 3) {
    return {
      name: 'abandonment',
      score: 0,
      reason: `Insufficient history: only ${stats.total} previous PR(s). Cannot assess abandonment pattern.`,
    };
  }

  let score = 0;
  let reason = '';

  if (stats.rate <= 30) {
    score = 0;
    reason = `Healthy contribution pattern: ${stats.rate.toFixed(0)}% abandonment rate (${stats.abandoned}/${stats.total} PRs).`;
  } else if (stats.rate <= 50) {
    score = 25;
    reason = `Moderate abandonment: ${stats.rate.toFixed(0)}% of PRs closed without merge (${stats.abandoned}/${stats.total}).`;
  } else if (stats.rate <= 70) {
    score = 50;
    reason = `Elevated abandonment: ${stats.rate.toFixed(0)}% of PRs were never merged (${stats.abandoned}/${stats.total}).`;
  } else if (stats.rate <= 90) {
    score = 80;
    reason = `High abandonment: ${stats.rate.toFixed(0)}% of PRs abandoned (${stats.abandoned}/${stats.total}). Consistent with spray-and-pray behavior.`;
  } else {
    score = 100;
    reason = `Near-total abandonment: ${stats.rate.toFixed(0)}% of PRs discarded (${stats.abandoned}/${stats.total}). Strongly suggests automated low-quality contributions.`;
  }

  return { name: 'abandonment', score, reason };
}

/**
 * Shotgun check: Are the PR title/description nearly identical to PRs
 * on other repos?
 */
export function shotgunCheck(
  currentPR: PullRequestData,
  publicPRs: ContributorPR[]
): CheckResult {
  const currentTitle = currentPR.title.toLowerCase().trim();
  const currentBody = (currentPR.body || '').toLowerCase().trim();

  // Filter out PRs from the same repo and the current PR itself
  const otherRepoPRs = publicPRs.filter(
    (pr) => pr.number !== currentPR.number
  );

  if (otherRepoPRs.length === 0) {
    return {
      name: 'shotgun',
      score: 0,
      reason: 'No other recent public PRs found for comparison.',
    };
  }

  let titleMatches = 0;
  let bodyMatches = 0;

  for (const pr of otherRepoPRs) {
    const prTitle = pr.title.toLowerCase().trim();
    const prBody = (pr.body || '').toLowerCase().trim();

    // Check title similarity (exact or near-exact match)
    if (prTitle === currentTitle || levenshteinSimilarity(prTitle, currentTitle) > 0.85) {
      titleMatches++;
    }

    // Check body similarity (if both have non-trivial bodies)
    if (currentBody.length > 20 && prBody.length > 20) {
      if (levenshteinSimilarity(prBody, currentBody) > 0.80) {
        bodyMatches++;
      }
    }
  }

  const totalOtherPRs = otherRepoPRs.length;
  const titleMatchRate = titleMatches / totalOtherPRs;

  logger.debug(
    `Shotgun check: ${titleMatches}/${totalOtherPRs} title matches, ${bodyMatches} body matches`
  );

  let score = 0;
  let reason = '';

  if (titleMatches === 0 && bodyMatches === 0) {
    score = 0;
    reason = 'PR title and description appear unique across contributor activity.';
  } else if (titleMatches >= 3 || bodyMatches >= 2) {
    score = 90;
    reason = `Shotgun pattern detected: PR title matches ${titleMatches} other recent PRs, body matches ${bodyMatches}. This contributor is submitting nearly identical PRs to multiple repositories.`;
  } else if (titleMatches >= 2 || titleMatchRate > 0.5) {
    score = 60;
    reason = `Possible shotgun pattern: PR title matches ${titleMatches} other PR(s). Similar PRs found across repos.`;
  } else {
    score = 25;
    reason = `Minor overlap: ${titleMatches} title match(es), ${bodyMatches} body match(es) with other recent PRs.`;
  }

  return { name: 'shotgun', score, reason };
}

/**
 * New account check: Account age < 30 days + first PR to this repo.
 * Flags but does not auto-reject.
 */
export function newAccountCheck(
  pr: PullRequestData,
  recentRepoPRs: ContributorPR[]
): CheckResult {
  const accountCreated = new Date(pr.user.created_at);
  const now = new Date();
  const accountAgeDays = Math.floor(
    (now.getTime() - accountCreated.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Check if this is the first PR to this repo
  const priorPRs = recentRepoPRs.filter((rp) => rp.number !== pr.number);
  const isFirstPR = priorPRs.length === 0;

  logger.debug(
    `New account check: account age ${accountAgeDays} days, first PR: ${isFirstPR}`
  );

  let score = 0;
  let reason = '';

  if (accountAgeDays >= 30) {
    score = 0;
    reason = `Account is ${accountAgeDays} days old. Not flagged as a new account.`;
  } else if (!isFirstPR) {
    score = 10;
    reason = `Account is ${accountAgeDays} days old but has prior PRs to this repo.`;
  } else if (accountAgeDays >= 14) {
    score = 30;
    reason = `New account (${accountAgeDays} days old) with first PR to this repo. Worth a closer look.`;
  } else if (accountAgeDays >= 7) {
    score = 50;
    reason = `Very new account (${accountAgeDays} days old) submitting first PR to this repo.`;
  } else {
    score = 70;
    reason = `Brand new account (${accountAgeDays} days old) submitting first-ever PR to this repo. Elevated risk of being a throwaway account.`;
  }

  return { name: 'new_account', score, reason };
}

/**
 * Calculate Levenshtein similarity between two strings.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // For very long strings, use a simplified comparison to avoid performance issues
  if (a.length > 500 || b.length > 500) {
    return jaccardSimilarity(a, b);
  }

  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const maxLen = Math.max(a.length, b.length);
  return 1 - matrix[a.length][b.length] / maxLen;
}

/**
 * Jaccard similarity for long strings (word-based).
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  if (union === 0) return 0;

  return intersection / union;
}
