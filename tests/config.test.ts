import { describe, it, expect } from 'vitest';
import {
  parseConfig,
  loadConfig,
  isAllowlisted,
  DEFAULT_CONFIG,
} from '../src/config';

// ============================================================
// DEFAULT_CONFIG
// ============================================================
describe('DEFAULT_CONFIG', () => {
  it('should have default thresholds', () => {
    expect(DEFAULT_CONFIG.thresholds.warn).toBe(30);
    expect(DEFAULT_CONFIG.thresholds.flag).toBe(60);
    expect(DEFAULT_CONFIG.thresholds.block).toBe(80);
  });

  it('should have auto_close disabled by default', () => {
    expect(DEFAULT_CONFIG.auto_close).toBe(false);
  });

  it('should have default weights for all checks', () => {
    expect(DEFAULT_CONFIG.weights.velocity).toBe(80);
    expect(DEFAULT_CONFIG.weights.abandonment).toBe(60);
    expect(DEFAULT_CONFIG.weights.shotgun).toBe(90);
    expect(DEFAULT_CONFIG.weights.new_account).toBe(20);
    expect(DEFAULT_CONFIG.weights.placeholder).toBe(70);
    expect(DEFAULT_CONFIG.weights.hallucinated_import).toBe(90);
    expect(DEFAULT_CONFIG.weights.docstring_inflation).toBe(40);
    expect(DEFAULT_CONFIG.weights.copy_paste).toBe(60);
    expect(DEFAULT_CONFIG.weights.generic_description).toBe(50);
    expect(DEFAULT_CONFIG.weights.oversized_diff).toBe(60);
    expect(DEFAULT_CONFIG.weights.unrelated_changes).toBe(40);
    expect(DEFAULT_CONFIG.weights.formatting_only).toBe(30);
  });

  it('should have default bot allowlist', () => {
    expect(DEFAULT_CONFIG.allowlist.bots).toContain('dependabot[bot]');
    expect(DEFAULT_CONFIG.allowlist.bots).toContain('renovate[bot]');
    expect(DEFAULT_CONFIG.allowlist.bots).toContain('github-actions[bot]');
  });

  it('should have empty user allowlist by default', () => {
    expect(DEFAULT_CONFIG.allowlist.users).toEqual([]);
  });
});

// ============================================================
// parseConfig
// ============================================================
describe('parseConfig', () => {
  it('should parse valid YAML config', () => {
    const yaml = `
thresholds:
  warn: 25
  flag: 50
  block: 75
auto_close: true
`;
    const config = parseConfig(yaml);
    expect(config.thresholds.warn).toBe(25);
    expect(config.thresholds.flag).toBe(50);
    expect(config.thresholds.block).toBe(75);
    expect(config.auto_close).toBe(true);
  });

  it('should fill missing fields with defaults', () => {
    const yaml = `
thresholds:
  warn: 20
`;
    const config = parseConfig(yaml);
    expect(config.thresholds.warn).toBe(20);
    expect(config.thresholds.flag).toBe(60);
    expect(config.thresholds.block).toBe(80);
    expect(config.auto_close).toBe(false);
  });

  it('should return defaults for empty YAML', () => {
    const config = parseConfig('');
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should return defaults for null-like YAML', () => {
    const config = parseConfig('null');
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should parse custom weights', () => {
    const yaml = `
weights:
  velocity: 0
  shotgun: 100
`;
    const config = parseConfig(yaml);
    expect(config.weights.velocity).toBe(0);
    expect(config.weights.shotgun).toBe(100);
    expect(config.weights.placeholder).toBe(70); // default
  });

  it('should parse custom allowlist', () => {
    const yaml = `
allowlist:
  users:
    - trusted-user
    - another-user
  bots:
    - my-bot[bot]
`;
    const config = parseConfig(yaml);
    expect(config.allowlist.users).toContain('trusted-user');
    expect(config.allowlist.users).toContain('another-user');
    expect(config.allowlist.bots).toContain('my-bot[bot]');
  });
});

// ============================================================
// loadConfig
// ============================================================
describe('loadConfig', () => {
  it('should return defaults for null input', () => {
    const config = loadConfig(null);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should return defaults for empty string', () => {
    const config = loadConfig('');
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should return defaults for whitespace-only string', () => {
    const config = loadConfig('   \n  \n  ');
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should return defaults for invalid YAML', () => {
    const config = loadConfig('[[[invalid yaml!!!');
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('should parse valid YAML content', () => {
    const config = loadConfig('auto_close: true');
    expect(config.auto_close).toBe(true);
  });
});

// ============================================================
// isAllowlisted
// ============================================================
describe('isAllowlisted', () => {
  it('should return false for unknown users', () => {
    expect(isAllowlisted(DEFAULT_CONFIG, 'random-user')).toBe(false);
  });

  it('should return true for allowlisted bots', () => {
    expect(isAllowlisted(DEFAULT_CONFIG, 'dependabot[bot]', true)).toBe(true);
    expect(isAllowlisted(DEFAULT_CONFIG, 'renovate[bot]', true)).toBe(true);
  });

  it('should not match bot names if isBot is false', () => {
    expect(isAllowlisted(DEFAULT_CONFIG, 'dependabot[bot]', false)).toBe(false);
  });

  it('should return true for allowlisted users', () => {
    const config = parseConfig(`
allowlist:
  users:
    - trusted-contributor
`);
    expect(isAllowlisted(config, 'trusted-contributor')).toBe(true);
  });

  it('should match users regardless of isBot flag', () => {
    const config = parseConfig(`
allowlist:
  users:
    - my-user
`);
    expect(isAllowlisted(config, 'my-user', false)).toBe(true);
    expect(isAllowlisted(config, 'my-user', true)).toBe(true);
  });

  it('should return false for non-allowlisted bots', () => {
    expect(isAllowlisted(DEFAULT_CONFIG, 'random-bot[bot]', true)).toBe(false);
  });
});
