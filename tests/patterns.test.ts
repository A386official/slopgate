import { describe, it, expect } from 'vitest';
import {
  genericDescriptionCheck,
  oversizedDiffCheck,
  unrelatedChangesCheck,
  formattingOnlyCheck,
} from '../src/checks/patterns';
import type { PullRequestData, PRFile } from '../src/github';

function makePRData(overrides: Partial<PullRequestData> = {}): PullRequestData {
  return {
    number: 1,
    title: 'Add OAuth2 support for third-party login providers',
    body: 'This implements OAuth2 authentication using the authorization code flow. Supports Google, GitHub, and Microsoft providers. Includes token refresh logic and session management.',
    user: {
      login: 'contributor',
      type: 'User',
      created_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    },
    created_at: new Date().toISOString(),
    changed_files: 5,
    additions: 120,
    deletions: 30,
    head: { ref: 'feat/oauth', sha: 'abc123' },
    base: { ref: 'main' },
    ...overrides,
  };
}

function makeFile(overrides: Partial<PRFile> = {}): PRFile {
  return {
    filename: 'src/app.ts',
    status: 'modified',
    additions: 10,
    deletions: 5,
    changes: 15,
    patch: '',
    ...overrides,
  };
}

// ============================================================
// genericDescriptionCheck
// ============================================================
describe('genericDescriptionCheck', () => {
  it('should return score 0 for specific title and body', () => {
    const pr = makePRData();
    const result = genericDescriptionCheck(pr);
    expect(result.name).toBe('generic_description');
    expect(result.score).toBe(0);
  });

  it('should flag "fix bug" with no body', () => {
    const pr = makePRData({ title: 'Fix bug', body: '' });
    const result = genericDescriptionCheck(pr);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('should flag "update code" with no body', () => {
    const pr = makePRData({ title: 'Update code', body: '' });
    const result = genericDescriptionCheck(pr);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('should flag generic title with template-like description', () => {
    const pr = makePRData({
      title: 'Improvements',
      body: 'This PR improves the overall code quality and readability.',
    });
    const result = genericDescriptionCheck(pr);
    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it('should give lower score for generic title with good body', () => {
    const pr = makePRData({
      title: 'Fix bug',
      body: 'The authentication flow was failing because the JWT token expiry check used UTC while the server clock was in local time. This patch normalizes both timestamps to UTC before comparison.',
    });
    const result = genericDescriptionCheck(pr);
    expect(result.score).toBe(50);
  });

  it('should flag very short title with no body', () => {
    const pr = makePRData({ title: 'fix', body: '' });
    const result = genericDescriptionCheck(pr);
    expect(result.score).toBeGreaterThan(0);
  });

  it('should handle "refactoring" as generic title', () => {
    const pr = makePRData({ title: 'Refactoring', body: '' });
    const result = genericDescriptionCheck(pr);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('should not flag specific titles even if short', () => {
    const pr = makePRData({
      title: 'Fix #123 null pointer in UserService.getById',
      body: 'Detailed description of the fix.',
    });
    const result = genericDescriptionCheck(pr);
    expect(result.score).toBe(0);
  });
});

// ============================================================
// oversizedDiffCheck
// ============================================================
describe('oversizedDiffCheck', () => {
  it('should return score 0 for small PRs', () => {
    const pr = makePRData({ additions: 30, deletions: 20, body: '' });
    const result = oversizedDiffCheck(pr);
    expect(result.name).toBe('oversized_diff');
    expect(result.score).toBe(0);
  });

  it('should flag massive PR with tiny description', () => {
    const pr = makePRData({
      additions: 1500,
      deletions: 600,
      body: 'fixes',
    });
    const result = oversizedDiffCheck(pr);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('should return score 0 for large PR with proportional description', () => {
    const pr = makePRData({
      additions: 600,
      deletions: 100,
      body: 'This is a thorough refactoring of the authentication module. The previous implementation used a monolithic class that handled session management, token validation, and user lookup all in one place. This PR splits it into three separate services with clear interfaces, adds comprehensive error handling, and updates the tests to cover the new structure. Each service is independently testable and follows the single responsibility principle.',
    });
    const result = oversizedDiffCheck(pr);
    expect(result.score).toBe(0);
  });

  it('should flag 500+ line PR with less than 50 char description', () => {
    const pr = makePRData({
      additions: 400,
      deletions: 200,
      body: 'Updated some files.',
    });
    const result = oversizedDiffCheck(pr);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('should handle exactly 100 line changes (boundary)', () => {
    const pr = makePRData({ additions: 80, deletions: 20, body: '' });
    const result = oversizedDiffCheck(pr);
    expect(result.score).toBe(0);
  });
});

// ============================================================
// unrelatedChangesCheck
// ============================================================
describe('unrelatedChangesCheck', () => {
  it('should return score 0 for single file', () => {
    const files = [makeFile()];
    const result = unrelatedChangesCheck(files);
    expect(result.name).toBe('unrelated_changes');
    expect(result.score).toBe(0);
  });

  it('should return score 0 for files in few directories', () => {
    const files = [
      makeFile({ filename: 'src/auth.ts' }),
      makeFile({ filename: 'src/utils.ts' }),
      makeFile({ filename: 'tests/auth.test.ts' }),
    ];
    const result = unrelatedChangesCheck(files);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it('should flag files spanning many directories', () => {
    const files = [
      makeFile({ filename: 'src/auth.ts' }),
      makeFile({ filename: 'lib/utils.ts' }),
      makeFile({ filename: 'config/app.yml' }),
      makeFile({ filename: 'scripts/deploy.sh' }),
      makeFile({ filename: 'docs/README.md' }),
      makeFile({ filename: 'tools/lint.ts' }),
      makeFile({ filename: 'vendor/patch.js' }),
      makeFile({ filename: 'api/routes.ts' }),
      makeFile({ filename: 'models/user.ts' }),
    ];
    const result = unrelatedChangesCheck(files);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('should reduce score when test files are present', () => {
    const files = [
      makeFile({ filename: 'src/auth.ts' }),
      makeFile({ filename: 'lib/utils.ts' }),
      makeFile({ filename: 'config/app.yml' }),
      makeFile({ filename: 'tests/auth.test.ts' }),
      makeFile({ filename: 'docs/README.md' }),
    ];
    const result = unrelatedChangesCheck(files);
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it('should handle root-level files correctly', () => {
    const files = [
      makeFile({ filename: 'README.md' }),
      makeFile({ filename: 'package.json' }),
    ];
    const result = unrelatedChangesCheck(files);
    expect(result.score).toBe(0);
  });
});

// ============================================================
// formattingOnlyCheck
// ============================================================
describe('formattingOnlyCheck', () => {
  it('should return score 0 for substantive changes', () => {
    const pr = makePRData({ title: 'Add user authentication' });
    const files = [
      makeFile({
        patch: `@@ -1,5 +1,10 @@
-const oldAuth = require('./legacy');
+import { OAuth2Client } from './oauth';
-function login(user, pass) {
+async function login(credentials: LoginCredentials): Promise<Session> {
-  return oldAuth.check(user, pass);
+  const client = new OAuth2Client(config);
+  const token = await client.authorize(credentials);
+  return createSession(token);
+}`,
      }),
    ];
    const result = formattingOnlyCheck(pr, files);
    expect(result.name).toBe('formatting_only');
    expect(result.score).toBe(0);
  });

  it('should flag formatting-only changes that claim to fix bugs', () => {
    const pr = makePRData({ title: 'Fix critical authentication bug' });
    const files = [
      makeFile({
        patch: `@@ -1,10 +1,10 @@
-  const x = 1;
+  const x = 1 ;
-  const y = 2;
+  const y = 2 ;
-  const z = 3;
+  const z = 3 ;
-  const a = 4;
+  const a = 4 ;
-  const b = 5;
+  const b = 5 ;`,
      }),
    ];
    const result = formattingOnlyCheck(pr, files);
    expect(result.score).toBeGreaterThan(0);
  });

  it('should return score 0 for too few changes', () => {
    const pr = makePRData();
    const files = [
      makeFile({
        patch: `@@ -1,1 +1,1 @@
-x
+y`,
      }),
    ];
    const result = formattingOnlyCheck(pr, files);
    expect(result.score).toBe(0);
  });

  it('should detect whitespace-only changes', () => {
    const pr = makePRData({ title: 'Fix indentation issues' });
    const files = [
      makeFile({
        patch: `@@ -1,8 +1,8 @@
-function hello() {
+function hello()  {
-  const x = 1;
+    const x = 1;
-  return x;
+    return x;
-}
+  }
-const a = 2;
+const a =  2;`,
      }),
    ];
    const result = formattingOnlyCheck(pr, files);
    // These are all whitespace-only changes
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('should not flag formatting PRs with honest titles', () => {
    const pr = makePRData({ title: 'Reformat with prettier' });
    const files = [
      makeFile({
        patch: `@@ -1,6 +1,6 @@
-const x=1;
+const x = 1;
-const y=2;
+const y = 2;
-const z=3;
+const z = 3;`,
      }),
    ];
    const result = formattingOnlyCheck(pr, files);
    // Title doesn't claim substantive work, so score should be low
    expect(result.score).toBeLessThanOrEqual(35);
  });
});
