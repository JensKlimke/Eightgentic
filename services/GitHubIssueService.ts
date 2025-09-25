// services/GitHubIssueService.ts

import { Octokit } from '@octokit/rest';
import { IIssueService, Issue, IssueData, IssueUpdate, IssueFilters, Comment } from './IIssueService';

export class GitHubIssueService implements IIssueService {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(config: { token: string; owner: string; repo: string }) {
    this.octokit = new Octokit({
      auth: config.token
    });
    this.owner = config.owner;
    this.repo = config.repo;
  }

  async createIssue(issue: IssueData): Promise<number> {
    const response = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: issue.title,
      body: issue.body,
      labels: issue.labels
    });

    return response.data.number;
  }

  async updateIssue(issueNumber: number, updates: IssueUpdate): Promise<void> {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      title: updates.title,
      body: updates.body,
      state: updates.state,
      labels: updates.labels
    });
  }

  async getIssues(filters?: IssueFilters): Promise<Issue[]> {
    const params: any = {
      owner: this.owner,
      repo: this.repo,
      state: filters?.state || 'open',
      per_page: 100
    };

    if (filters?.labels && filters.labels.length > 0) {
      params.labels = filters.labels.join(',');
    }

    if (filters?.since) {
      params.since = filters.since;
    }

    const response = await this.octokit.rest.issues.listForRepo(params);

    return response.data.map(issue => ({
      number: issue.number,
      title: issue.title,
      body: issue.body || '',
      state: issue.state as 'open' | 'closed',
      labels: issue.labels.map(label =>
        typeof label === 'string' ? label : label.name || ''
      ),
      created_at: issue.created_at || new Date().toISOString(),
      updated_at: issue.updated_at || new Date().toISOString(),
      html_url: issue.html_url
    }));
  }

  async getIssue(issueNumber: number): Promise<Issue | null> {
    try {
      const response = await this.octokit.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      });

      const issue = response.data;

      // Fetch comments if needed
      const commentsResponse = await this.octokit.rest.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber
      });

      const comments: Comment[] = commentsResponse.data.map(comment => ({
        id: comment.id,
        body: comment.body || '',
        created_at: comment.created_at || new Date().toISOString(),
        author: comment.user?.login || 'unknown'
      }));

      return {
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        state: issue.state as 'open' | 'closed',
        labels: issue.labels.map(label =>
          typeof label === 'string' ? label : label.name || ''
        ),
        created_at: issue.created_at || new Date().toISOString(),
        updated_at: issue.updated_at || new Date().toISOString(),
        html_url: issue.html_url,
        comments
      };
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async addComment(issueNumber: number, comment: string): Promise<void> {
    await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: comment
    });
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: 'closed'
    });
  }
}