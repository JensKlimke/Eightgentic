// services/FileSystemIssueService.ts

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { IIssueService, Issue, IssueData, IssueUpdate, IssueFilters, Comment } from '../interfaces/IIssueService';

interface PRDVersion {
  contentFile: string;
  hash: string;
  timestamp: string;
  filePath: string;
}

interface StoredIssue {
  number: number;
  title: string;
  bodyFile: string;
  state: 'open' | 'closed';
  labels: string[];
  created_at: string;
  updated_at: string;
  commentsDirectory?: string;
  prdVersion?: PRDVersion;
}

interface Counter {
  lastIssueNumber: number;
}

export class FileSystemIssueService implements IIssueService {
  private basePath: string;
  private counterPath: string;
  private prdVersionsPath: string;

  constructor(basePath: string = '.issues') {
    this.basePath = basePath;
    this.counterPath = path.join(basePath, 'counter.yaml');
    this.prdVersionsPath = path.join(basePath, 'prd-versions');
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
    if (!fs.existsSync(this.prdVersionsPath)) {
      fs.mkdirSync(this.prdVersionsPath, { recursive: true });
    }
    if (!fs.existsSync(this.counterPath)) {
      this.saveCounter({ lastIssueNumber: 0 });
    }
  }

  private getCounter(): Counter {
    const content = fs.readFileSync(this.counterPath, 'utf8');
    return yaml.load(content) as Counter;
  }

  private saveCounter(counter: Counter): void {
    fs.writeFileSync(this.counterPath, yaml.dump(counter));
  }

  private getIssuePath(issueNumber: number): string {
    return path.join(this.basePath, `issue-${issueNumber}.yaml`);
  }

  private getIssueBodyPath(issueNumber: number): string {
    return path.join(this.basePath, `issue-${issueNumber}.md`);
  }

  private getCommentsDirectoryPath(issueNumber: number): string {
    return path.join(this.basePath, `issue-${issueNumber}-comments`);
  }

  private getCommentPath(issueNumber: number, commentIndex: number): string {
    return path.join(this.getCommentsDirectoryPath(issueNumber), `comment-${commentIndex + 1}.md`);
  }

  private getPRDVersionPath(issueNumber: number, timestamp: string): string {
    return path.join(this.prdVersionsPath, `issue-${issueNumber}-${timestamp}.md`);
  }

  private getPRDVersionFilename(issueNumber: number, timestamp: string): string {
    return `issue-${issueNumber}-${timestamp}.md`;
  }

  private generateContentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  private generateDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let diff = '';
    let i = 0, j = 0;

    while (i < oldLines.length || j < newLines.length) {
      if (i >= oldLines.length) {
        diff += `+ ${newLines[j]}\n`;
        j++;
      } else if (j >= newLines.length) {
        diff += `- ${oldLines[i]}\n`;
        i++;
      } else if (oldLines[i] === newLines[j]) {
        diff += `  ${oldLines[i]}\n`;
        i++;
        j++;
      } else {
        diff += `- ${oldLines[i]}\n`;
        diff += `+ ${newLines[j]}\n`;
        i++;
        j++;
      }
    }

    return diff;
  }

  private saveIssue(issue: StoredIssue, body?: string, comments?: Comment[]): void {
    // Save body to markdown file if provided
    if (body !== undefined) {
      const bodyPath = this.getIssueBodyPath(issue.number);
      fs.writeFileSync(bodyPath, body);
      issue.bodyFile = `issue-${issue.number}.md`;
    }

    // Save comments to separate files if provided
    if (comments !== undefined && comments.length > 0) {
      const commentsDir = this.getCommentsDirectoryPath(issue.number);
      if (!fs.existsSync(commentsDir)) {
        fs.mkdirSync(commentsDir, { recursive: true });
      }

      comments.forEach((comment, index) => {
        const commentPath = this.getCommentPath(issue.number, index);
        const commentContent = `**${comment.author}** - ${comment.created_at}\n\n${comment.body}`;
        fs.writeFileSync(commentPath, commentContent);
      });

      issue.commentsDirectory = `issue-${issue.number}-comments`;
    }

    // Save issue metadata to YAML
    const issuePath = this.getIssuePath(issue.number);
    fs.writeFileSync(issuePath, yaml.dump(issue));
  }

  private loadIssue(issueNumber: number): StoredIssue | null {
    const issuePath = this.getIssuePath(issueNumber);
    if (!fs.existsSync(issuePath)) {
      return null;
    }
    const content = fs.readFileSync(issuePath, 'utf8');
    return yaml.load(content) as StoredIssue;
  }

  private loadIssueBody(issueNumber: number): string {
    const bodyPath = this.getIssueBodyPath(issueNumber);
    if (fs.existsSync(bodyPath)) {
      return fs.readFileSync(bodyPath, 'utf8');
    }
    return '';
  }

  private loadComments(issueNumber: number): Comment[] {
    const commentsDir = this.getCommentsDirectoryPath(issueNumber);
    if (!fs.existsSync(commentsDir)) {
      return [];
    }

    const comments: Comment[] = [];
    const commentFiles = fs.readdirSync(commentsDir)
      .filter(file => file.startsWith('comment-') && file.endsWith('.md'))
      .sort((a, b) => {
        const aNum = parseInt(a.match(/comment-(\d+)\.md/)?.[1] || '0');
        const bNum = parseInt(b.match(/comment-(\d+)\.md/)?.[1] || '0');
        return aNum - bNum;
      });

    for (const commentFile of commentFiles) {
      const commentPath = path.join(commentsDir, commentFile);
      const content = fs.readFileSync(commentPath, 'utf8');

      // Parse comment content: **author** - timestamp\n\nbody
      const lines = content.split('\n');
      const headerMatch = lines[0].match(/\*\*(.*?)\*\* - (.*)/);
      if (headerMatch) {
        const body = lines.slice(2).join('\n');
        comments.push({
          author: headerMatch[1],
          created_at: headerMatch[2],
          body: body
        });
      }
    }

    return comments;
  }

  async createIssue(issue: IssueData): Promise<number> {
    const counter = this.getCounter();
    counter.lastIssueNumber++;
    this.saveCounter(counter);

    const newIssue: StoredIssue = {
      number: counter.lastIssueNumber,
      title: issue.title,
      bodyFile: `issue-${counter.lastIssueNumber}.md`,
      state: 'open',
      labels: issue.labels,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      commentsDirectory: `issue-${counter.lastIssueNumber}-comments`
    };

    const comments: Comment[] = [{
      body: "Issue created from PRD",
      created_at: new Date().toISOString(),
      author: 'system'
    }];

    this.saveIssue(newIssue, issue.body, comments);
    console.log(`Created issue #${newIssue.number} in ${this.getIssuePath(newIssue.number)}`);
    return newIssue.number;
  }

  async updateIssue(issueNumber: number, updates: IssueUpdate): Promise<void> {
    const issue = this.loadIssue(issueNumber);
    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found`);
    }

    if (updates.title !== undefined) issue.title = updates.title;
    if (updates.state !== undefined) issue.state = updates.state;
    if (updates.labels !== undefined) issue.labels = updates.labels;
    issue.updated_at = new Date().toISOString();

    // Save issue metadata and body if updated
    this.saveIssue(issue, updates.body);
    console.log(`Updated issue #${issueNumber}`);
  }

  async getIssues(filters?: IssueFilters): Promise<Issue[]> {
    const issues: Issue[] = [];
    const files = fs.readdirSync(this.basePath);

    for (const file of files) {
      if (!file.startsWith('issue-') || !file.endsWith('.yaml')) {
        continue;
      }

      const content = fs.readFileSync(path.join(this.basePath, file), 'utf8');
      const storedIssue = yaml.load(content) as StoredIssue;

      // Apply filters
      if (filters?.state && filters.state !== 'all') {
        if (storedIssue.state !== filters.state) {
          continue;
        }
      }

      if (filters?.labels && filters.labels.length > 0) {
        const hasAllLabels = filters.labels.every(label =>
          storedIssue.labels.includes(label)
        );
        if (!hasAllLabels) {
          continue;
        }
      }

      if (filters?.since) {
        if (new Date(storedIssue.updated_at) < new Date(filters.since)) {
          continue;
        }
      }

      // Load body and comments from separate files
      const body = this.loadIssueBody(storedIssue.number);
      const comments = this.loadComments(storedIssue.number);

      issues.push({
        number: storedIssue.number,
        title: storedIssue.title,
        body: body,
        state: storedIssue.state,
        labels: storedIssue.labels,
        created_at: storedIssue.created_at,
        updated_at: storedIssue.updated_at,
        comments: comments,
        html_url: `file://${this.getIssuePath(storedIssue.number)}`
      });
    }

    return issues.sort((a, b) => b.number - a.number);
  }

  async getIssue(issueNumber: number): Promise<Issue | null> {
    const storedIssue = this.loadIssue(issueNumber);
    if (!storedIssue) {
      return null;
    }

    // Load body and comments from separate files
    const body = this.loadIssueBody(storedIssue.number);
    const comments = this.loadComments(storedIssue.number);

    return {
      number: storedIssue.number,
      title: storedIssue.title,
      body: body,
      state: storedIssue.state,
      labels: storedIssue.labels,
      created_at: storedIssue.created_at,
      updated_at: storedIssue.updated_at,
      comments: comments,
      html_url: `file://${this.getIssuePath(storedIssue.number)}`
    };
  }

  async addComment(issueNumber: number, comment: string): Promise<void> {
    const issue = this.loadIssue(issueNumber);
    if (!issue) {
      throw new Error(`Issue #${issueNumber} not found`);
    }

    // Load existing comments and add new one
    const existingComments = this.loadComments(issueNumber);
    const newComment: Comment = {
      body: comment,
      created_at: new Date().toISOString(),
      author: 'system'
    };
    const allComments = [...existingComments, newComment];

    issue.updated_at = new Date().toISOString();

    // Save the issue with updated comments
    this.saveIssue(issue, undefined, allComments);
    console.log(`Added comment to issue #${issueNumber}`);
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.updateIssue(issueNumber, { state: 'closed' });
  }

  async storePRDVersion(issueNumber: number, prdContent: string, prdPath: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const hash = this.generateContentHash(prdContent);
    const versionPath = this.getPRDVersionPath(issueNumber, timestamp);
    const versionFilename = this.getPRDVersionFilename(issueNumber, timestamp);

    // Store PRD content to file
    fs.writeFileSync(versionPath, prdContent);

    // Update issue with PRD version reference
    const issue = this.loadIssue(issueNumber);
    if (issue) {
      issue.prdVersion = {
        contentFile: versionFilename,
        hash,
        timestamp,
        filePath: prdPath
      };
      this.saveIssue(issue);
      console.log(`Stored PRD version for issue #${issueNumber}: ${versionPath}`);
    }
  }

  async getPRDVersion(issueNumber: number): Promise<string | null> {
    const issue = this.loadIssue(issueNumber);
    if (!issue?.prdVersion?.contentFile) {
      return null;
    }

    const versionPath = path.join(this.prdVersionsPath, issue.prdVersion.contentFile);
    if (fs.existsSync(versionPath)) {
      return fs.readFileSync(versionPath, 'utf8');
    }

    return null;
  }

  async getPRDDiff(issueNumber: number, currentContent: string): Promise<string> {
    const storedContent = await this.getPRDVersion(issueNumber);
    if (!storedContent) {
      return `No stored PRD version found for issue #${issueNumber}`;
    }

    if (this.generateContentHash(storedContent) === this.generateContentHash(currentContent)) {
      return 'No changes detected between stored and current PRD versions';
    }

    return this.generateDiff(storedContent, currentContent);
  }
}