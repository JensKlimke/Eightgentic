// services/IIssueService.ts

export interface Issue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  created_at: string;
  updated_at: string;
  html_url?: string;
  comments?: Comment[];
}

export interface Comment {
  id?: number;
  body: string;
  created_at: string;
  author: string;
}

export interface IssueData {
  title: string;
  body: string;
  labels: string[];
}

export interface IssueUpdate {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  labels?: string[];
}

export interface IssueFilters {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  since?: string;
}

export interface IIssueService {
  /**
   * Create a new issue
   * @returns The issue number
   */
  createIssue(issue: IssueData): Promise<number>;

  /**
   * Update an existing issue
   */
  updateIssue(issueNumber: number, updates: IssueUpdate): Promise<void>;

  /**
   * Get issues based on filters
   */
  getIssues(filters?: IssueFilters): Promise<Issue[]>;

  /**
   * Get a single issue by number
   */
  getIssue(issueNumber: number): Promise<Issue | null>;

  /**
   * Add a comment to an issue
   */
  addComment(issueNumber: number, comment: string): Promise<void>;

  /**
   * Close an issue
   */
  closeIssue(issueNumber: number): Promise<void>;

  /**
   * Store PRD version associated with an issue
   */
  storePRDVersion?(issueNumber: number, prdContent: string, prdPath: string): Promise<void>;

  /**
   * Get stored PRD version for an issue
   */
  getPRDVersion?(issueNumber: number): Promise<string | null>;

  /**
   * Get diff between stored PRD version and current content
   */
  getPRDDiff?(issueNumber: number, currentContent: string): Promise<string>;
}