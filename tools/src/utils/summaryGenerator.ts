import * as fs from 'fs';
import * as path from 'path';
import { log, createModuleLogger } from './logger';

// Create module-specific logger
const logger = createModuleLogger('SummaryGenerator');

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  action?: string;
  module?: string;
  [key: string]: any;
}

interface ProcessingSummary {
  sessionId: string;
  startTime: string;
  endTime: string;
  duration: string;
  prdProcessing: {
    prdFilePath: string;
    forceCreate: boolean;
    prdContentLength: number;
    existingIssuesCount: number;
    diffAnalysis?: {
      diffLines: number;
      diffLength: number;
    };
  };
  stages: {
    stage1?: {
      relevantIssuesFound: number;
      unrelatedIssuesCount: number;
      relevantIssues: Array<{
        issueNumber: number;
        relevance: string;
        reason: string;
      }>;
    };
    stage2?: {
      updatePlansCount: number;
      noUpdateNeededCount: number;
    };
  };
  issuesCreated: Array<{
    issueNumber: number;
    title: string;
    labels: string[];
    reason: string;
    contentLength: number;
  }>;
  issuesUpdated: Array<{
    issueNumber: number;
    title: string;
    changes: string[];
    reason: string;
  }>;
  aiInteractions: Array<{
    model: string;
    tokensUsed: number;
    promptLength: number;
    responseLength: number;
  }>;
  totalTokensUsed: number;
  errors: Array<{
    timestamp: string;
    message: string;
    error: any;
  }>;
  prdAnalyses: Array<{
    section: string;
    reasoning: string;
  }>;
}

export class SummaryGenerator {
  private logsDir: string;

  constructor() {
    this.logsDir = path.join(__dirname, '../../../logs');
  }

  /**
   * Generate a comprehensive summary of the last PRD processing session
   */
  async generateProcessingSummary(): Promise<ProcessingSummary> {
    logger.info('Generating processing summary from logs');

    const appLogPath = path.join(this.logsDir, 'app.log');
    if (!fs.existsSync(appLogPath)) {
      throw new Error('No application logs found to generate summary');
    }

    const logContent = fs.readFileSync(appLogPath, 'utf8');
    const logLines = logContent.split('\n').filter(line => line.trim());

    // Parse log entries
    const logEntries: LogEntry[] = [];
    for (const line of logLines) {
      try {
        const entry = JSON.parse(line);
        logEntries.push(entry);
      } catch (error) {
        // Skip malformed log lines
        continue;
      }
    }

    // Find the most recent PRD processing session
    const prdStartEntries = logEntries.filter(
      entry => entry.action === 'prd_processing_start'
    );

    if (prdStartEntries.length === 0) {
      throw new Error('No PRD processing sessions found in logs');
    }

    // Get the most recent session
    const lastSession = prdStartEntries[prdStartEntries.length - 1];
    const sessionStartTime = new Date(lastSession.timestamp);

    // Find session end (or use current time if still running)
    const sessionEndEntry = logEntries.find(
      entry =>
        entry.action === 'prd_processing_end' &&
        new Date(entry.timestamp) > sessionStartTime
    );

    const sessionEndTime = sessionEndEntry
      ? new Date(sessionEndEntry.timestamp)
      : new Date();

    // Filter logs for this session
    const sessionLogs = logEntries.filter(entry => {
      const entryTime = new Date(entry.timestamp);
      return entryTime >= sessionStartTime && entryTime <= sessionEndTime;
    });

    logger.debug('Session logs filtered', {
      action: 'session_logs_filtered',
      sessionStartTime: sessionStartTime.toISOString(),
      sessionEndTime: sessionEndTime.toISOString(),
      totalLogs: sessionLogs.length
    });

    // Build summary
    const summary: ProcessingSummary = {
      sessionId: sessionStartTime.toISOString(),
      startTime: sessionStartTime.toISOString(),
      endTime: sessionEndTime.toISOString(),
      duration: this.formatDuration(sessionEndTime.getTime() - sessionStartTime.getTime()),
      prdProcessing: {
        prdFilePath: lastSession.prdFilePath || '',
        forceCreate: lastSession.forceCreate || false,
        prdContentLength: 0,
        existingIssuesCount: 0
      },
      stages: {},
      issuesCreated: [],
      issuesUpdated: [],
      aiInteractions: [],
      totalTokensUsed: 0,
      errors: [],
      prdAnalyses: []
    };

    // Extract detailed information from session logs
    for (const entry of sessionLogs) {
      switch (entry.action) {
        case 'prd_file_read':
          summary.prdProcessing.prdContentLength = entry.contentLength || 0;
          break;

        case 'existing_issues_found':
          summary.prdProcessing.existingIssuesCount = entry.count || 0;
          break;

        case 'prd_diff_complete':
          summary.prdProcessing.diffAnalysis = {
            diffLines: entry.diffLines || 0,
            diffLength: entry.diffLength || 0
          };
          break;

        case 'stage1_complete':
          summary.stages.stage1 = {
            relevantIssuesFound: entry.relevantIssuesCount || 0,
            unrelatedIssuesCount: entry.unrelatedIssuesCount || 0,
            relevantIssues: entry.relevantIssues || []
          };
          break;

        case 'stage2_summary':
          summary.stages.stage2 = {
            updatePlansCount: entry.updatePlansCount || 0,
            noUpdateNeededCount: entry.noUpdateNeededCount || 0
          };
          break;

        case 'issue_created':
          summary.issuesCreated.push({
            issueNumber: entry.issueNumber,
            title: entry.title,
            labels: entry.labels || [],
            reason: entry.reason || '',
            contentLength: entry.contentLength || 0
          });
          break;

        case 'issue_updated':
          summary.issuesUpdated.push({
            issueNumber: entry.issueNumber,
            title: entry.title,
            changes: entry.changes || [],
            reason: entry.reason || ''
          });
          break;

        case 'ai_interaction':
          const interaction = {
            model: entry.model || '',
            tokensUsed: entry.tokens || 0,
            promptLength: entry.promptLength || 0,
            responseLength: entry.responseLength || 0
          };
          summary.aiInteractions.push(interaction);
          summary.totalTokensUsed += interaction.tokensUsed;
          break;

        case 'prd_analysis':
          summary.prdAnalyses.push({
            section: entry.section || '',
            reasoning: entry.reasoning || ''
          });
          break;
      }

      // Collect errors
      if (entry.level === 'error') {
        summary.errors.push({
          timestamp: entry.timestamp,
          message: entry.message,
          error: entry.error || entry
        });
      }
    }

    logger.info('Processing summary generated successfully', {
      action: 'summary_generated',
      issuesCreated: summary.issuesCreated.length,
      issuesUpdated: summary.issuesUpdated.length,
      aiInteractions: summary.aiInteractions.length,
      totalTokens: summary.totalTokensUsed,
      errors: summary.errors.length
    });

    return summary;
  }

  /**
   * Generate a human-readable summary report
   */
  generateReadableSummary(summary: ProcessingSummary): string {
    const report = [];

    report.push('# PRD Processing Summary Report');
    report.push('=' .repeat(50));
    report.push('');

    // Session Info
    report.push('## Session Information');
    report.push(`**Start Time:** ${new Date(summary.startTime).toLocaleString()}`);
    report.push(`**End Time:** ${new Date(summary.endTime).toLocaleString()}`);
    report.push(`**Duration:** ${summary.duration}`);
    report.push(`**PRD File:** ${summary.prdProcessing.prdFilePath}`);
    report.push(`**Mode:** ${summary.prdProcessing.forceCreate ? 'Force Create (New Issues)' : 'Update Existing Issues'}`);
    report.push('');

    // PRD Analysis
    report.push('## PRD Analysis');
    report.push(`**PRD Content Length:** ${summary.prdProcessing.prdContentLength.toLocaleString()} characters`);
    report.push(`**Existing Issues:** ${summary.prdProcessing.existingIssuesCount}`);

    if (summary.prdProcessing.diffAnalysis) {
      report.push(`**Changes Detected:** ${summary.prdProcessing.diffAnalysis.diffLines} lines of diff`);
    }
    report.push('');

    // Stage Results
    if (summary.stages.stage1) {
      report.push('## Stage 1: Relevance Analysis');
      report.push(`**Relevant Issues Found:** ${summary.stages.stage1.relevantIssuesFound}`);
      report.push(`**Unrelated Issues:** ${summary.stages.stage1.unrelatedIssuesCount}`);

      if (summary.stages.stage1.relevantIssues.length > 0) {
        report.push('');
        report.push('**Relevant Issues Details:**');
        for (const issue of summary.stages.stage1.relevantIssues) {
          report.push(`- Issue #${issue.issueNumber} (${issue.relevance} relevance)`);
          report.push(`  Reason: ${issue.reason}`);
        }
      }
      report.push('');
    }

    if (summary.stages.stage2) {
      report.push('## Stage 2: Update Planning');
      report.push(`**Updates Planned:** ${summary.stages.stage2.updatePlansCount}`);
      report.push(`**No Updates Needed:** ${summary.stages.stage2.noUpdateNeededCount}`);
      report.push('');
    }

    // Issues Created
    if (summary.issuesCreated.length > 0) {
      report.push('## Issues Created');
      for (const issue of summary.issuesCreated) {
        report.push(`### Issue #${issue.issueNumber}: ${issue.title}`);
        report.push(`**Labels:** ${issue.labels.join(', ')}`);
        report.push(`**Reason:** ${issue.reason}`);
        report.push(`**Content Length:** ${issue.contentLength} characters`);
        report.push('');
      }
    }

    // Issues Updated
    if (summary.issuesUpdated.length > 0) {
      report.push('## Issues Updated');
      for (const issue of summary.issuesUpdated) {
        report.push(`### Issue #${issue.issueNumber}: ${issue.title}`);
        report.push(`**Changes:**`);
        for (const change of issue.changes) {
          report.push(`- ${change}`);
        }
        report.push(`**Reason:** ${issue.reason}`);
        report.push('');
      }
    }

    // AI Usage
    if (summary.aiInteractions.length > 0) {
      report.push('## AI Usage Statistics');
      report.push(`**Total AI Interactions:** ${summary.aiInteractions.length}`);
      report.push(`**Total Tokens Used:** ${summary.totalTokensUsed.toLocaleString()}`);

      const avgTokensPerInteraction = Math.round(summary.totalTokensUsed / summary.aiInteractions.length);
      report.push(`**Average Tokens per Interaction:** ${avgTokensPerInteraction.toLocaleString()}`);
      report.push('');

      report.push('**Interaction Details:**');
      summary.aiInteractions.forEach((interaction, index) => {
        report.push(`${index + 1}. **${interaction.model}** - ${interaction.tokensUsed} tokens`);
        report.push(`   Input: ${interaction.promptLength} chars, Output: ${interaction.responseLength} chars`);
      });
      report.push('');
    }

    // PRD Analyses
    if (summary.prdAnalyses.length > 0) {
      report.push('## PRD Section Analyses');
      for (const analysis of summary.prdAnalyses) {
        report.push(`**${analysis.section}:** ${analysis.reasoning}`);
      }
      report.push('');
    }

    // Errors
    if (summary.errors.length > 0) {
      report.push('## Errors Encountered');
      for (const error of summary.errors) {
        report.push(`**${new Date(error.timestamp).toLocaleString()}:** ${error.message}`);
      }
      report.push('');
    }

    // Summary Stats
    report.push('## Summary Statistics');
    report.push(`- **Total Issues Created:** ${summary.issuesCreated.length}`);
    report.push(`- **Total Issues Updated:** ${summary.issuesUpdated.length}`);
    report.push(`- **Total AI Tokens Used:** ${summary.totalTokensUsed.toLocaleString()}`);
    report.push(`- **Errors Encountered:** ${summary.errors.length}`);
    report.push(`- **Processing Duration:** ${summary.duration}`);

    return report.join('\n');
  }

  /**
   * Save summary to file
   */
  async saveSummaryToFile(summary: ProcessingSummary, filename?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultFilename = `prd-processing-summary-${timestamp}.md`;
    const summaryFilename = filename || defaultFilename;
    const summaryPath = path.join(this.logsDir, summaryFilename);

    const readableSummary = this.generateReadableSummary(summary);
    fs.writeFileSync(summaryPath, readableSummary, 'utf8');

    // Also save raw JSON data
    const jsonPath = path.join(this.logsDir, summaryFilename.replace('.md', '.json'));
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

    logger.info('Summary saved to files', {
      action: 'summary_saved',
      markdownPath: summaryPath,
      jsonPath,
      issuesCreated: summary.issuesCreated.length,
      issuesUpdated: summary.issuesUpdated.length
    });

    return summaryPath;
  }

  private formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// Export convenience function
export async function generateProcessingSummary(): Promise<string> {
  const generator = new SummaryGenerator();
  const summary = await generator.generateProcessingSummary();
  return await generator.saveSummaryToFile(summary);
}