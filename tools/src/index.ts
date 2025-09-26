// tools/src/index.ts - Main entry point for the Eightgent agentic code generation tools

export * from './services';
export * from './processors';
export * from './config';

// Re-export commonly used classes for convenience
export { SmartPRDProcessor } from './processors/SmartPRDProcessor';
export { FileSystemIssueService } from './services/implementations/FileSystemIssueService';
export { GitHubIssueService } from './services/implementations/GitHubIssueService';
export { IssueServiceFactory } from './services/IssueServiceFactory';
export type { IIssueService, Issue, IssueData } from './services/interfaces/IIssueService';