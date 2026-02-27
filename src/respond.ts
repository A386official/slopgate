/**
 * SlopGate response system.
 * Handles labeling, commenting, and closing PRs based on scoring results.
 */

import { GitHubClient } from './github';
import type { SlopGateConfig } from './config';
import type { ScoringResult, Verdict } from './scoring';
import { formatCheckName } from './scoring';
import * as logger from './utils/logger';

/** Label definitions for each verdict tier */
const LABELS: Record<
  Verdict,
  { name: string; color: string; description: string }
> = {
  pass: {
    name: 'slopgate: clean',
    color: '0e8a16',
    description: 'SlopGate: PR passed all AI slop checks',
  },
  warn: {
    name: 'slopgate: review',
    color: 'fbca04',
    description: 'SlopGate: PR has some signals worth reviewing',
  },
  flag: {
    name: 'slopgate: flagged',
    color: 'e11d48',
    description: 'SlopGate: PR flagged as potential AI slop',
  },
  block: {
    name: 'slopgate: blocked',
    color: 'b60205',
    description: 'SlopGate: PR blocked as likely AI slop',
  },
};

/** All SlopGate label names for cleanup */
const ALL_LABEL_NAMES = Object.values(LABELS).map((l) => l.name);

/**
 * Apply the appropriate response based on the scoring result.
 */
export async function respond(
  client: GitHubClient,
  prNumber: number,
  result: ScoringResult,
  config: SlopGateConfig
): Promise<void> {
  const { verdict } = result;

  logger.startGroup(`Responding to PR #${prNumber} (verdict: ${verdict})`);

  try {
    // Remove any existing SlopGate labels first
    for (const labelName of ALL_LABEL_NAMES) {
      await client.removeLabel(prNumber, labelName);
    }

    // Add the appropriate label
    const label = LABELS[verdict];
    await client.addLabel(prNumber, label.name, label.color, label.description);
    logger.info(`Added label: ${label.name}`);

    // Post comments based on verdict
    switch (verdict) {
      case 'pass':
        // Clean PRs just get a label, no comment
        logger.info('PR passed. No comment needed.');
        break;

      case 'warn':
        await postWarningComment(client, prNumber, result);
        break;

      case 'flag':
        await postFlagComment(client, prNumber, result);
        break;

      case 'block':
        await postBlockComment(client, prNumber, result, config);
        break;
    }
  } finally {
    logger.endGroup();
  }
}

/**
 * Post a warning comment with specific findings.
 */
async function postWarningComment(
  client: GitHubClient,
  prNumber: number,
  result: ScoringResult
): Promise<void> {
  const findings = result.weightedChecks
    .filter((c) => c.score > 0)
    .slice(0, 5)
    .map((c) => `| ${formatCheckName(c.name)} | ${c.score} | ${c.reason} |`)
    .join('\n');

  const comment = `## SlopGate Review

**Score: ${result.finalScore}/100** — This PR has some signals that may warrant closer review.

This is an automated check and may produce false positives. A human reviewer should make the final call.

### Findings

| Check | Score | Details |
|-------|-------|---------|
${findings}

<details>
<summary>What is SlopGate?</summary>

SlopGate analyzes pull requests for patterns commonly associated with low-quality AI-generated contributions. A warning does not mean this PR is bad — it means some patterns were detected that are worth a second look.

[Learn more](https://github.com/A386official/slopgate)
</details>`;

  await client.createComment(prNumber, comment);
  logger.info('Posted warning comment.');
}

/**
 * Post a detailed flag comment and request changes.
 */
async function postFlagComment(
  client: GitHubClient,
  prNumber: number,
  result: ScoringResult
): Promise<void> {
  const findings = result.weightedChecks
    .filter((c) => c.score > 0)
    .map((c) => `| ${formatCheckName(c.name)} | ${c.score} | ${c.weight} | ${c.reason} |`)
    .join('\n');

  const comment = `## SlopGate: PR Flagged

**Score: ${result.finalScore}/100** — This PR shows multiple signals consistent with AI-generated content.

Changes have been requested. If this is a false positive, please provide additional context about your changes and a maintainer will review.

### Detailed Analysis

| Check | Score | Weight | Details |
|-------|-------|--------|---------|
${findings}

### What to do

1. **If this is a genuine contribution**: Please add more context to your PR description explaining your changes and reasoning. Address the specific findings listed above.
2. **If you used AI tools**: That's fine! But please review the AI-generated code carefully, ensure it actually works, and provide a thorough description of what was changed and why.

<details>
<summary>About SlopGate</summary>

SlopGate is an automated tool that detects patterns commonly found in low-quality AI-generated pull requests. It is not a judgment on the use of AI tools — it is a filter for low-effort contributions that waste maintainer time.

[Learn more](https://github.com/A386official/slopgate)
</details>`;

  await client.requestChanges(prNumber, comment);
  logger.info('Posted flag comment and requested changes.');
}

/**
 * Post a block comment and optionally close the PR.
 */
async function postBlockComment(
  client: GitHubClient,
  prNumber: number,
  result: ScoringResult,
  config: SlopGateConfig
): Promise<void> {
  const findings = result.weightedChecks
    .filter((c) => c.score > 0)
    .map((c) => `| ${formatCheckName(c.name)} | ${c.score} | ${c.weight} | ${c.reason} |`)
    .join('\n');

  const willClose = config.auto_close;

  const closingNote = willClose
    ? '\n\n**This PR has been automatically closed.** If this is a mistake, please reach out to a maintainer to have it reopened.'
    : '\n\n**Auto-close is disabled.** A maintainer will review this PR manually.';

  const comment = `## SlopGate: PR Blocked

**Score: ${result.finalScore}/100** — This PR has strong indicators of being low-quality AI-generated content.
${closingNote}

### Full Analysis

| Check | Score | Weight | Details |
|-------|-------|--------|---------|
${findings}

### Why was this blocked?

This PR triggered multiple high-confidence detectors for patterns associated with AI-generated slop:
- Automated submission patterns
- Low-quality or placeholder code
- Generic descriptions with large, undocumented changes

If you believe this is a false positive, please open an issue describing your contribution and a maintainer will investigate.

<details>
<summary>About SlopGate</summary>

SlopGate protects open source projects from low-quality AI-generated pull requests. It analyzes behavioral patterns, code quality, and PR metadata to identify contributions that waste maintainer time.

This project respects contributors who use AI tools responsibly. Our aim is to filter out low-effort bulk submissions, not to penalize thoughtful contributions that happened to involve AI assistance.

[Learn more](https://github.com/A386official/slopgate)
</details>`;

  await client.createComment(prNumber, comment);
  logger.info('Posted block comment.');

  if (willClose) {
    await client.closePullRequest(prNumber);
    logger.info(`Closed PR #${prNumber}.`);
  }
}

/**
 * Build a markdown table of all check results for detailed output.
 */
export function buildResultsTable(result: ScoringResult): string {
  const rows = result.weightedChecks
    .map(
      (c) =>
        `| ${formatCheckName(c.name)} | ${c.score} | ${c.weight} | ${c.weightedScore.toFixed(1)} | ${c.reason} |`
    )
    .join('\n');

  return `| Check | Raw Score | Weight | Weighted | Details |
|-------|-----------|--------|----------|---------|
${rows}

**Final Score: ${result.finalScore}/100** (Verdict: ${result.verdict.toUpperCase()})`;
}
