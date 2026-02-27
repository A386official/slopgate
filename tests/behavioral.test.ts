import { describe, it, expect } from 'vitest';
import {
  velocityCheck,
  abandonmentCheck,
  shotgunCheck,
  newAccountCheck,
  levenshteinSimilarity,
} from '../src/checks/behavioral';
import type { ContributorPR, PullRequestData } from '../src/github';

function makePR(overrides: Partial<ContributorPR> = {}): ContributorPR {
  return {
    number: 1,
    title: 'Fix something',
    body: 'A fix for a bug',
    state: 'open',
    created_at: new Date().toISOString(),
    closed_at: null,
    merged_at: null,
    repository_url: 'https://api.github.com/repos/owner/repo',
    ...overrides,
  };
}

function makePRData(overrides: Partial<PullRequestData> = {}): PullRequestData {
  return {
    number: 1,
    title: 'Fix authentication bug in login flow',
    body: 'This fixes the login issue by correcting the token validation logic.',
    user: {
      login: 'contributor',
      type: 'User',
      created_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    },
    created_at: new Date().toISOString(),
    changed_files: 3,
    additions: 50,
    deletions: 20,
    head: { ref: 'fix-login', sha: 'abc123' },
    base: { ref: 'main' },
    ...overrides,
  };
}

// ============================================================
// velocityCheck
// ============================================================
describe('velocityCheck', () => {
  it('should return score 0 for 0 PRs in 24h', () => {
    const result = velocityCheck([]);
    expect(result.name).toBe('velocity');
    expect(result.score).toBe(0);
  });

  it('should return score 0 for 1-3 PRs in 24h', () => {
    const prs = [makePR(), makePR({ number: 2 }), makePR({ number: 3 })];
    const result = velocityCheck(prs);
    expect(result.score).toBe(0);
  });

  it('should return score 50 for 4-5 PRs in 24h', () => {
    const prs = Array.from({ length: 4 }, (_, i) => makePR({ number: i + 1 }));
    const result = velocityCheck(prs);
    expect(result.score).toBe(50);
  });

  it('should return score 80 for 6-10 PRs in 24h', () => {
    const prs = Array.from({ length: 7 }, (_, i) => makePR({ number: i + 1 }));
    const result = velocityCheck(prs);
    expect(result.score).toBe(80);
  });

  it('should return score 100 for >10 PRs in 24h', () => {
    const prs = Array.from({ length: 15 }, (_, i) => makePR({ number: i + 1 }));
    const result = velocityCheck(prs);
    expect(result.score).toBe(100);
  });

  it('should ignore PRs older than 24 hours', () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const prs = Array.from({ length: 10 }, (_, i) =>
      makePR({ number: i + 1, created_at: oldDate })
    );
    const result = velocityCheck(prs);
    expect(result.score).toBe(0);
  });
});

// ============================================================
// abandonmentCheck
// ============================================================
describe('abandonmentCheck', () => {
  it('should return score 0 for insufficient history (< 3 PRs)', () => {
    const result = abandonmentCheck({ total: 2, abandoned: 1, rate: 50 });
    expect(result.score).toBe(0);
    expect(result.reason).toContain('Insufficient');
  });

  it('should return score 0 for low abandonment rate', () => {
    const result = abandonmentCheck({ total: 10, abandoned: 2, rate: 20 });
    expect(result.score).toBe(0);
  });

  it('should return score 25 for moderate abandonment (31-50%)', () => {
    const result = abandonmentCheck({ total: 10, abandoned: 4, rate: 40 });
    expect(result.score).toBe(25);
  });

  it('should return score 50 for elevated abandonment (51-70%)', () => {
    const result = abandonmentCheck({ total: 10, abandoned: 6, rate: 60 });
    expect(result.score).toBe(50);
  });

  it('should return score 80 for high abandonment (71-90%)', () => {
    const result = abandonmentCheck({ total: 10, abandoned: 8, rate: 80 });
    expect(result.score).toBe(80);
  });

  it('should return score 100 for near-total abandonment (>90%)', () => {
    const result = abandonmentCheck({ total: 10, abandoned: 10, rate: 100 });
    expect(result.score).toBe(100);
  });
});

// ============================================================
// shotgunCheck
// ============================================================
describe('shotgunCheck', () => {
  it('should return score 0 when no other PRs found', () => {
    const pr = makePRData();
    const result = shotgunCheck(pr, []);
    expect(result.score).toBe(0);
    expect(result.reason).toContain('No other');
  });

  it('should return score 0 for unique title/body', () => {
    const pr = makePRData({ title: 'Unique fix for login auth' });
    const otherPRs = [
      makePR({ number: 2, title: 'Add dark mode toggle' }),
      makePR({ number: 3, title: 'Refactor database queries' }),
    ];
    const result = shotgunCheck(pr, otherPRs);
    expect(result.score).toBe(0);
  });

  it('should return high score for identical titles across repos', () => {
    const pr = makePRData({ title: 'Fix bug in code' });
    const otherPRs = Array.from({ length: 5 }, (_, i) =>
      makePR({ number: i + 2, title: 'Fix bug in code' })
    );
    const result = shotgunCheck(pr, otherPRs);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('should detect near-identical titles', () => {
    const pr = makePRData({ title: 'Fix typo in readme' });
    const otherPRs = [
      makePR({ number: 2, title: 'Fix typo in readme' }),
      makePR({ number: 3, title: 'Fix typo in readme' }),
      makePR({ number: 4, title: 'Fix typo in readme' }),
    ];
    const result = shotgunCheck(pr, otherPRs);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('should not flag the current PR against itself', () => {
    const pr = makePRData({ number: 1, title: 'Fix bug' });
    const prs = [makePR({ number: 1, title: 'Fix bug' })];
    const result = shotgunCheck(pr, prs);
    expect(result.score).toBe(0);
  });
});

// ============================================================
// newAccountCheck
// ============================================================
describe('newAccountCheck', () => {
  it('should return score 0 for accounts older than 30 days', () => {
    const pr = makePRData({
      user: {
        login: 'user',
        type: 'User',
        created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    const result = newAccountCheck(pr, []);
    expect(result.score).toBe(0);
  });

  it('should return score 10 for new account with prior PRs', () => {
    const pr = makePRData({
      number: 5,
      user: {
        login: 'user',
        type: 'User',
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    const priorPRs = [makePR({ number: 3 }), makePR({ number: 4 })];
    const result = newAccountCheck(pr, priorPRs);
    expect(result.score).toBe(10);
  });

  it('should return score 70 for brand new account (< 7 days) first PR', () => {
    const pr = makePRData({
      user: {
        login: 'user',
        type: 'User',
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    const result = newAccountCheck(pr, []);
    expect(result.score).toBe(70);
  });

  it('should return score 50 for 7-14 day old account first PR', () => {
    const pr = makePRData({
      user: {
        login: 'user',
        type: 'User',
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    const result = newAccountCheck(pr, []);
    expect(result.score).toBe(50);
  });

  it('should return score 30 for 14-30 day old account first PR', () => {
    const pr = makePRData({
      user: {
        login: 'user',
        type: 'User',
        created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    const result = newAccountCheck(pr, []);
    expect(result.score).toBe(30);
  });
});

// ============================================================
// levenshteinSimilarity
// ============================================================
describe('levenshteinSimilarity', () => {
  it('should return 1 for identical strings', () => {
    expect(levenshteinSimilarity('hello', 'hello')).toBe(1);
  });

  it('should return 0 for empty vs non-empty', () => {
    expect(levenshteinSimilarity('', 'hello')).toBe(0);
    expect(levenshteinSimilarity('hello', '')).toBe(0);
  });

  it('should return high similarity for similar strings', () => {
    const sim = levenshteinSimilarity('fix typo in readme', 'fix typo in readm');
    expect(sim).toBeGreaterThan(0.9);
  });

  it('should return low similarity for very different strings', () => {
    const sim = levenshteinSimilarity('hello world', 'goodbye universe');
    expect(sim).toBeLessThan(0.5);
  });
});
