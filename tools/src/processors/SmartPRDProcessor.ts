// scripts/prd-processor-smart.ts

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IIssueService, Issue } from '../services/interfaces/IIssueService';
import { IssueServiceFactory } from '../services/IssueServiceFactory';
import { log, createModuleLogger } from '../utils/logger';

// Create module-specific logger
const logger = createModuleLogger('SmartPRDProcessor');

const execAsync = promisify(exec);

interface AnalyzedFeature {
  title: string;
  description: string;
  type: 'technical' | 'non-technical' | 'enabler';
  priority: 'high' | 'medium' | 'low';
  estimatedEffort: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  blockedFeatures: string[];
  tags: string[];
  reason?: string;
}

// Legacy interfaces - kept for compatibility during transition
interface Stage1Result {
  relevantIssues: Array<{
    issueNumber: number;
    title: string;
    relevance: 'high' | 'medium' | 'low';
    reason: string;
    affectedSections: string[];
  }>;
  unrelatedIssues: number[];
  summary: string;
}

interface Stage2Result {
  updatePlans: Array<{
    issueNumber: number;
    updates: {
      title?: string;
      body?: string;
      labels?: string[];
    };
    comment?: string;
    changeType: 'minor' | 'major' | 'scope_change';
    updateSummary: string;
  }>;
  noUpdateNeeded: number[];
  summary: string;
}

interface Stage3Result {
  metadata: {
    prdTitle: string;
    summary: string;
  };
  features: AnalyzedFeature[];
}

// New unified planning interfaces
interface ChangeAssessment {
  hasSignificantChanges: boolean;
  changeSummary: string;
  trivialChangesIgnored: string[];
  reasoningForSignificance: string;
}

interface IssueUpdatePlan {
  issueNumber: number;
  action: 'update' | 'obsolete' | 'no_change';
  changeSignificance: 'minor' | 'major' | 'scope_change';
  reasoning: string;
  updates?: {
    title?: string;
    body?: string;
    labels?: string[];
  };
  comment?: string;
  updateSummary?: string;
}

interface UnifiedPlanResult {
  changeAssessment: ChangeAssessment;
  issueUpdates: IssueUpdatePlan[];
  newFeatures: AnalyzedFeature[];
  summary: {
    totalIssuesAnalyzed: number;
    issuesRequiringUpdates: number;
    issuesMarkedObsolete: number;
    newIssuesNeeded: number;
    overallRationale: string;
  };
}

export class SmartPRDProcessor {
  private openai: OpenAI;
  private issueService: IIssueService;

  constructor(issueService: IIssueService) {
    this.issueService = issueService;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!
    });
  }

  async getPRDDiff(prdContent: string, existingIssues: Issue[]): Promise<string> {
    // If we have issues with PRD version support, use the first one as reference
    if (existingIssues.length > 0 && this.issueService.getPRDDiff) {
      const firstIssue = existingIssues[0];
      try {
        const diff = await this.issueService.getPRDDiff(firstIssue.number, prdContent);
        logger.debug('PRD diff generated successfully', {
          action: 'prd_diff_generation',
          issueNumber: firstIssue.number,
          diffLength: diff.length,
          diffPreview: diff.substring(0, 200) + '...'
        });
        return diff;
      } catch (error) {
        logger.warn('Could not get PRD diff from stored version:', error);
      }
    }
    return 'No stored PRD version available for comparison';
  }

  async loadPrompt(promptFile: string): Promise<string> {
    const promptPath = path.join(__dirname, '../../prompts', promptFile);
    logger.debug('Loading prompt file', {
      action: 'prompt_loading',
      promptFile,
      promptPath
    });
    const content = fs.readFileSync(promptPath, 'utf8');
    logger.debug('Prompt loaded successfully', {
      action: 'prompt_loaded',
      promptFile,
      contentLength: content.length,
      contentPreview: content.substring(0, 150) + '...'
    });
    return content;
  }

  // Smart change detection to filter trivial changes
  analyzeChangeSignificance(prdDiff: string): { isSignificant: boolean, filteredDiff: string, trivialChanges: string[] } {
    const lines = prdDiff.split('\n');
    const trivialPatterns = [
      /^[+\-]\s*version:\s*\d+\.\d+/i,  // Version numbers
      /^[+\-]\s*date:\s*\d{4}-\d{2}-\d{2}/i,  // Dates
      /^[+\-]\s*updated:\s*\d{4}-\d{2}-\d{2}/i,  // Update dates
      /^[+\-]\s*v\d+\.\d+(\.\d+)?/i,  // Version references
      /^[+\-]\s*\*\*last\s*updated/i,  // Last updated headers
      /^[+\-]\s*#+\s*changelog/i,  // Changelog sections
      /^[+\-]\s*\|\s*\d+\.\d+\s*\|/,  // Version tables
    ];

    const trivialChanges: string[] = [];
    const significantLines: string[] = [];

    for (const line of lines) {
      if (line.trim() === '') {
        continue;
      }

      const isTrivial = trivialPatterns.some(pattern => pattern.test(line));
      if (isTrivial) {
        trivialChanges.push(line.trim());
      } else if (line.startsWith('+') || line.startsWith('-')) {
        significantLines.push(line);
      } else {
        significantLines.push(line); // Context lines
      }
    }

    const hasSignificantChanges = significantLines.some(line =>
      (line.startsWith('+') || line.startsWith('-')) && line.trim().length > 3
    );

    logger.debug('Change significance analysis complete', {
      action: 'change_significance_analysis',
      totalLines: lines.length,
      trivialChanges: trivialChanges.length,
      significantLines: significantLines.length,
      hasSignificantChanges,
      trivialChangesSample: trivialChanges.slice(0, 3)
    });

    return {
      isSignificant: hasSignificantChanges,
      filteredDiff: significantLines.join('\n'),
      trivialChanges
    };
  }

  // Unified planning method (replaces the 3-stage process)
  async planComprehensiveChanges(
    prdContent: string,
    prdDiff: string,
    existingIssues: Issue[]
  ): Promise<UnifiedPlanResult> {
    logger.info('🎯 Stage 1: Starting unified comprehensive planning', {
      action: 'unified_planning_start',
      existingIssuesCount: existingIssues.length,
      prdLength: prdContent.length,
      diffLength: prdDiff.length
    });

    // First, analyze change significance
    const changeAnalysis = this.analyzeChangeSignificance(prdDiff);

    if (!changeAnalysis.isSignificant) {
      logger.info('📋 No significant changes detected - skipping processing', {
        action: 'no_significant_changes',
        trivialChangesCount: changeAnalysis.trivialChanges.length,
        trivialChangesSample: changeAnalysis.trivialChanges.slice(0, 3)
      });

      return {
        changeAssessment: {
          hasSignificantChanges: false,
          changeSummary: 'Only trivial changes detected (version numbers, dates, formatting)',
          trivialChangesIgnored: changeAnalysis.trivialChanges,
          reasoningForSignificance: 'Changes are limited to non-functional updates that do not affect issue content'
        },
        issueUpdates: existingIssues.map(issue => ({
          issueNumber: issue.number,
          action: 'no_change' as const,
          changeSignificance: 'minor' as const,
          reasoning: 'No significant changes affect this issue'
        })),
        newFeatures: [],
        summary: {
          totalIssuesAnalyzed: existingIssues.length,
          issuesRequiringUpdates: 0,
          issuesMarkedObsolete: 0,
          newIssuesNeeded: 0,
          overallRationale: 'No action required - only trivial changes detected'
        }
      };
    }

    // Load the unified planning prompt
    const prompt = await this.loadPrompt('prd-unified-planning.md');

    // Build comprehensive context for AI analysis
    const existingIssuesContext = existingIssues.map(issue => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels
    }));

    const userContent = `
## Current PRD Content:
${prdContent}

## PRD Changes (Filtered for Significance):
${changeAnalysis.filteredDiff}

## Trivial Changes Filtered Out:
${changeAnalysis.trivialChanges.join('\n')}

## Existing Issues:
${JSON.stringify(existingIssuesContext, null, 2)}

## Previous Processing Context:
This is an update to an existing PRD. Focus on semantic changes that affect implementation or requirements.
Total existing issues: ${existingIssues.length}
Trivial changes filtered: ${changeAnalysis.trivialChanges.length}
`;

    logger.debug('Sending unified planning request to AI', {
      action: 'unified_planning_ai_request',
      promptLength: prompt.length,
      userContentLength: userContent.length,
      existingIssuesCount: existingIssues.length,
      significantChangesOnly: true
    });

    const result = await this.analyzeWithAI(prompt, userContent);

    // Add reasoning enhancement
    if (result.newFeatures) {
      result.newFeatures = result.newFeatures.map((feature: any) => ({
        ...feature,
        reason: feature.reasoning || 'New feature identified from PRD updates'
      }));
    }

    logger.info('🎯 Stage 1 Complete: Unified planning finished', {
      action: 'unified_planning_complete',
      hasSignificantChanges: result.changeAssessment?.hasSignificantChanges || false,
      issuesRequiringUpdates: result.summary?.issuesRequiringUpdates || 0,
      newFeaturesIdentified: result.summary?.newIssuesNeeded || 0,
      trivialChangesIgnored: changeAnalysis.trivialChanges.length
    });

    return result;
  }

  // Stage 2: Execute the planned changes
  async executeChanges(
    planResult: UnifiedPlanResult,
    prdContent: string,
    prdFilePath: string
  ): Promise<{ updated: number, created: number, unchanged: number }> {
    logger.info('⚡ Stage 2: Starting change execution', {
      action: 'change_execution_start',
      issuesRequiringUpdates: planResult.summary.issuesRequiringUpdates,
      newIssuesNeeded: planResult.summary.newIssuesNeeded,
      totalIssuesAnalyzed: planResult.summary.totalIssuesAnalyzed
    });

    let updatedCount = 0;
    let createdCount = 0;
    let unchangedCount = 0;

    // Execute issue updates
    for (const updatePlan of planResult.issueUpdates) {
      if (updatePlan.action === 'update') {
        logger.info(`🔄 Updating Issue #${updatePlan.issueNumber}: ${updatePlan.updateSummary}`, {
          action: 'issue_update_execution',
          issueNumber: updatePlan.issueNumber,
          changeSignificance: updatePlan.changeSignificance,
          reasoning: updatePlan.reasoning
        });

        if (updatePlan.updates && Object.keys(updatePlan.updates).length > 0) {
          await this.issueService.updateIssue(updatePlan.issueNumber, updatePlan.updates);
          updatedCount++;
        }

        if (updatePlan.comment) {
          await this.issueService.addComment(updatePlan.issueNumber, updatePlan.comment);
        }

        // Store updated PRD version with the issue
        if (this.issueService.storePRDVersion) {
          await this.issueService.storePRDVersion(updatePlan.issueNumber, prdContent, prdFilePath);
        }

      } else if (updatePlan.action === 'obsolete') {
        logger.info(`🗑️ Marking Issue #${updatePlan.issueNumber} as obsolete: ${updatePlan.reasoning}`);
        // Add obsolete label or comment instead of closing
        await this.issueService.addComment(updatePlan.issueNumber,
          `⚠️ This issue may be obsolete due to PRD changes: ${updatePlan.reasoning}`);
        updatedCount++;

      } else {
        logger.debug(`✅ Issue #${updatePlan.issueNumber}: No changes needed`);
        unchangedCount++;
      }
    }

    // Create new issues
    if (planResult.newFeatures && planResult.newFeatures.length > 0) {
      logger.info('➕ Creating new issues for identified features...', {
        action: 'new_issues_creation_start',
        newFeaturesCount: planResult.newFeatures.length
      });

      await this.createNewIssues(planResult.newFeatures, prdFilePath, prdContent);
      createdCount = planResult.newFeatures.length;
    }

    logger.info('⚡ Stage 2 Complete: Change execution finished', {
      action: 'change_execution_complete',
      issuesUpdated: updatedCount,
      issuesCreated: createdCount,
      issuesUnchanged: unchangedCount,
      totalProcessed: updatedCount + createdCount + unchangedCount
    });

    return {
      updated: updatedCount,
      created: createdCount,
      unchanged: unchangedCount
    };
  }

  async analyzeWithAI(prompt: string, userContent: string): Promise<any> {
    logger.debug('Starting AI analysis', {
      action: 'ai_analysis_start',
      model: 'gpt-4o',
      promptLength: prompt.length,
      userContentLength: userContent.length,
      promptPreview: prompt.substring(0, 100) + '...',
      userContentPreview: userContent.substring(0, 200) + '...'
    });

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4000,
      temperature: 0.1,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userContent }
      ]
    });

    const content = response.choices[0]?.message?.content || '';
    const tokens = response.usage?.total_tokens || 0;

    logger.debug('AI analysis completed', {
      action: 'ai_analysis_complete',
      model: 'gpt-4o',
      responseLength: content.length,
      tokensUsed: tokens,
      responsePreview: content.substring(0, 200) + '...'
    });

    log.aiInteraction(prompt, content, 'gpt-4o', tokens);

    // Log AI interaction summary at info level
    logger.info(`🤖 AI Analysis: Used ${tokens} tokens, generated ${content.length} chars response for ${prompt.substring(prompt.indexOf('#') + 1, prompt.indexOf('\n')).trim()}`);

    return this.parseAIResponse(content);
  }

  private parseAIResponse(content: string): any {
    logger.debug('Parsing AI response', {
      action: 'ai_response_parsing',
      contentLength: content.length,
      contentPreview: content.substring(0, 300) + '...'
    });

    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      content.match(/({[\s\S]*})/);
    if (!jsonMatch) {
      logger.error('No valid JSON found in AI response', {
        action: 'ai_response_parse_error',
        content: content.substring(0, 500) + '...'
      });
      throw new Error('No valid JSON found in AI response');
    }

    try {
      const parsed = JSON.parse(jsonMatch[1]);
      logger.debug('AI response parsed successfully', {
        action: 'ai_response_parsed',
        jsonLength: jsonMatch[1].length,
        parsedKeys: Object.keys(parsed)
      });
      return parsed;
    } catch (error) {
      logger.error('Failed to parse JSON from AI response', {
        action: 'json_parse_error',
        error: error,
        jsonContent: jsonMatch[1].substring(0, 500) + '...'
      });
      throw error;
    }
  }

  // Stage 1: Identify relevant issues
  async identifyRelevantIssues(
    prdContent: string,
    prdDiff: string,
    existingIssues: Issue[]
  ): Promise<Stage1Result> {
    logger.info('Stage 1: Starting relevant issues identification', {
      action: 'stage1_start',
      prdContentLength: prdContent.length,
      prdDiffLength: prdDiff.length,
      existingIssuesCount: existingIssues.length,
      existingIssueNumbers: existingIssues.map(i => i.number)
    });

    const prompt = await this.loadPrompt('prd-update-stage1.md');

    const userContent = `
## Current PRD Content:
${prdContent}

## PRD Changes (vs stored version):
${prdDiff}

## Existing Issues:
${existingIssues.map(issue => `
- Issue #${issue.number}: ${issue.title}
  Description: ${issue.body.substring(0, 200)}...
`).join('\n')}
`;

    const result = await this.analyzeWithAI(prompt, userContent) as any;

    // Handle potential typos in AI response (e.g., 'unrealtedIssues' instead of 'unrelatedIssues')
    const stage1Result: Stage1Result = {
      relevantIssues: result.relevantIssues || [],
      unrelatedIssues: result.unrelatedIssues || result.unrealtedIssues || [],
      summary: result.summary || 'No summary provided'
    };

    logger.info(`🎯 Stage 1 Complete: ${stage1Result.relevantIssues.length} relevant issues identified from ${stage1Result.relevantIssues.length + stage1Result.unrelatedIssues.length} total`, {
      action: 'stage1_complete',
      relevantIssuesCount: stage1Result.relevantIssues.length,
      unrelatedIssuesCount: stage1Result.unrelatedIssues.length,
      relevantIssues: stage1Result.relevantIssues.map(i => ({
        issueNumber: i.issueNumber,
        relevance: i.relevance,
        reason: i.reason
      })),
      unrelatedIssues: stage1Result.unrelatedIssues,
      summary: stage1Result.summary
    });

    // Log each relevant issue with reasoning at info level
    stage1Result.relevantIssues.forEach(issue => {
      logger.info(`🔍 Issue #${issue.issueNumber} marked as ${issue.relevance.toUpperCase()} relevance: ${issue.reason}`);
    });

    if (stage1Result.unrelatedIssues.length > 0) {
      logger.info(`📋 ${stage1Result.unrelatedIssues.length} issues marked as unrelated: [${stage1Result.unrelatedIssues.join(', ')}]`);
    }

    return stage1Result;
  }

  // Stage 2: Plan updates for relevant issues
  async planIssueUpdates(
    relevantIssues: Stage1Result['relevantIssues'],
    existingIssues: Issue[],
    prdContent: string,
    prdDiff: string
  ): Promise<Stage2Result> {
    const prompt = await this.loadPrompt('prd-update-stage2.md');

    const issueMap = new Map(existingIssues.map(i => [i.number, i]));
    const relevantIssueDetails = relevantIssues.map(ri => {
      const issue = issueMap.get(ri.issueNumber);
      return {
        ...ri,
        currentContent: issue ? {
          title: issue.title,
          body: issue.body,
          labels: issue.labels
        } : null
      };
    });

    const userContent = `
## Relevant Issues to Update:
${JSON.stringify(relevantIssueDetails, null, 2)}

## PRD Changes:
${prdDiff}

## Updated PRD:
${prdContent}
`;

    const result = await this.analyzeWithAI(prompt, userContent) as any;

    // Ensure Stage2Result has required properties with defaults
    const stage2Result: Stage2Result = {
      updatePlans: result.updatePlans || [],
      noUpdateNeeded: result.noUpdateNeeded || [],
      summary: result.summary || 'No summary provided'
    };

    logger.info(`🛠️ Stage 2 Complete: ${stage2Result.updatePlans.length} updates planned, ${stage2Result.noUpdateNeeded.length} issues need no changes`, {
      action: 'stage2_complete',
      updatePlansCount: stage2Result.updatePlans.length,
      noUpdateNeededCount: stage2Result.noUpdateNeeded.length,
      summary: stage2Result.summary
    });

    // Log each update plan with reasoning at info level
    stage2Result.updatePlans.forEach(plan => {
      logger.info(`📝 Issue #${plan.issueNumber} planned for ${plan.changeType} update: ${plan.updateSummary}`);
    });

    if (stage2Result.noUpdateNeeded.length > 0) {
      logger.info(`✅ Issues requiring no updates: [${stage2Result.noUpdateNeeded.join(', ')}]`);
    }

    return stage2Result;
  }

  // Stage 3: Identify missing features
  async identifyMissingFeatures(
    prdContent: string,
    existingIssues: Issue[],
    prdDiff: string,
    updatePlans: Stage2Result['updatePlans']
  ): Promise<Stage3Result> {
    const prompt = await this.loadPrompt('prd-update-stage3.md');

    const userContent = `
## Updated PRD:
${prdContent}

## Existing Issues (including planned updates):
${existingIssues.map(issue => `- #${issue.number}: ${issue.title}`).join('\n')}

## PRD Changes:
${prdDiff}

## Planned Updates:
${updatePlans.map(plan => `- #${plan.issueNumber}: ${plan.updateSummary}`).join('\n')}
`;

    return await this.analyzeWithAI(prompt, userContent);
  }

  // Main processing function
  async processPRD(prdFilePath: string, forceCreate: boolean = false): Promise<void> {
    logger.info('🚀 Smart PRD Processing Started', {
      action: 'prd_processing_start',
      prdFilePath,
      forceCreate,
      timestamp: new Date().toISOString()
    });

    if (!fs.existsSync(prdFilePath)) {
      logger.error('PRD file not found', {
        action: 'prd_file_not_found',
        prdFilePath
      });
      throw new Error(`PRD file not found: ${prdFilePath}`);
    }

    logger.debug('Reading PRD file', { action: 'prd_file_reading', prdFilePath });
    const prdContent = fs.readFileSync(prdFilePath, 'utf8');
    logger.debug('PRD file read successfully', {
      action: 'prd_file_read',
      contentLength: prdContent.length,
      contentPreview: prdContent.substring(0, 200) + '...'
    });

    // Get existing issues
    logger.debug('Fetching existing issues', {
      action: 'existing_issues_fetch',
      filters: { state: 'open', labels: ['prd-generated'] }
    });
    const existingIssues = await this.issueService.getIssues({
      state: 'open',
      labels: ['prd-generated']
    });

    logger.info(`📊 Found ${existingIssues.length} existing PRD-generated issues: [${existingIssues.map(i => `#${i.number}`).join(', ')}]`, {
      action: 'existing_issues_found',
      count: existingIssues.length,
      issueNumbers: existingIssues.map(i => i.number),
      issueTitles: existingIssues.map(i => ({ number: i.number, title: i.title }))
    });

    if (forceCreate || existingIssues.length === 0) {
      const reason = forceCreate ? 'Force create mode enabled' : 'No existing PRD-generated issues found';
      logger.info(`🆕 Creating fresh issues: ${reason}`, {
        action: 'creating_new_issues',
        reason: forceCreate ? 'force_create_mode' : 'no_existing_issues',
        forceCreate,
        existingIssuesCount: existingIssues.length
      });
      await this.createAllNewIssues(prdContent, prdFilePath);
      return;
    }

    // Get PRD diff using stored versions
    logger.debug('Getting PRD diff using stored versions', {
      action: 'prd_diff_start',
      existingIssuesCount: existingIssues.length
    });
    const prdDiff = await this.getPRDDiff(prdContent, existingIssues);
    const diffLines = prdDiff.split('\n').length;
    logger.info(`📋 PRD Analysis: ${diffLines} lines of diff detected`, {
      action: 'prd_diff_complete',
      diffLines,
      diffLength: prdDiff.length,
      diffPreview: prdDiff.substring(0, 300) + '...'
    });

    // ===== NEW 2-STAGE PROCESS =====

    // Stage 1: Comprehensive Planning (replaces old 3-stage analysis)
    const planResult = await this.planComprehensiveChanges(prdContent, prdDiff, existingIssues);

    // Early exit if no significant changes detected
    if (!planResult.changeAssessment.hasSignificantChanges) {
      logger.info(`✅ Smart PRD Processing Complete: No significant changes detected`, {
        action: 'prd_processing_complete_no_changes',
        trivialChangesIgnored: planResult.changeAssessment.trivialChangesIgnored.length,
        reasoning: planResult.changeAssessment.reasoningForSignificance
      });
      return;
    }

    // Stage 2: Execute Changes
    const executionResult = await this.executeChanges(planResult, prdContent, prdFilePath);

    // Generate enhanced summary
    const summary = {
      updated: executionResult.updated,
      created: executionResult.created,
      unchanged: executionResult.unchanged,
      changeAssessment: planResult.changeAssessment,
      overallRationale: planResult.summary.overallRationale,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync('smart-update-summary.json', JSON.stringify(summary, null, 2));
    logger.info(`✅ Smart PRD Processing Complete: ${summary.updated} updated, ${summary.created} created, ${summary.unchanged} unchanged issues`, {
      action: 'prd_processing_complete',
      summary: {
        updated: summary.updated,
        created: summary.created,
        unchanged: summary.unchanged,
        overallRationale: summary.overallRationale
      },
      totalIssuesProcessed: summary.updated + summary.created + summary.unchanged,
      trivialChangesFiltered: planResult.changeAssessment.trivialChangesIgnored.length
    });
  }

  private async executeUpdates(updatePlans: Stage2Result['updatePlans'], prdContent: string, prdPath: string): Promise<void> {
    for (const plan of updatePlans) {
      logger.info(`🔄 Executing update for Issue #${plan.issueNumber}: ${plan.updateSummary}`);

      if (Object.keys(plan.updates).length > 0) {
        await this.issueService.updateIssue(plan.issueNumber, plan.updates);
      } else {
        logger.info(`   ℹ️ No changes needed for Issue #${plan.issueNumber}`);
      }

      if (plan.comment) {
        await this.issueService.addComment(plan.issueNumber, plan.comment);
      }

      // Store updated PRD version with the issue
      if (this.issueService.storePRDVersion) {
        await this.issueService.storePRDVersion(plan.issueNumber, prdContent, prdPath);
      }
    }
  }

  private async createNewIssues(features: AnalyzedFeature[], prdPath: string, prdContent?: string): Promise<void> {
    const issueTemplates = {
      technical: fs.readFileSync(path.join(__dirname, '../../templates/technical-feature-template.md'), 'utf8'),
      nonTechnical: fs.readFileSync(path.join(__dirname, '../../templates/non-technical-feature-template.md'), 'utf8'),
      enabler: fs.readFileSync(path.join(__dirname, '../../templates/enabler-feature-template.md'), 'utf8')
    };

    for (const feature of features) {
      const templateKey = feature.type === 'non-technical' ? 'nonTechnical' : feature.type;
      const template = issueTemplates[templateKey];

      let blockedFeaturesSection = '';
      if (feature.blockedFeatures && feature.blockedFeatures.length > 0) {
        blockedFeaturesSection = `\n\n### 🚫 Blocked Features\nThis feature blocks:\n${feature.blockedFeatures.map(f => `- ${f}`).join('\n')}\n`;
      }

      const issueBody = template
        .replace('{{DESCRIPTION}}', feature.description)
        .replace('{{ESTIMATED_EFFORT}}', feature.estimatedEffort)
        .replace('{{ACCEPTANCE_CRITERIA}}', feature.acceptanceCriteria.map(ac => `- [ ] ${ac}`).join('\n'))
        .replace('{{DEPENDENCIES}}', feature.dependencies.join(', ') || 'None')
        .replace('{{PRD_PATH}}', prdPath) + blockedFeaturesSection;

      const issueNumber = await this.issueService.createIssue({
        title: `[${feature.type.toUpperCase()}] ${feature.title}`,
        body: issueBody,
        labels: ['prd-generated', `type:${feature.type}`, `priority:${feature.priority}`, ...feature.tags]
      });

      // Store PRD version with new issue
      if (prdContent && this.issueService.storePRDVersion) {
        await this.issueService.storePRDVersion(issueNumber, prdContent, prdPath);
      }

      console.log(`  Created issue #${issueNumber}: ${feature.title}`);
    }
  }

  private async createAllNewIssues(prdContent: string, prdPath: string): Promise<void> {
    // Use existing PRD analysis prompt for new issues
    const analysisPrompt = fs.readFileSync(path.join(__dirname, '../../prompts/prd-analysis-prompt.md'), 'utf8');

    const userContent = `Analyze this PRD document and extract features:

PRD File Path: ${prdPath}

PRD Content:
${prdContent}

Please provide your analysis in JSON format matching the expected structure for features.`;

    const analysis = await this.analyzeWithAI(analysisPrompt, userContent);
    await this.createNewIssues(analysis.features || [], prdPath, prdContent);
  }
}

// Main execution for standalone use
async function main() {
  const prdFilePath = process.argv[2];
  const serviceType = process.argv[3] || 'filesystem';
  const forceCreate = process.argv[4] === '--force-create';

  if (!prdFilePath) {
    console.error('Usage: ts-node prd-processor-smart.ts <prd-file-path> [service-type] [--force-create]');
    console.error('Service types: github, filesystem, memory');
    process.exit(1);
  }

  try {
    const issueService = IssueServiceFactory.create(serviceType as any);
    const processor = new SmartPRDProcessor(issueService);
    await processor.processPRD(prdFilePath, forceCreate);
  } catch (error) {
    console.error('Error processing PRD:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}