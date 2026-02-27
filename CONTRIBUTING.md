# Contributing to SlopGate

Thanks for your interest in contributing to SlopGate. This document covers the basics.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/slopgate.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b my-feature`

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npx tsc --noEmit

# Build
npm run build
```

## Project Structure

```
src/
  index.ts              # GitHub Action entry point
  config.ts             # YAML config parsing and validation
  scoring.ts            # Weighted score aggregation
  respond.ts            # Labels, comments, and PR responses
  github.ts             # GitHub API wrapper
  checks/
    behavioral.ts       # Velocity, abandonment, shotgun, new account
    content.ts          # Placeholder, hallucinated imports, docstrings, duplication
    patterns.ts         # Generic description, oversized diff, unrelated changes, formatting
  utils/
    logger.ts           # Logging utility
tests/
  behavioral.test.ts    # Behavioral check tests
  content.test.ts       # Content check tests
  patterns.test.ts      # Pattern check tests
  scoring.test.ts       # Scoring system tests
  respond.test.ts       # Response system tests
  config.test.ts        # Configuration tests
```

## Adding a New Check

1. Create your check function in the appropriate file under `src/checks/`
2. The function must return a `CheckResult` with `name`, `score` (0-100), and `reason`
3. Add the check name to `CHECK_WEIGHT_MAP` in `src/scoring.ts`
4. Add a default weight to the `WeightsSchema` in `src/config.ts`
5. Add the check name to `formatCheckName` in `src/scoring.ts`
6. Call your check from `src/index.ts`
7. Write tests covering all score tiers and edge cases

## Writing Tests

- All tests go in the `tests/` directory
- Use vitest: `import { describe, it, expect } from 'vitest'`
- Name test files `<module>.test.ts`
- Cover normal cases, edge cases, and boundary conditions
- Each check should have tests for score 0 (clean) and elevated scores

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include tests for new functionality
- Ensure `npm test` and `npx tsc --noEmit` pass
- Write a clear title and description (SlopGate will analyze your PR too)

## Code Style

- TypeScript strict mode
- No `any` types unless absolutely necessary
- Functions should be pure where possible (checks take data in, return results)
- Use the logger utility instead of direct console calls

## Reporting Issues

- Check existing issues first
- Include reproduction steps
- If reporting a false positive/negative, include the PR that was misclassified

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
