import { describe, it, expect } from 'vitest';
import {
  placeholderCheck,
  hallucinatedImportCheck,
  docstringInflationCheck,
  copyPasteCheck,
  parseDepsFromPackageJson,
  parseDepsFromRequirements,
  parseDepsFromCargoToml,
} from '../src/checks/content';
import type { PRFile } from '../src/github';

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
// placeholderCheck
// ============================================================
describe('placeholderCheck', () => {
  it('should return score 0 for clean code', () => {
    const files = [
      makeFile({
        patch: `@@ -1,5 +1,10 @@
+import { Router } from 'express';
+const router = Router();
+router.get('/health', (req, res) => {
+  res.json({ status: 'ok', timestamp: Date.now() });
+});
+export default router;`,
      }),
    ];
    const result = placeholderCheck(files);
    expect(result.score).toBe(0);
  });

  it('should detect empty function bodies', () => {
    const files = [
      makeFile({
        patch: `@@ -1,5 +1,20 @@
+function handleAuth() { }
+function processPayment() { }
+function validateInput() { }
+function sendNotification() { }
+function parseConfig() { }
+function initDatabase() { }
+const a = 1;`,
      }),
    ];
    const result = placeholderCheck(files);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reason).toContain('empty function');
  });

  it('should detect TODO comments without context', () => {
    const files = [
      makeFile({
        patch: `@@ -1,5 +1,10 @@
+// TODO
+const x = 1;
+// TODO
+const y = 2;
+// TODO
+const z = 3;`,
      }),
    ];
    const result = placeholderCheck(files);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reason).toContain('TODO');
  });

  it('should detect bare pass statements in Python', () => {
    const files = [
      makeFile({
        filename: 'app.py',
        patch: `@@ -1,5 +1,10 @@
+def handle_auth():
+    pass
+def process():
+    pass
+def validate():
+    pass`,
      }),
    ];
    const result = placeholderCheck(files);
    expect(result.score).toBeGreaterThan(0);
  });

  it('should detect placeholder variable names', () => {
    const files = [
      makeFile({
        patch: `@@ -1,5 +1,10 @@
+const foo = 1;
+const bar = 2;
+const baz = 3;
+const temp1 = 4;
+const test123 = 5;
+const dummy = 6;
+const placeholder = 7;
+const sample = 8;`,
      }),
    ];
    const result = placeholderCheck(files);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reason).toContain('placeholder');
  });

  it('should return score 0 when no patch data', () => {
    const files = [makeFile({ patch: undefined })];
    const result = placeholderCheck(files);
    expect(result.score).toBe(0);
  });

  it('should handle empty file list', () => {
    const result = placeholderCheck([]);
    expect(result.score).toBe(0);
  });
});

// ============================================================
// hallucinatedImportCheck
// ============================================================
describe('hallucinatedImportCheck', () => {
  it('should return score 0 when all imports are known deps', () => {
    const files = [
      makeFile({
        patch: `@@ -1,3 +1,5 @@
+import express from 'express';
+import { z } from 'zod';`,
      }),
    ];
    const deps = new Set(['express', 'zod']);
    const result = hallucinatedImportCheck(files, deps);
    expect(result.score).toBe(0);
  });

  it('should flag unknown imports', () => {
    const files = [
      makeFile({
        patch: `@@ -1,3 +1,5 @@
+import { magic } from 'nonexistent-package';
+import hallucinatedLib from 'fake-dependency';
+import another from 'does-not-exist';
+import more from 'imaginary-lib';`,
      }),
    ];
    const deps = new Set(['express']);
    const result = hallucinatedImportCheck(files, deps);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reason).toContain('nonexistent-package');
  });

  it('should ignore Node.js built-in modules', () => {
    const files = [
      makeFile({
        patch: `@@ -1,3 +1,5 @@
+import * as fs from 'fs';
+import * as path from 'path';
+import { createServer } from 'http';`,
      }),
    ];
    const deps = new Set<string>();
    const result = hallucinatedImportCheck(files, deps);
    expect(result.score).toBe(0);
  });

  it('should handle scoped packages', () => {
    const files = [
      makeFile({
        patch: `@@ -1,3 +1,5 @@
+import * as core from '@actions/core';
+import { Octokit } from '@octokit/rest';`,
      }),
    ];
    const deps = new Set(['@actions/core', '@octokit/rest']);
    const result = hallucinatedImportCheck(files, deps);
    expect(result.score).toBe(0);
  });

  it('should return score 0 when no imports found', () => {
    const files = [
      makeFile({
        patch: `@@ -1,3 +1,5 @@
+const x = 1;
+console.log(x);`,
      }),
    ];
    const deps = new Set<string>();
    const result = hallucinatedImportCheck(files, deps);
    expect(result.score).toBe(0);
  });

  it('should handle require() imports', () => {
    const files = [
      makeFile({
        patch: `@@ -1,3 +1,5 @@
+const express = require('express');
+const fake = require('nonexistent-module');`,
      }),
    ];
    const deps = new Set(['express']);
    const result = hallucinatedImportCheck(files, deps);
    expect(result.score).toBeGreaterThan(0);
  });
});

// ============================================================
// docstringInflationCheck
// ============================================================
describe('docstringInflationCheck', () => {
  it('should return score 0 for balanced code and comments', () => {
    const files = [
      makeFile({
        patch: `@@ -1,5 +1,20 @@
+// Initialize the server
+const app = express();
+app.use(cors());
+app.use(json());
+const port = process.env.PORT || 3000;
+app.get('/', handler);
+app.post('/api', apiHandler);
+app.listen(port);
+console.log('Server started');
+export default app;`,
      }),
    ];
    const result = docstringInflationCheck(files);
    expect(result.score).toBeLessThanOrEqual(15);
  });

  it('should flag excessive comments', () => {
    const files = [
      makeFile({
        patch: `@@ -1,5 +1,20 @@
+// This function handles authentication
+// It takes a username and password
+// And validates them against the database
+// Then returns a JWT token
+// If the credentials are invalid, it throws an error
+// The token expires after 24 hours
+// This is important for security
+// We use bcrypt for password hashing
+// And jsonwebtoken for token generation
+// The function is async because it queries the database
+const x = authenticate();`,
      }),
    ];
    const result = docstringInflationCheck(files);
    expect(result.score).toBeGreaterThan(40);
  });

  it('should return score 0 for too few lines', () => {
    const files = [
      makeFile({
        patch: `@@ -1,1 +1,3 @@
+// comment
+code();`,
      }),
    ];
    const result = docstringInflationCheck(files);
    expect(result.score).toBe(0);
    expect(result.reason).toContain('Too few');
  });

  it('should handle files with only code', () => {
    const files = [
      makeFile({
        patch: `@@ -1,5 +1,15 @@
+const a = 1;
+const b = 2;
+const c = 3;
+const d = 4;
+const e = 5;
+const f = 6;
+const g = 7;
+const h = 8;
+const i = 9;
+const j = 10;`,
      }),
    ];
    const result = docstringInflationCheck(files);
    expect(result.score).toBe(0);
  });
});

// ============================================================
// copyPasteCheck
// ============================================================
describe('copyPasteCheck', () => {
  it('should return score 0 for no duplication', () => {
    const files = [
      makeFile({
        filename: 'a.ts',
        patch: `@@ -1,5 +1,10 @@
+function handleAuth() {
+  const token = getToken();
+  validateToken(token);
+  return createSession(token);
+}`,
      }),
      makeFile({
        filename: 'b.ts',
        patch: `@@ -1,5 +1,10 @@
+function processPayment() {
+  const amount = getAmount();
+  chargeCard(amount);
+  return receipt;
+}`,
      }),
    ];
    const result = copyPasteCheck(files);
    expect(result.score).toBe(0);
  });

  it('should detect duplicated code blocks', () => {
    const duplicatedBlock = `+  const config = loadConfig();
+  const db = connectDatabase(config.dbUrl);
+  const cache = initCache(config.cacheUrl);
+  const server = createServer(config, db, cache);
+  server.listen(config.port);
+  console.log('Started on port ' + config.port);`;

    const files = [
      makeFile({
        filename: 'a.ts',
        patch: `@@ -1,5 +1,10 @@
${duplicatedBlock}`,
      }),
      makeFile({
        filename: 'b.ts',
        patch: `@@ -1,5 +1,10 @@
${duplicatedBlock}`,
      }),
    ];
    const result = copyPasteCheck(files);
    expect(result.score).toBeGreaterThan(0);
  });

  it('should handle empty patches', () => {
    const files = [makeFile({ patch: '' }), makeFile({ patch: undefined })];
    const result = copyPasteCheck(files);
    expect(result.score).toBe(0);
  });
});

// ============================================================
// parseDepsFromPackageJson
// ============================================================
describe('parseDepsFromPackageJson', () => {
  it('should parse all dependency types', () => {
    const content = JSON.stringify({
      dependencies: { express: '4.18.0', cors: '2.8.5' },
      devDependencies: { vitest: '1.0.0', typescript: '5.0.0' },
      peerDependencies: { react: '18.0.0' },
    });
    const deps = parseDepsFromPackageJson(content);
    expect(deps.has('express')).toBe(true);
    expect(deps.has('cors')).toBe(true);
    expect(deps.has('vitest')).toBe(true);
    expect(deps.has('typescript')).toBe(true);
    expect(deps.has('react')).toBe(true);
  });

  it('should handle invalid JSON', () => {
    const deps = parseDepsFromPackageJson('not json');
    expect(deps.size).toBe(0);
  });

  it('should handle empty object', () => {
    const deps = parseDepsFromPackageJson('{}');
    expect(deps.size).toBe(0);
  });
});

// ============================================================
// parseDepsFromRequirements
// ============================================================
describe('parseDepsFromRequirements', () => {
  it('should parse requirements.txt', () => {
    const content = `flask>=2.0
requests==2.28.0
numpy
pandas>=1.5,<2.0
# comment
-e git+...`;
    const deps = parseDepsFromRequirements(content);
    expect(deps.has('flask')).toBe(true);
    expect(deps.has('requests')).toBe(true);
    expect(deps.has('numpy')).toBe(true);
    expect(deps.has('pandas')).toBe(true);
    expect(deps.size).toBe(4);
  });

  it('should handle empty content', () => {
    const deps = parseDepsFromRequirements('');
    expect(deps.size).toBe(0);
  });
});

// ============================================================
// parseDepsFromCargoToml
// ============================================================
describe('parseDepsFromCargoToml', () => {
  it('should parse Cargo.toml dependencies', () => {
    const content = `[package]
name = "myapp"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = { version = "1.0", features = ["full"] }
reqwest = "0.11"

[dev-dependencies]
mockall = "0.11"`;
    const deps = parseDepsFromCargoToml(content);
    expect(deps.has('serde')).toBe(true);
    expect(deps.has('tokio')).toBe(true);
    expect(deps.has('reqwest')).toBe(true);
    expect(deps.has('mockall')).toBe(true);
  });

  it('should handle empty content', () => {
    const deps = parseDepsFromCargoToml('');
    expect(deps.size).toBe(0);
  });
});
