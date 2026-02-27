/**
 * SlopGate — AI Slop PR Firewall
 *
 * GitHub Action entry point. Runs on pull_request events to analyze PRs
 * for signs of low-quality AI-generated contributions.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { GitHubClient } from './github';
import { loadConfig, isAllowlisted } from './config';
import {
  velocityCheck,
  abandonmentCheck,
  shotgunCheck,
  newAccountCheck,
} from './checks/behavioral';
import {
  placeholderCheck,
  hallucinatedImportCheck,
  docstringInflationCheck,
  copyPasteCheck,
  parseDepsFromPackageJson,
  parseDepsFromRequirements,
  parseDepsFromCargoToml,
} from './checks/content';
import {
  genericDescriptionCheck,
  oversizedDiffCheck,
  unrelatedChangesCheck,
  formattingOnlyCheck,
} from './checks/patterns';
import { calculateScore, CheckResult } from './scoring';
import { respond, buildResultsTable } from './respond';
import * as logger from './utils/logger';

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true });
    const context = github.context;

    if (!context.payload.pull_request) {
      core.setFailed('This action can only run on pull_request events.');
      return;
    }

    const prNumber = context.payload.pull_request.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;

    logger.info(`Analyzing PR #${prNumber} in ${owner}/${repo}`);

    const client = new GitHubClient(token, owner, repo);

    // Load configuration
    const configContent = await client.getFileContent('.slopgate.yml');
    const config = loadConfig(configContent);
    logger.info('Configuration loaded.');

    // Get PR data
    const pr = await client.getPullRequest(prNumber);
    const prFiles = await client.getPRFiles(prNumber);

    // Check allowlist
    const isBot = pr.user.type === 'Bot';
    if (isAllowlisted(config, pr.user.login, isBot)) {
      logger.info(
        `User ${pr.user.login} is allowlisted. Skipping all checks.`
      );
      core.setOutput('score', 0);
      core.setOutput('verdict', 'pass');
      core.setOutput('allowlisted', true);
      return;
    }

    // Run all checks
    const checks: CheckResult[] = [];

    // --- Behavioral checks ---
    logger.startGroup('Behavioral checks');

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentRepoPRs = await client.getContributorRecentPRs(
      pr.user.login,
      since24h
    );
    checks.push(velocityCheck(recentRepoPRs));

    const abandonmentStats = await client.getContributorAbandonmentRate(
      pr.user.login
    );
    checks.push(abandonmentCheck(abandonmentStats));

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const publicPRs = await client.getContributorPublicPRs(
      pr.user.login,
      since7d
    );
    checks.push(shotgunCheck(pr, publicPRs));

    checks.push(newAccountCheck(pr, recentRepoPRs));

    logger.endGroup();

    // --- Content checks ---
    logger.startGroup('Content checks');

    checks.push(placeholderCheck(prFiles));

    // Load project dependencies for hallucinated import check
    const projectDeps = await loadProjectDeps(client, pr.base.ref);
    checks.push(hallucinatedImportCheck(prFiles, projectDeps));

    checks.push(docstringInflationCheck(prFiles));
    checks.push(copyPasteCheck(prFiles));

    logger.endGroup();

    // --- Pattern checks ---
    logger.startGroup('Pattern checks');

    checks.push(genericDescriptionCheck(pr));
    checks.push(oversizedDiffCheck(pr));
    checks.push(unrelatedChangesCheck(prFiles));
    checks.push(formattingOnlyCheck(pr, prFiles));

    logger.endGroup();

    // Calculate final score
    const result = calculateScore(checks, config);

    // Set outputs
    core.setOutput('score', result.finalScore);
    core.setOutput('verdict', result.verdict);
    core.setOutput('allowlisted', false);
    core.setOutput('summary', result.summary);

    // Log full results table
    logger.startGroup('Full Results');
    logger.info(buildResultsTable(result));
    logger.endGroup();

    // Respond (label, comment, close)
    await respond(client, prNumber, result, config);

    // Set action status
    if (result.verdict === 'block' && config.auto_close) {
      core.setFailed(
        `SlopGate blocked PR #${prNumber} with score ${result.finalScore}/100.`
      );
    } else if (result.verdict === 'flag') {
      core.warning(
        `SlopGate flagged PR #${prNumber} with score ${result.finalScore}/100.`
      );
    }

    logger.info('SlopGate analysis complete.');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`SlopGate error: ${error.message}`);
    } else {
      core.setFailed('SlopGate encountered an unexpected error.');
    }
  }
}

/**
 * Load project dependency names from common dependency files.
 */
async function loadProjectDeps(
  client: GitHubClient,
  ref: string
): Promise<Set<string>> {
  const deps = new Set<string>();

  // Try package.json (Node.js)
  const packageJson = await client.getFileContent('package.json', ref);
  if (packageJson) {
    for (const dep of parseDepsFromPackageJson(packageJson)) {
      deps.add(dep);
    }
  }

  // Try requirements.txt (Python)
  const requirements = await client.getFileContent('requirements.txt', ref);
  if (requirements) {
    for (const dep of parseDepsFromRequirements(requirements)) {
      deps.add(dep);
    }
  }

  // Try Cargo.toml (Rust)
  const cargoToml = await client.getFileContent('Cargo.toml', ref);
  if (cargoToml) {
    for (const dep of parseDepsFromCargoToml(cargoToml)) {
      deps.add(dep);
    }
  }

  logger.debug(`Loaded ${deps.size} project dependencies.`);
  return deps;
}

run();
