// services/InMemoryIssueService.ts

import { IIssueService, Issue, IssueData, IssueUpdate, IssueFilters, Comment } from './IIssueService';

export class InMemoryIssueService implements IIssueService {
  private issues: Map<number, Issue> = new Map();
  private lastIssueNumber: number = 0;

  async createIssue(issue: IssueData): Promise<number> {
    this.lastIssueNumber++;
    const newIssue: Issue = {
      number: this.lastIssueNumber,
      title: issue.title,
      body: issue.body,
      state: 'open',
      labels: issue.labels,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      comments: [{
        body: "Issue created from PRD",
        created_at: new Date().toISOString(),
        author: 'system'
      }]
    };

    this.issues.set(newIssue.number, newIssue);
    console.log(`[InMemory] Created issue #${newIssue.number}: ${newIssue.title}`);
    return newIssue.number;
  }

  async updateIssue(issueNumber: number, updates: IssueUpdate): Promise<void> {
    const issue = this.issues.get(issueNumber);
    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found`);
    }

    if (updates.title !== undefined) issue.title = updates.title;
    if (updates.body !== undefined) issue.body = updates.body;
    if (updates.state !== undefined) issue.state = updates.state;
    if (updates.labels !== undefined) issue.labels = updates.labels;
    issue.updated_at = new Date().toISOString();

    this.issues.set(issueNumber, issue);
    console.log(`[InMemory] Updated issue #${issueNumber}`);
  }

  async getIssues(filters?: IssueFilters): Promise<Issue[]> {
    let issues = Array.from(this.issues.values());

    // Apply filters
    if (filters?.state && filters.state !== 'all') {
      issues = issues.filter(issue => issue.state === filters.state);
    }

    if (filters?.labels && filters.labels.length > 0) {
      issues = issues.filter(issue =>
        filters.labels!.every(label => issue.labels.includes(label))
      );
    }

    if (filters?.since) {
      const sinceDate = new Date(filters.since);
      issues = issues.filter(issue =>
        new Date(issue.updated_at) >= sinceDate
      );
    }

    return issues.sort((a, b) => b.number - a.number);
  }

  async getIssue(issueNumber: number): Promise<Issue | null> {
    return this.issues.get(issueNumber) || null;
  }

  async addComment(issueNumber: number, comment: string): Promise<void> {
    const issue = this.issues.get(issueNumber);
    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found`);
    }

    if (!issue.comments) {
      issue.comments = [];
    }

    issue.comments.push({
      body: comment,
      created_at: new Date().toISOString(),
      author: 'system'
    });
    issue.updated_at = new Date().toISOString();

    this.issues.set(issueNumber, issue);
    console.log(`[InMemory] Added comment to issue #${issueNumber}`);
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.updateIssue(issueNumber, { state: 'closed' });
  }

  // Helper method for testing - not part of interface
  clear(): void {
    this.issues.clear();
    this.lastIssueNumber = 0;
  }

  // Helper method for testing - not part of interface
  getAllIssues(): Issue[] {
    return Array.from(this.issues.values());
  }
}