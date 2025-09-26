// scripts/prd-processor-openai.ts
import OpenAI from 'openai';
import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

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
}

interface PRDAnalysis {
  features: AnalyzedFeature[];
  metadata: {
    prdTitle: string;
    summary: string;
    analysisDate: string;
  };
}

class ProductManagerAgent {
  private openai: OpenAI;
  private octokit: Octokit;
  private repoOwner: string;
  private repoName: string;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!
    });

    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN!
    });

    const [owner, repo] = process.env.GITHUB_REPOSITORY!.split('/');
    this.repoOwner = owner;
    this.repoName = repo;
  }

  async loadSystemPrompts(): Promise<{
    analysisPrompt: string;
    issueTemplates: Record<string, string>;
  }> {
    const analysisPrompt = fs.readFileSync(path.join(__dirname, '../../prompts/prd-analysis-prompt.md'), 'utf8');

    const issueTemplates = {
      technical: fs.readFileSync(path.join(__dirname, '../../templates/technical-feature-template.md'), 'utf8'),
      nonTechnical: fs.readFileSync(path.join(__dirname, '../../templates/non-technical-feature-template.md'), 'utf8'),
      enabler: fs.readFileSync(path.join(__dirname, '../../templates/enabler-feature-template.md'), 'utf8')
    };

    return { analysisPrompt, issueTemplates };
  }

  async analyzePRD(prdContent: string, prdPath: string): Promise<PRDAnalysis> {
    const { analysisPrompt } = await this.loadSystemPrompts();

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4000,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: analysisPrompt
        },
        {
          role: 'user',
          content: `Analyze this PRD document and extract features and open questions:

PRD File Path: ${prdPath}

PRD Content:
${prdContent}

Please provide your analysis in JSON format matching the expected structure for features and open questions.`
        }
      ]
    });

    const analysisText = response.choices[0]?.message?.content || '';

    try {
      // Extract JSON from the response (handle potential markdown code blocks)
      const jsonMatch = analysisText.match(/```json\s*([\s\S]*?)\s*```/) ||
        analysisText.match(/({[\s\S]*})/);

      if (!jsonMatch) {
        throw new Error('No valid JSON found in analysis response');
      }

      const analysis = JSON.parse(jsonMatch[1]);

      return {
        features: analysis.features || [],
        metadata: {
          prdTitle: analysis.metadata?.prdTitle || path.basename(prdPath),
          summary: analysis.metadata?.summary || 'PRD analysis generated automatically',
          analysisDate: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Failed to parse PRD analysis:', error);
      throw new Error(`Failed to analyze PRD: ${error}`);
    }
  }

  async createFeatureIssue(feature: AnalyzedFeature, prdPath: string, allFeatures: AnalyzedFeature[] = []): Promise<number> {
    const { issueTemplates } = await this.loadSystemPrompts();

    const templateKey = feature.type === 'non-technical' ? 'nonTechnical' : feature.type;
    const template = issueTemplates[templateKey];

    // Add blocked features section to the issue body
    let blockedFeaturesSection = '';
    if (feature.blockedFeatures && feature.blockedFeatures.length > 0) {
      blockedFeaturesSection = `\n\n### 🚫 Blocked Features\nThis feature blocks the following features:\n${feature.blockedFeatures.map(f => `- ${f}`).join('\n')}\n`;
    }

    const issueBody = template
      .replace('{{DESCRIPTION}}', feature.description)
      .replace('{{ESTIMATED_EFFORT}}', feature.estimatedEffort)
      .replace('{{ACCEPTANCE_CRITERIA}}', feature.acceptanceCriteria.map(ac => `- [ ] ${ac}`).join('\n'))
      .replace('{{DEPENDENCIES}}', feature.dependencies.join(', ') || 'None')
      .replace('{{PRD_PATH}}', prdPath) + blockedFeaturesSection;

    const labels = [
      'prd-generated',
      `type:${feature.type}`,
      `priority:${feature.priority}`,
      ...feature.tags
    ];

    const response = await this.octokit.rest.issues.create({
      owner: this.repoOwner,
      repo: this.repoName,
      title: `[${feature.type.toUpperCase()}] ${feature.title}`,
      body: issueBody,
      labels: labels
    });

    return response.data.number;
  }


  async processPRD(prdFilePath: string): Promise<void> {
    console.log(`Processing PRD file: ${prdFilePath}`);

    if (!fs.existsSync(prdFilePath)) {
      throw new Error(`PRD file not found: ${prdFilePath}`);
    }

    const prdContent = fs.readFileSync(prdFilePath, 'utf8');

    console.log('Analyzing PRD with OpenAI GPT-4...');
    const analysis = await this.analyzePRD(prdContent, prdFilePath);

    console.log(`Found ${analysis.features.length} features`);

    const createdIssues = {
      features: [] as number[]
    };

    // Create feature issues
    for (const feature of analysis.features) {
      console.log(`Creating feature issue: ${feature.title} (${feature.type})`);
      const issueNumber = await this.createFeatureIssue(feature, prdFilePath, analysis.features);
      createdIssues.features.push(issueNumber);
    }

    // Create summary for workflow
    const summary = {
      totalIssues: createdIssues.features.length,
      technical: analysis.features.filter(f => f.type === 'technical').length,
      nonTechnical: analysis.features.filter(f => f.type === 'non-technical').length,
      enablers: analysis.features.filter(f => f.type === 'enabler').length,
      prdPath: prdFilePath,
      createdIssues
    };

    fs.writeFileSync('generated-issues-summary.json', JSON.stringify(summary, null, 2));
    console.log('PRD processing completed successfully');
  }
}

// Main execution
async function main() {
  const prdFilePath = process.argv[2];

  if (!prdFilePath) {
    console.error('Usage: ts-node prd-processor-openai.ts <prd-file-path>');
    process.exit(1);
  }

  try {
    const agent = new ProductManagerAgent();
    await agent.processPRD(prdFilePath);
  } catch (error) {
    console.error('Error processing PRD:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}