#!/usr/bin/env ts-node

// scripts/test-prd-locally.ts
// Local testing script for PRD processing with file-based issue storage

import { SmartPRDProcessor } from './prd-processor-smart';
import { IssueServiceFactory } from '../services/IssueServiceFactory';
import { FileSystemIssueService } from '../services/FileSystemIssueService';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function displayIssues(issueService: FileSystemIssueService): Promise<void> {
  const issues = await issueService.getIssues({ state: 'open' });

  if (issues.length === 0) {
    console.log('📭 No issues found');
    return;
  }

  console.log('\n📋 Current Issues:');
  console.log('─'.repeat(80));

  for (const issue of issues) {
    console.log(`\n#${issue.number}: ${issue.title}`);
    console.log(`  State: ${issue.state} | Labels: ${issue.labels.join(', ')}`);
    console.log(`  Created: ${new Date(issue.created_at).toLocaleString()}`);
    console.log(`  File: ${issue.html_url}`);
  }

  console.log('─'.repeat(80));
  console.log(`Total: ${issues.length} issues\n`);
}


async function main() {
  console.log('🧪 Local PRD Processing Test Environment');
  console.log('=========================================\n');

  // Configuration
  const issuesPath = '.test-issues';
  const prdPath = 'spec/prd/customer-data-management.md';

  // Check if PRD exists
  if (!fs.existsSync(prdPath)) {
    console.error(`❌ PRD file not found: ${prdPath}`);
    console.error('Please ensure the PRD file exists before running tests.');
    process.exit(1);
  }

  // Create issue service
  const issueService = new FileSystemIssueService(issuesPath);
  const processor = new SmartPRDProcessor(issueService);

  console.log(`📁 Issue storage: ${path.resolve(issuesPath)}`);
  console.log(`📄 PRD file: ${prdPath}`);

  // Display AI provider and masked API key
  const apiKey = process.env.OPENAI_API_KEY || '';
  const maskedKey = apiKey ? `${apiKey.substring(0, 7)}...${apiKey.substring(apiKey.length - 4)}` : 'Not configured';

  console.log(`🤖 AI Provider: OpenAI (GPT-4o)`);
  console.log(`🔑 API Key: ${maskedKey}\n`);

  // Interactive menu
  let running = true;
  while (running) {
    console.log('\nChoose an action:');
    console.log('1. Process PRD (create new issues)');
    console.log('2. Update PRD and process changes');
    console.log('3. View all issues');
    console.log('4. View specific issue');
    console.log('5. View PRD version for issue');
    console.log('6. View PRD diff for issue');
    console.log('7. Clear all issues');
    console.log('0. Exit');

    const choice = await question('\nYour choice: ');

    switch (choice) {
      case '1':
        console.log('\n🚀 Processing PRD (force create mode)...');
        try {
          await processor.processPRD(prdPath, true);
          await displayIssues(issueService);
        } catch (error) {
          console.error('❌ Error:', error);
        }
        break;

      case '2':
        console.log('\n🔄 Processing PRD updates...');
        try {
          await processor.processPRD(prdPath, false);
          await displayIssues(issueService);
        } catch (error) {
          console.error('❌ Error:', error);
        }
        break;

      case '3':
        await displayIssues(issueService);
        break;

      case '4':
        const issueNum = await question('Enter issue number: ');
        const issue = await issueService.getIssue(parseInt(issueNum));
        if (issue) {
          console.log('\n' + '='.repeat(80));
          console.log(`Issue #${issue.number}: ${issue.title}`);
          console.log('='.repeat(80));
          console.log(issue.body);
          console.log('='.repeat(80));

          if (issue.comments && issue.comments.length > 0) {
            console.log('\nComments:');
            for (const comment of issue.comments) {
              console.log(`\n[${comment.author}] ${new Date(comment.created_at).toLocaleString()}`);
              console.log(comment.body);
            }
          }
        } else {
          console.log('❌ Issue not found');
        }
        break;

      case '5':
        const issueNumForPRD = await question('Enter issue number to view PRD version: ');
        const prdVersion = await issueService.getPRDVersion!(parseInt(issueNumForPRD));
        if (prdVersion) {
          console.log('\n' + '='.repeat(80));
          console.log(`PRD Version for Issue #${issueNumForPRD}`);
          console.log('='.repeat(80));
          console.log(prdVersion);
          console.log('='.repeat(80));
        } else {
          console.log('❌ No PRD version found for this issue');
        }
        break;

      case '6':
        const issueNumForDiff = await question('Enter issue number to view PRD diff: ');
        const currentPRD = fs.readFileSync(prdPath, 'utf8');
        const diff = await issueService.getPRDDiff!(parseInt(issueNumForDiff), currentPRD);
        console.log('\n' + '='.repeat(80));
        console.log(`PRD Diff for Issue #${issueNumForDiff}`);
        console.log('='.repeat(80));
        console.log(diff);
        console.log('='.repeat(80));
        break;

      case '7':
        const confirm = await question('Are you sure you want to clear all issues? (yes/no): ');
        if (confirm.toLowerCase() === 'yes') {
          if (fs.existsSync(issuesPath)) {
            fs.rmSync(issuesPath, { recursive: true, force: true });
          }
          fs.mkdirSync(issuesPath, { recursive: true });
          console.log('✅ All issues cleared');
        }
        break;

      case '0':
        running = false;
        break;

      default:
        console.log('❌ Invalid choice');
    }
  }

  console.log('\n👋 Goodbye!');
  rl.close();
}

// Run the test
main().catch(console.error);