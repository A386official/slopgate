/**
 * Pattern checks for SlopGate.
 * Analyzes PR metadata and diff structure for suspicious patterns.
 */

import { PRFile, PullRequestData } from '../github';
import * as logger from '../utils/logger';

export interface CheckResult {
  name: string;
  score: number; // 0-100
  reason: string;
}

/**
 * Generic description check: PR title is vague ("fix bug", "update code",
 * "improve performance") without specifics.
 */
export function genericDescriptionCheck(pr: PullRequestData): CheckResult {
  const title = pr.title.toLowerCase().trim();
  const body = (pr.body || '').toLowerCase().trim();

  // Known generic PR titles (common AI-generated patterns)
  const genericTitles = [
    /^fix(?:ed|es|ing)?\s+(?:a\s+)?bugs?$/,
    /^update(?:d|s)?\s+code$/,
    /^improve(?:d|s)?\s+(?:the\s+)?performance$/,
    /^(?:minor\s+)?fix(?:es)?$/,
    /^update(?:d|s)?$/,
    /^improve(?:ment)?s?$/,
    /^refactor(?:ed|ing)?$/,
    /^clean\s*up$/,
    /^enhance(?:ment)?s?$/,
    /^optimization$/,
    /^bug\s*fix$/,
    /^patch$/,
    /^changes$/,
    /^updates?(?:\s+(?:to\s+)?(?:the\s+)?code)?$/,
    /^fix(?:ed)?\s+(?:some\s+)?(?:issues?|problems?|errors?)$/,
    /^code\s+(?:improvement|cleanup|refactor(?:ing)?)$/,
    /^improve(?:d)?\s+code\s+quality$/,
    /^general\s+(?:improvements?|fixes|updates?)$/,
    /^misc(?:ellaneous)?\s+(?:fixes|changes|updates?)$/,
    /^small\s+(?:fixes?|changes?|updates?)$/,
    /^various\s+(?:fixes?|improvements?|updates?)$/,
  ];

  const isGenericTitle = genericTitles.some((pattern) => pattern.test(title));
  const isTitleShort = title.length < 15;
  const hasNoBody = body.length < 20;

  // AI-generated PRs often use these exact phrases in descriptions
  const aiDescriptionPatterns = [
    /this (?:pr|pull request|commit) (?:fixes|improves|updates|enhances|refactors)/,
    /(?:improved|enhanced|optimized) (?:the )?(?:overall|code) (?:quality|performance|readability)/,
    /made (?:the )?(?:following|these|some) (?:changes|improvements|updates)/,
    /this (?:change|update|improvement) (?:will|should|aims to)/,
  ];

  const hasAIDescription = aiDescriptionPatterns.some((pattern) =>
    pattern.test(body)
  );

  logger.debug(
    `Generic description check: title="${title}" (generic=${isGenericTitle}, short=${isTitleShort}), body length=${body.length}`
  );

  let score = 0;
  let reason = '';

  if (isGenericTitle && hasNoBody) {
    score = 85;
    reason = `Generic PR title ("${pr.title}") with no meaningful description. AI-generated PRs frequently use vague titles like this.`;
  } else if (isGenericTitle && hasAIDescription) {
    score = 70;
    reason = `Generic title ("${pr.title}") paired with template-like description. Both the title and body follow common AI-generation patterns.`;
  } else if (isGenericTitle) {
    score = 50;
    reason = `Generic PR title ("${pr.title}"). Consider being more specific about what was changed and why.`;
  } else if (isTitleShort && hasNoBody) {
    score = 35;
    reason = `Very short title ("${pr.title}") with no description. Not necessarily AI-generated, but lacks the context reviewers need.`;
  } else if (hasAIDescription && !isGenericTitle) {
    score = 20;
    reason = `PR description uses template-like language, but the title is specific enough.`;
  } else {
    score = 0;
    reason = 'PR title and description appear specific and well-written.';
  }

  return { name: 'generic_description', score, reason };
}

/**
 * Oversized diff check: PR changes >500 lines but the description is < 50 chars.
 */
export function oversizedDiffCheck(pr: PullRequestData): CheckResult {
  const totalChanges = pr.additions + pr.deletions;
  const descriptionLength = (pr.body || '').trim().length;

  logger.debug(
    `Oversized diff check: ${totalChanges} lines changed, ${descriptionLength} char description`
  );

  // Small PRs are not suspicious regardless of description
  if (totalChanges <= 100) {
    return {
      name: 'oversized_diff',
      score: 0,
      reason: `Small PR (${totalChanges} lines changed). No size concern.`,
    };
  }

  // Calculate the expected minimum description length based on diff size
  const expectedMinDescription = Math.min(totalChanges * 0.1, 200);
  const isUnderdocumented = descriptionLength < expectedMinDescription;

  let score = 0;
  let reason = '';

  if (totalChanges > 2000 && descriptionLength < 50) {
    score = 95;
    reason = `Massive PR (${totalChanges} lines) with only ${descriptionLength} characters of description. A change this large requires thorough explanation.`;
  } else if (totalChanges > 1000 && descriptionLength < 50) {
    score = 80;
    reason = `Very large PR (${totalChanges} lines) with a ${descriptionLength}-character description. The diff-to-description ratio is extremely unbalanced.`;
  } else if (totalChanges > 500 && descriptionLength < 50) {
    score = 65;
    reason = `Large PR (${totalChanges} lines changed) with minimal description (${descriptionLength} chars). AI-generated PRs often dump large changes without explanation.`;
  } else if (totalChanges > 500 && isUnderdocumented) {
    score = 40;
    reason = `PR changes ${totalChanges} lines but the description is shorter than expected. Consider adding more context.`;
  } else if (totalChanges > 300 && descriptionLength < 30) {
    score = 30;
    reason = `Moderately large PR (${totalChanges} lines) with brief description (${descriptionLength} chars).`;
  } else {
    score = 0;
    reason = `PR size (${totalChanges} lines) and description length (${descriptionLength} chars) are proportional.`;
  }

  return { name: 'oversized_diff', score, reason };
}

/**
 * Unrelated changes check: Files changed span >3 directories with no
 * apparent connection.
 */
export function unrelatedChangesCheck(files: PRFile[]): CheckResult {
  if (files.length <= 1) {
    return {
      name: 'unrelated_changes',
      score: 0,
      reason: 'Single file changed. No cross-directory concern.',
    };
  }

  // Extract top-level directories
  const directories = new Set<string>();
  const dirFiles: Map<string, string[]> = new Map();

  for (const file of files) {
    const parts = file.filename.split('/');
    const topDir = parts.length > 1 ? parts[0] : '.';
    directories.add(topDir);

    if (!dirFiles.has(topDir)) {
      dirFiles.set(topDir, []);
    }
    dirFiles.get(topDir)!.push(file.filename);
  }

  // Also check second-level directory depth for more granularity
  const deepDirs = new Set<string>();
  for (const file of files) {
    const parts = file.filename.split('/');
    const dir = parts.length > 2
      ? `${parts[0]}/${parts[1]}`
      : parts.length > 1
        ? parts[0]
        : '.';
    deepDirs.add(dir);
  }

  const dirCount = directories.size;
  const deepDirCount = deepDirs.size;

  logger.debug(
    `Unrelated changes: ${dirCount} top-level dirs, ${deepDirCount} second-level dirs, ${files.length} files`
  );

  // Common patterns that indicate related cross-directory changes
  const hasTests = files.some((f) => f.filename.includes('test') || f.filename.includes('spec'));
  const hasConfig = files.some(
    (f) =>
      f.filename.includes('config') ||
      f.filename.includes('package.json') ||
      f.filename.includes('.yml') ||
      f.filename.includes('.yaml') ||
      f.filename.includes('.toml')
  );
  const hasDocs = files.some(
    (f) =>
      f.filename.includes('README') ||
      f.filename.includes('doc') ||
      f.filename.includes('.md')
  );

  // Reduce score if changes look related (e.g., code + tests + config)
  const likelyRelated = hasTests || hasConfig || hasDocs;

  let score = 0;
  let reason = '';

  if (dirCount <= 3) {
    score = 0;
    reason = `Files span ${dirCount} director${dirCount === 1 ? 'y' : 'ies'}. Within normal range.`;
  } else if (dirCount <= 5 && likelyRelated) {
    score = 10;
    reason = `Files span ${dirCount} directories, but include tests/config/docs that are typically updated alongside code.`;
  } else if (dirCount <= 5) {
    score = 35;
    reason = `Files span ${dirCount} directories (${[...directories].slice(0, 5).join(', ')}). This may indicate unrelated changes bundled together.`;
  } else if (dirCount <= 8) {
    score = 60;
    const dirs = [...directories].slice(0, 6).join(', ');
    reason = `Wide scope: files touch ${dirCount} directories (${dirs}). AI-generated PRs often make scattered, unrelated changes.`;
  } else {
    score = 85;
    const dirs = [...directories].slice(0, 6).join(', ');
    reason = `Extremely scattered: ${dirCount} directories affected (${dirs}, ...). This pattern is characteristic of AI-generated bulk changes.`;
  }

  return { name: 'unrelated_changes', score, reason };
}

/**
 * Formatting-only check: PR only changes whitespace/formatting but claims
 * to fix a bug or add a feature.
 */
export function formattingOnlyCheck(
  pr: PullRequestData,
  files: PRFile[]
): CheckResult {
  let formattingOnlyLines = 0;
  let substantiveLines = 0;

  for (const file of files) {
    if (!file.patch) continue;

    const lines = file.patch.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Skip diff metadata
      if (
        line.startsWith('@@') ||
        line.startsWith('diff') ||
        line.startsWith('index') ||
        line.startsWith('---') ||
        line.startsWith('+++')
      ) {
        i++;
        continue;
      }

      // Look at paired additions/removals to detect formatting-only changes
      if (line.startsWith('-') && i + 1 < lines.length && lines[i + 1].startsWith('+')) {
        const removed = line.substring(1);
        const added = lines[i + 1].substring(1);

        // If the only difference is whitespace, it's a formatting change
        if (removed.trim() === added.trim()) {
          formattingOnlyLines += 2;
          i += 2;
          continue;
        }

        // Check if only indentation changed
        if (
          removed.replace(/\s/g, '') === added.replace(/\s/g, '')
        ) {
          formattingOnlyLines += 2;
          i += 2;
          continue;
        }

        // Check if only quotes changed (single <-> double)
        if (
          removed.replace(/["'`]/g, '"') === added.replace(/["'`]/g, '"')
        ) {
          formattingOnlyLines += 2;
          i += 2;
          continue;
        }

        // Check if only trailing semicolons/commas were added/removed
        if (removed.trim().replace(/[;,]\s*$/, '') === added.trim().replace(/[;,]\s*$/, '')) {
          formattingOnlyLines += 2;
          i += 2;
          continue;
        }

        substantiveLines += 2;
        i += 2;
      } else if (line.startsWith('+') || line.startsWith('-')) {
        // Single-sided change
        const content = line.substring(1).trim();
        if (content === '' || content === '{' || content === '}') {
          formattingOnlyLines++;
        } else {
          substantiveLines++;
        }
        i++;
      } else {
        i++;
      }
    }
  }

  const totalChangedLines = formattingOnlyLines + substantiveLines;

  logger.debug(
    `Formatting check: ${formattingOnlyLines} formatting, ${substantiveLines} substantive lines`
  );

  if (totalChangedLines < 5) {
    return {
      name: 'formatting_only',
      score: 0,
      reason: 'Too few changes to assess.',
    };
  }

  const formattingRate = formattingOnlyLines / totalChangedLines;

  // Check if the title/description claims substantive changes
  const titleLower = pr.title.toLowerCase();
  const claimsSubstantiveWork =
    /fix|feat|add|implement|resolve|bug|issue|feature|enhance|refactor|optimize/.test(
      titleLower
    );

  let score = 0;
  let reason = '';

  if (formattingRate < 0.5) {
    score = 0;
    reason = 'PR contains substantive code changes.';
  } else if (formattingRate < 0.8) {
    if (claimsSubstantiveWork) {
      score = 30;
      reason = `${(formattingRate * 100).toFixed(0)}% of changes are formatting-only, but the title claims substantive work ("${pr.title}").`;
    } else {
      score = 10;
      reason = `${(formattingRate * 100).toFixed(0)}% of changes are formatting-only. The title doesn't overclaim.`;
    }
  } else if (formattingRate < 0.95) {
    if (claimsSubstantiveWork) {
      score = 65;
      reason = `${(formattingRate * 100).toFixed(0)}% of changes are whitespace/formatting, yet the title ("${pr.title}") implies bug fixes or features. This is a common AI slop pattern.`;
    } else {
      score = 25;
      reason = `Mostly formatting changes (${(formattingRate * 100).toFixed(0)}%). The title accurately represents the scope.`;
    }
  } else {
    if (claimsSubstantiveWork) {
      score = 90;
      reason = `Almost entirely formatting changes (${(formattingRate * 100).toFixed(0)}%) but claims to "${pr.title}". This is misleading and a hallmark of AI-generated contributions.`;
    } else {
      score = 35;
      reason = `PR is nearly all formatting (${(formattingRate * 100).toFixed(0)}%). While not necessarily slop, formatting-only PRs add noise.`;
    }
  }

  return { name: 'formatting_only', score, reason };
}
