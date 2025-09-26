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
    const significantChanges = prdDiff.includes('+ ') || prdDiff.includes('- ');
    logger.info(`📋 PRD Analysis: ${diffLines} lines of diff detected (${significantChanges ? 'contains significant changes' : 'minimal changes'})`, {
      action: 'prd_diff_complete',
      diffLines,
      diffLength: prdDiff.length,
      hasSignificantChanges: significantChanges,
      diffPreview: prdDiff.substring(0, 300) + '...'
    });

    // Log key changes at info level
    const changeLines = prdDiff.split('\n').filter(line => line.startsWith('+ ') || line.startsWith('- ')).slice(0, 5);
    if (changeLines.length > 0) {
      logger.info(`🔍 Key changes detected:`);
      changeLines.forEach(line => {
        logger.info(`   ${line}`);
      });
    }

    // Stage 1: Identify relevant issues
    logger.info('🔍 Stage 1: Identifying relevant issues...');
    const stage1Result = await this.identifyRelevantIssues(
      prdContent,
      prdDiff,
      existingIssues
    );
    logger.info(`  Found ${stage1Result.relevantIssues?.length || 0} relevant issues`, {
      action: 'stage1_summary',
      relevantIssuesCount: stage1Result.relevantIssues?.length || 0,
      unrelatedIssuesCount: stage1Result.unrelatedIssues?.length || 0
    });

    // Stage 2: Plan updates
    logger.info('📝 Stage 2: Planning issue updates...');
    const stage2Result = await this.planIssueUpdates(
      stage1Result.relevantIssues,
      existingIssues,
      prdContent,
      prdDiff
    );
    logger.info(`  Planned ${stage2Result.updatePlans?.length || 0} updates`, {
      action: 'stage2_summary',
      updatePlansCount: stage2Result.updatePlans?.length || 0,
      noUpdateNeededCount: stage2Result.noUpdateNeeded?.length || 0
    });

    // Stage 3: Identify missing features
    console.log('🔎 Stage 3: Identifying missing features...');
    const stage3Result = await this.identifyMissingFeatures(
      prdContent,
      existingIssues,
      prdDiff,
      stage2Result.updatePlans
    );
    console.log(`  Found ${stage3Result.features.length} new features`);

    // Execute updates and store updated PRD versions
    console.log('⚡ Executing updates...');
    await this.executeUpdates(stage2Result.updatePlans, prdContent, prdFilePath);

    // Create new issues
    logger.info('➕ Creating new issues for missing features identified in Stage 3...');
    await this.createNewIssues(stage3Result.features, prdFilePath, prdContent);

    // Generate summary
    const summary = {
      updated: stage2Result.updatePlans.length,
      created: stage3Result.features.length,
      unchanged: stage2Result.noUpdateNeeded.length,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync('smart-update-summary.json', JSON.stringify(summary, null, 2));
    logger.info(`✅ Smart PRD Processing Complete: ${summary.updated} updated, ${summary.created} created, ${summary.unchanged} unchanged issues`, {
      action: 'prd_processing_complete',
      summary,
      totalIssuesProcessed: summary.updated + summary.created + summary.unchanged
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