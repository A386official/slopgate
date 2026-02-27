/**
 * Content checks for SlopGate.
 * Analyzes the actual code diff for signs of AI-generated slop.
 */

import { PRFile } from '../github';
import * as logger from '../utils/logger';

export interface CheckResult {
  name: string;
  score: number; // 0-100
  reason: string;
}

/**
 * Placeholder check: Detect empty function bodies, TODO comments without context,
 * `pass` statements, and placeholder variable names.
 */
export function placeholderCheck(files: PRFile[]): CheckResult {
  const issues: string[] = [];
  let totalIssueCount = 0;
  let totalLinesChanged = 0;

  // Patterns that indicate placeholder/stub code
  const patterns = {
    emptyFunction: /\{\s*\}|\{\s*\/\/\s*\}|\{\s*\/\*\s*\*\/\s*\}/g,
    todoWithoutContext: /\/\/\s*TODO\s*$/gm,
    passStatement: /^\+\s*pass\s*$/gm,
    placeholderNames:
      /\b(foo|bar|baz|temp\d*|test\d+|xxx|yyy|zzz|placeholder|dummy|sample|example\d+)\b/gi,
    emptyReturn: /return\s*;?\s*\/\/\s*(todo|fixme|implement)/gi,
    notImplemented: /throw\s+new\s+(Error|NotImplementedError)\s*\(\s*['"`](not\s+implemented|todo|fixme)/gi,
  };

  for (const file of files) {
    if (!file.patch) continue;

    // Only look at added lines
    const addedLines = file.patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'));

    totalLinesChanged += addedLines.length;
    const addedContent = addedLines.join('\n');

    // Check each pattern
    const emptyFunctions = addedContent.match(patterns.emptyFunction);
    if (emptyFunctions && emptyFunctions.length > 0) {
      totalIssueCount += emptyFunctions.length;
      issues.push(
        `${file.filename}: ${emptyFunctions.length} empty function body/bodies`
      );
    }

    const todos = addedContent.match(patterns.todoWithoutContext);
    if (todos && todos.length > 0) {
      totalIssueCount += todos.length;
      issues.push(
        `${file.filename}: ${todos.length} TODO comment(s) without context`
      );
    }

    const passStmts = addedContent.match(patterns.passStatement);
    if (passStmts && passStmts.length > 0) {
      totalIssueCount += passStmts.length;
      issues.push(
        `${file.filename}: ${passStmts.length} bare \`pass\` statement(s)`
      );
    }

    const placeholders = addedContent.match(patterns.placeholderNames);
    if (placeholders && placeholders.length > 2) {
      // Only flag if there are multiple placeholder names
      totalIssueCount += placeholders.length;
      const unique = [...new Set(placeholders.map((p) => p.toLowerCase()))];
      issues.push(
        `${file.filename}: placeholder variable names detected (${unique.slice(0, 5).join(', ')})`
      );
    }

    const notImpl = addedContent.match(patterns.notImplemented);
    if (notImpl && notImpl.length > 0) {
      totalIssueCount += notImpl.length;
      issues.push(
        `${file.filename}: ${notImpl.length} "not implemented" stub(s)`
      );
    }
  }

  if (totalLinesChanged === 0) {
    return {
      name: 'placeholder',
      score: 0,
      reason: 'No code changes to analyze.',
    };
  }

  const issueRate = totalIssueCount / Math.max(totalLinesChanged, 1);

  logger.debug(
    `Placeholder check: ${totalIssueCount} issues in ${totalLinesChanged} lines (rate: ${(issueRate * 100).toFixed(1)}%)`
  );

  let score = 0;
  let reason = '';

  if (totalIssueCount === 0) {
    score = 0;
    reason = 'No placeholder code detected.';
  } else if (issueRate < 0.02) {
    score = 15;
    reason = `Minor: ${totalIssueCount} placeholder issue(s) found. ${issues.slice(0, 2).join('; ')}.`;
  } else if (issueRate < 0.05) {
    score = 40;
    reason = `Moderate placeholder code detected (${totalIssueCount} issues). ${issues.slice(0, 3).join('; ')}.`;
  } else if (issueRate < 0.1) {
    score = 70;
    reason = `Significant placeholder code: ${totalIssueCount} issues across ${issues.length} file(s). ${issues.slice(0, 3).join('; ')}.`;
  } else {
    score = 95;
    reason = `Heavily stubbed code: ${totalIssueCount} placeholder issues in ${totalLinesChanged} lines. ${issues.slice(0, 4).join('; ')}.`;
  }

  return { name: 'placeholder', score, reason };
}

/**
 * Hallucinated import check: Verify that imported modules actually exist
 * in the project's dependency files.
 */
export function hallucinatedImportCheck(
  files: PRFile[],
  projectDeps: Set<string>
): CheckResult {
  const suspiciousImports: Array<{ file: string; module: string }> = [];
  let totalImports = 0;

  // Import patterns for different languages
  const importPatterns = [
    // JavaScript/TypeScript: import ... from 'module' or import 'module'
    /^\+.*\bfrom\s+['"]([^'"./][^'"]*)['"]/gm,
    // JavaScript/TypeScript: require('module')
    /^\+.*\brequire\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/gm,
    // JavaScript/TypeScript: import 'module' (side-effect import)
    /^\+\s*import\s+['"]([^'"./][^'"]*)['"]/gm,
    // Python: import module / from module import ...
    /^\+\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s|$|\.)/gm,
  ];

  // Standard library modules and built-in modules to ignore
  const builtins = new Set([
    // Node.js built-ins
    'fs', 'path', 'os', 'util', 'http', 'https', 'crypto', 'stream',
    'events', 'buffer', 'child_process', 'cluster', 'dgram', 'dns',
    'net', 'readline', 'tls', 'url', 'zlib', 'assert', 'querystring',
    'string_decoder', 'timers', 'tty', 'v8', 'vm', 'worker_threads',
    'perf_hooks', 'async_hooks', 'node:fs', 'node:path', 'node:os',
    'node:util', 'node:http', 'node:https', 'node:crypto', 'node:stream',
    'node:events', 'node:buffer', 'node:child_process', 'node:url',
    'node:test', 'node:assert',
    // Python standard library (common)
    'os', 'sys', 'json', 'math', 'time', 'datetime', 're', 'typing',
    'collections', 'itertools', 'functools', 'pathlib', 'io', 'abc',
    'logging', 'unittest', 'argparse', 'hashlib', 'base64', 'copy',
    'dataclasses', 'enum', 'contextlib', 'threading', 'subprocess',
    'tempfile', 'shutil', 'glob', 'random', 'string', 'textwrap',
  ]);

  for (const file of files) {
    if (!file.patch) continue;

    for (const pattern of importPatterns) {
      // Reset lastIndex for each file
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(file.patch)) !== null) {
        const moduleName = match[1];
        // Get the base package name (e.g., '@actions/core' -> '@actions/core', 'lodash/fp' -> 'lodash')
        const baseModule = moduleName.startsWith('@')
          ? moduleName.split('/').slice(0, 2).join('/')
          : moduleName.split('/')[0];

        totalImports++;

        if (!builtins.has(baseModule) && !projectDeps.has(baseModule)) {
          suspiciousImports.push({
            file: file.filename,
            module: baseModule,
          });
        }
      }
    }
  }

  logger.debug(
    `Hallucinated import check: ${suspiciousImports.length}/${totalImports} suspicious imports`
  );

  if (totalImports === 0) {
    return {
      name: 'hallucinated_import',
      score: 0,
      reason: 'No imports detected in the changed files.',
    };
  }

  const suspiciousRate = suspiciousImports.length / totalImports;

  let score = 0;
  let reason = '';

  if (suspiciousImports.length === 0) {
    score = 0;
    reason = 'All imports reference known project dependencies.';
  } else if (suspiciousImports.length === 1 && suspiciousRate < 0.2) {
    score = 25;
    reason = `One potentially hallucinated import: \`${suspiciousImports[0].module}\` in ${suspiciousImports[0].file}. This module is not listed in the project dependencies.`;
  } else if (suspiciousRate < 0.3) {
    score = 55;
    const modules = [...new Set(suspiciousImports.map((si) => si.module))];
    reason = `${suspiciousImports.length} import(s) reference modules not in project dependencies: ${modules.slice(0, 5).join(', ')}.`;
  } else {
    score = 90;
    const modules = [...new Set(suspiciousImports.map((si) => si.module))];
    reason = `${suspiciousImports.length} of ${totalImports} imports (${(suspiciousRate * 100).toFixed(0)}%) reference unknown modules: ${modules.slice(0, 5).join(', ')}. Strongly suggests hallucinated dependencies.`;
  }

  return { name: 'hallucinated_import', score, reason };
}

/**
 * Docstring inflation check: Flag PRs where the ratio of comments/docstrings
 * to actual code is unreasonably high (> 60%).
 */
export function docstringInflationCheck(files: PRFile[]): CheckResult {
  let totalCommentLines = 0;
  let totalCodeLines = 0;

  // Comment patterns
  const singleLineComment = /^\+\s*(\/\/|#|--|;)\s/;
  const blockCommentStart = /^\+\s*(\/\*|\*|"""|'''|<!--)/;
  const blockCommentEnd = /(\*\/|"""|'''|-->)\s*$/;
  const docstringLine = /^\+\s*\*\s/;
  const emptyLine = /^\+\s*$/;

  for (const file of files) {
    if (!file.patch) continue;

    const lines = file.patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'));

    for (const line of lines) {
      if (emptyLine.test(line)) {
        continue; // Skip empty lines
      }

      if (
        singleLineComment.test(line) ||
        blockCommentStart.test(line) ||
        blockCommentEnd.test(line) ||
        docstringLine.test(line)
      ) {
        totalCommentLines++;
      } else {
        totalCodeLines++;
      }
    }
  }

  const totalLines = totalCommentLines + totalCodeLines;

  logger.debug(
    `Docstring inflation: ${totalCommentLines} comment lines, ${totalCodeLines} code lines`
  );

  if (totalLines < 10) {
    return {
      name: 'docstring_inflation',
      score: 0,
      reason: 'Too few lines to assess comment ratio.',
    };
  }

  const commentRatio = totalCommentLines / totalLines;

  let score = 0;
  let reason = '';

  if (commentRatio <= 0.3) {
    score = 0;
    reason = `Healthy comment ratio: ${(commentRatio * 100).toFixed(0)}% comments (${totalCommentLines}/${totalLines} lines).`;
  } else if (commentRatio <= 0.45) {
    score = 15;
    reason = `Above-average comment ratio: ${(commentRatio * 100).toFixed(0)}%. Well-documented code is fine, but AI-generated code often over-documents trivial logic.`;
  } else if (commentRatio <= 0.6) {
    score = 45;
    reason = `High comment ratio: ${(commentRatio * 100).toFixed(0)}% of added lines are comments (${totalCommentLines}/${totalLines}). Often a sign of AI-generated code padding.`;
  } else if (commentRatio <= 0.75) {
    score = 75;
    reason = `Excessive commenting: ${(commentRatio * 100).toFixed(0)}% of the PR is comments/docstrings. AI tools frequently generate verbose comments to pad otherwise thin contributions.`;
  } else {
    score = 95;
    reason = `Extreme comment inflation: ${(commentRatio * 100).toFixed(0)}% comments. This PR is mostly documentation with minimal actual code.`;
  }

  return { name: 'docstring_inflation', score, reason };
}

/**
 * Copy-paste check: Detect large blocks of identical code within the diff.
 */
export function copyPasteCheck(files: PRFile[]): CheckResult {
  // Collect all added code blocks (groups of consecutive added lines)
  const codeBlocks: Array<{ file: string; block: string; lineCount: number }> = [];

  for (const file of files) {
    if (!file.patch) continue;

    const lines = file.patch.split('\n');
    let currentBlock: string[] = [];

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const cleanLine = line.substring(1).trim();
        if (cleanLine.length > 0) {
          currentBlock.push(cleanLine);
        }
      } else {
        if (currentBlock.length >= 4) {
          codeBlocks.push({
            file: file.filename,
            block: currentBlock.join('\n'),
            lineCount: currentBlock.length,
          });
        }
        currentBlock = [];
      }
    }

    // Don't forget the last block
    if (currentBlock.length >= 4) {
      codeBlocks.push({
        file: file.filename,
        block: currentBlock.join('\n'),
        lineCount: currentBlock.length,
      });
    }
  }

  // Compare blocks for similarity
  let duplicateCount = 0;
  let duplicatedLines = 0;
  const duplicatePairs: Array<{ fileA: string; fileB: string }> = [];

  for (let i = 0; i < codeBlocks.length; i++) {
    for (let j = i + 1; j < codeBlocks.length; j++) {
      const a = codeBlocks[i];
      const b = codeBlocks[j];

      // Quick length check
      if (
        Math.min(a.lineCount, b.lineCount) <
        Math.max(a.lineCount, b.lineCount) * 0.7
      ) {
        continue;
      }

      // Normalize and compare
      const normalizedA = normalizeCode(a.block);
      const normalizedB = normalizeCode(b.block);

      if (normalizedA === normalizedB && normalizedA.length > 50) {
        duplicateCount++;
        duplicatedLines += Math.min(a.lineCount, b.lineCount);
        duplicatePairs.push({ fileA: a.file, fileB: b.file });
      }
    }
  }

  logger.debug(
    `Copy-paste check: ${duplicateCount} duplicate block(s), ${duplicatedLines} duplicated lines`
  );

  let score = 0;
  let reason = '';

  if (duplicateCount === 0) {
    score = 0;
    reason = 'No internal code duplication detected.';
  } else if (duplicateCount === 1 && duplicatedLines < 15) {
    score = 20;
    const pair = duplicatePairs[0];
    reason = `Minor duplication: 1 repeated block (~${duplicatedLines} lines) between ${pair.fileA} and ${pair.fileB}.`;
  } else if (duplicateCount <= 3) {
    score = 50;
    reason = `${duplicateCount} duplicated code blocks found (~${duplicatedLines} lines total). AI-generated PRs often contain copy-pasted code with minimal variation.`;
  } else {
    score = 85;
    reason = `Significant internal duplication: ${duplicateCount} repeated blocks (~${duplicatedLines} lines). This is a strong indicator of bulk-generated code.`;
  }

  return { name: 'copy_paste', score, reason };
}

/**
 * Parse dependency names from a package.json string.
 */
export function parseDepsFromPackageJson(content: string): Set<string> {
  const deps = new Set<string>();
  try {
    const pkg = JSON.parse(content);
    if (pkg.dependencies) {
      Object.keys(pkg.dependencies).forEach((d) => deps.add(d));
    }
    if (pkg.devDependencies) {
      Object.keys(pkg.devDependencies).forEach((d) => deps.add(d));
    }
    if (pkg.peerDependencies) {
      Object.keys(pkg.peerDependencies).forEach((d) => deps.add(d));
    }
  } catch {
    // Invalid JSON
  }
  return deps;
}

/**
 * Parse dependency names from a requirements.txt string.
 */
export function parseDepsFromRequirements(content: string): Set<string> {
  const deps = new Set<string>();
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
      // Extract package name (before any version specifier)
      const name = trimmed.split(/[>=<!~\s\[]/)[0].toLowerCase();
      if (name) {
        deps.add(name);
      }
    }
  }
  return deps;
}

/**
 * Parse dependency names from a Cargo.toml string.
 */
export function parseDepsFromCargoToml(content: string): Set<string> {
  const deps = new Set<string>();
  const lines = content.split('\n');
  let inDepSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for section headers
    if (trimmed.startsWith('[')) {
      inDepSection = /^\[(?:dev-)?dependencies(?:\.[^\]]+)?\]/.test(trimmed);
      continue;
    }

    if (inDepSection) {
      const depMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*=/);
      if (depMatch) {
        deps.add(depMatch[1]);
      }
    }
  }

  return deps;
}

/**
 * Normalize code for comparison (remove whitespace variations, comments, etc.)
 */
function normalizeCode(code: string): string {
  return code
    .replace(/\/\/.*$/gm, '')     // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/#.*$/gm, '')         // Remove hash comments
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim();
}
