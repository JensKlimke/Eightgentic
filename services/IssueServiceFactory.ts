// services/IssueServiceFactory.ts

import { IIssueService } from './IIssueService';
import { GitHubIssueService } from './GitHubIssueService';
import { FileSystemIssueService } from './FileSystemIssueService';
import { InMemoryIssueService } from './InMemoryIssueService';

export type ServiceType = 'github' | 'filesystem' | 'memory';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
}

export interface FileSystemConfig {
  path?: string;
}

export class IssueServiceFactory {
  static create(type: ServiceType, config?: any): IIssueService {
    switch (type) {
      case 'github':
        if (!config?.token || !config?.owner || !config?.repo) {
          throw new Error('GitHub service requires token, owner, and repo in config');
        }
        return new GitHubIssueService({
          token: config.token,
          owner: config.owner,
          repo: config.repo
        });

      case 'filesystem':
        return new FileSystemIssueService(config?.path || '.issues');

      case 'memory':
        return new InMemoryIssueService();

      default:
        throw new Error(`Unknown service type: ${type}`);
    }
  }

  static createFromEnv(): IIssueService {
    const serviceType = process.env.ISSUE_SERVICE_TYPE as ServiceType || 'filesystem';

    switch (serviceType) {
      case 'github':
        const githubToken = process.env.GITHUB_TOKEN;
        const githubRepo = process.env.GITHUB_REPOSITORY;

        if (!githubToken || !githubRepo) {
          throw new Error('GitHub service requires GITHUB_TOKEN and GITHUB_REPOSITORY env vars');
        }

        const [owner, repo] = githubRepo.split('/');
        return new GitHubIssueService({
          token: githubToken,
          owner,
          repo
        });

      case 'filesystem':
        return new FileSystemIssueService(process.env.ISSUE_STORAGE_PATH || '.issues');

      case 'memory':
        return new InMemoryIssueService();

      default:
        throw new Error(`Unknown service type from env: ${serviceType}`);
    }
  }
}