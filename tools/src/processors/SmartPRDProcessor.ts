// scripts/prd-processor-smart.ts

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IIssueService, Issue, IssueData } from '../services/interfaces/IIssueService';
import { IssueServiceFactory } from '../services/IssueServiceFactory';

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
        return await this.issueService.getPRDDiff(firstIssue.number, prdContent);
      } catch (error) {
        console.warn('Could not get PRD diff from stored version:', error);
      }
    }
    return 'No stored PRD version available for comparison';
  }

  async loadPrompt(promptFile: string): Promise<string> {
    return fs.readFileSync(path.join(__dirname, '../../prompts', promptFile), 'utf8');
  }

  async analyzeWithAI(prompt: string, userContent: string): Promise<any> {
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
    return this.parseAIResponse(content);
  }

  private parseAIResponse(content: string): any {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      content.match(/({[\s\S]*})/);
    if (!jsonMatch) {
      throw new Error('No valid JSON found in AI response');
    }
    return JSON.parse(jsonMatch[1]);
  }

  // Stage 1: Identify relevant issues
  async identifyRelevantIssues(
    prdContent: string,
    prdDiff: string,
    existingIssues: Issue[]
  ): Promise<Stage1Result> {
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

    return await this.analyzeWithAI(prompt, userContent);
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

    return await this.analyzeWithAI(prompt, userContent);
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
    console.log(`🔄 Smart PRD Processing: ${prdFilePath}`);

    if (!fs.existsSync(prdFilePath)) {
      throw new Error(`PRD file not found: ${prdFilePath}`);
    }

    const prdContent = fs.readFileSync(prdFilePath, 'utf8');

    // Get existing issues
    const existingIssues = await this.issueService.getIssues({
      state: 'open',
      labels: ['prd-generated']
    });

    console.log(`📊 Found ${existingIssues.length} existing issues`);

    if (forceCreate || existingIssues.length === 0) {
      console.log('🆕 Creating new issues (no existing issues or force create mode)');
      await this.createAllNewIssues(prdContent, prdFilePath);
      return;
    }

    // Get PRD diff using stored versions
    const prdDiff = await this.getPRDDiff(prdContent, existingIssues);
    console.log(`📋 PRD changes analysis: ${prdDiff.split('\n').length} lines of diff`);

    // Stage 1: Identify relevant issues
    console.log('🔍 Stage 1: Identifying relevant issues...');
    const stage1Result = await this.identifyRelevantIssues(
      prdContent,
      prdDiff,
      existingIssues
    );
    console.log(`  Found ${stage1Result.relevantIssues.length} relevant issues`);

    // Stage 2: Plan updates
    console.log('📝 Stage 2: Planning issue updates...');
    const stage2Result = await this.planIssueUpdates(
      stage1Result.relevantIssues,
      existingIssues,
      prdContent,
      prdDiff
    );
    console.log(`  Planned ${stage2Result.updatePlans.length} updates`);

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
    console.log('➕ Creating new issues...');
    await this.createNewIssues(stage3Result.features, prdFilePath, prdContent);

    // Generate summary
    const summary = {
      updated: stage2Result.updatePlans.length,
      created: stage3Result.features.length,
      unchanged: stage2Result.noUpdateNeeded.length,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync('smart-update-summary.json', JSON.stringify(summary, null, 2));
    console.log('✅ Smart PRD processing completed successfully');
    console.log(`   Updated: ${summary.updated}, Created: ${summary.created}, Unchanged: ${summary.unchanged}`);
  }

  private async executeUpdates(updatePlans: Stage2Result['updatePlans'], prdContent: string, prdPath: string): Promise<void> {
    for (const plan of updatePlans) {
      console.log(`  Updating issue #${plan.issueNumber}: ${plan.updateSummary}`);

      if (Object.keys(plan.updates).length > 0) {
        await this.issueService.updateIssue(plan.issueNumber, plan.updates);
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