/**
 * GitHub API wrapper for SlopGate.
 * Provides typed methods for all GitHub interactions needed by the action.
 */

import { Octokit } from '@octokit/rest';
import * as logger from './utils/logger';

export interface PullRequestData {
  number: number;
  title: string;
  body: string;
  user: {
    login: string;
    type: string; // "User" | "Bot" | "Organization"
    created_at: string;
  };
  created_at: string;
  changed_files: number;
  additions: number;
  deletions: number;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
}

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface ContributorPR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  repository_url: string;
}

export interface FileContent {
  content: string;
  encoding: string;
}

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * Get full pull request details.
   */
  async getPullRequest(prNumber: number): Promise<PullRequestData> {
    const { data } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    // Fetch user details for account creation date
    const { data: userData } = await this.octokit.users.getByUsername({
      username: data.user!.login,
    });

    return {
      number: data.number,
      title: data.title,
      body: data.body || '',
      user: {
        login: data.user!.login,
        type: data.user!.type,
        created_at: userData.created_at,
      },
      created_at: data.created_at,
      changed_files: data.changed_files,
      additions: data.additions,
      deletions: data.deletions,
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
      },
      base: {
        ref: data.base.ref,
      },
    };
  }

  /**
   * Get the list of files changed in a pull request.
   */
  async getPRFiles(prNumber: number): Promise<PRFile[]> {
    const files: PRFile[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const { data } = await this.octokit.pulls.listFiles({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: perPage,
        page,
      });

      for (const file of data) {
        files.push({
          filename: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
        });
      }

      if (data.length < perPage) break;
      page++;
    }

    return files;
  }

  /**
   * Get recent PRs opened by a specific user in this repository.
   */
  async getContributorRecentPRs(
    username: string,
    since: Date
  ): Promise<ContributorPR[]> {
    try {
      const { data } = await this.octokit.search.issuesAndPullRequests({
        q: `type:pr author:${username} repo:${this.owner}/${this.repo} created:>=${since.toISOString().split('T')[0]}`,
        sort: 'created',
        order: 'desc',
        per_page: 100,
      });

      return data.items.map((item) => ({
        number: item.number,
        title: item.title,
        body: item.body ?? null,
        state: item.state,
        created_at: item.created_at,
        closed_at: item.closed_at || null,
        merged_at: (item as Record<string, unknown>).pull_request
          ? ((item as Record<string, unknown>).pull_request as Record<string, unknown>).merged_at as string | null
          : null,
        repository_url: item.repository_url,
      }));
    } catch (err) {
      logger.warn(`Failed to fetch contributor PRs: ${err}`);
      return [];
    }
  }

  /**
   * Get all PRs by a user across all repos (public activity).
   */
  async getContributorPublicPRs(
    username: string,
    since: Date
  ): Promise<ContributorPR[]> {
    try {
      const { data } = await this.octokit.search.issuesAndPullRequests({
        q: `type:pr author:${username} created:>=${since.toISOString().split('T')[0]}`,
        sort: 'created',
        order: 'desc',
        per_page: 100,
      });

      return data.items.map((item) => ({
        number: item.number,
        title: item.title,
        body: item.body ?? null,
        state: item.state,
        created_at: item.created_at,
        closed_at: item.closed_at || null,
        merged_at: (item as Record<string, unknown>).pull_request
          ? ((item as Record<string, unknown>).pull_request as Record<string, unknown>).merged_at as string | null
          : null,
        repository_url: item.repository_url,
      }));
    } catch (err) {
      logger.warn(`Failed to fetch public PRs: ${err}`);
      return [];
    }
  }

  /**
   * Get the abandonment rate for a contributor's PRs in this repo.
   * Returns the percentage of closed (not merged) PRs.
   */
  async getContributorAbandonmentRate(username: string): Promise<{
    total: number;
    abandoned: number;
    rate: number;
  }> {
    try {
      const { data } = await this.octokit.search.issuesAndPullRequests({
        q: `type:pr author:${username} repo:${this.owner}/${this.repo} is:closed`,
        sort: 'created',
        order: 'desc',
        per_page: 100,
      });

      const total = data.total_count;
      if (total === 0) {
        return { total: 0, abandoned: 0, rate: 0 };
      }

      // Count PRs that were closed without being merged
      const abandoned = data.items.filter((item) => {
        const pr = item as Record<string, unknown>;
        const pullRequest = pr.pull_request as Record<string, unknown> | undefined;
        return !pullRequest?.merged_at;
      }).length;

      return {
        total,
        abandoned,
        rate: (abandoned / total) * 100,
      };
    } catch (err) {
      logger.warn(`Failed to fetch abandonment rate: ${err}`);
      return { total: 0, abandoned: 0, rate: 0 };
    }
  }

  /**
   * Get a file's content from the repository.
   */
  async getFileContent(
    path: string,
    ref?: string
  ): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref,
      });

      if ('content' in data && typeof data.content === 'string') {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Add a label to a pull request. Creates the label if it doesn't exist.
   */
  async addLabel(prNumber: number, label: string, color: string, description: string): Promise<void> {
    // Ensure the label exists
    try {
      await this.octokit.issues.getLabel({
        owner: this.owner,
        repo: this.repo,
        name: label,
      });
    } catch {
      // Label doesn't exist, create it
      try {
        await this.octokit.issues.createLabel({
          owner: this.owner,
          repo: this.repo,
          name: label,
          color,
          description,
        });
      } catch (createErr) {
        logger.warn(`Failed to create label "${label}": ${createErr}`);
      }
    }

    await this.octokit.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      labels: [label],
    });
  }

  /**
   * Remove a label from a pull request (if present).
   */
  async removeLabel(prNumber: number, label: string): Promise<void> {
    try {
      await this.octokit.issues.removeLabel({
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
        name: label,
      });
    } catch {
      // Label wasn't present — ignore
    }
  }

  /**
   * Post a comment on a pull request.
   */
  async createComment(prNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      body,
    });
  }

  /**
   * Request changes on a pull request via a review.
   */
  async requestChanges(prNumber: number, body: string): Promise<void> {
    await this.octokit.pulls.createReview({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      event: 'REQUEST_CHANGES',
      body,
    });
  }

  /**
   * Close a pull request.
   */
  async closePullRequest(prNumber: number): Promise<void> {
    await this.octokit.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      state: 'closed',
    });
  }
}
