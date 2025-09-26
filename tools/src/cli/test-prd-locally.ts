#!/usr/bin/env ts-node

// scripts/test-prd-locally.ts
// Local testing script for PRD processing with file-based issue storage

import { SmartPRDProcessor } from '../processors/SmartPRDProcessor';
import { IssueServiceFactory } from '../services/IssueServiceFactory';
import { FileSystemIssueService } from '../services/implementations/FileSystemIssueService';
import { loadConfig } from '../config';
import { log, setLogLevel } from '../utils/logger';
import { generateProcessingSummary } from '../utils/summaryGenerator';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Global verbose flag
let VERBOSE = false;

function showHelp() {
  log.info(`
🧪 Local PRD Processing Test Environment

USAGE:
  pnpm run test-local [options]

OPTIONS:
  --verbose, -v    Enable verbose/debug logging for detailed operation info
  --debug, -d      Enable debug logging (same as --verbose)
  --help, -h       Show this help message

DESCRIPTION:
  Interactive CLI tool for testing PRD processing locally using FileSystem storage.
  All operations are logged to files in the logs/ directory.

FEATURES:
  • Process PRDs with force create or update modes
  • View and manage generated issues
  • Compare PRD versions and diffs
  • Test AI-powered PRD analysis locally
  • Generate operation summaries from logs

EXAMPLES:
  pnpm run test-local                 # Start interactive mode
  pnpm run test-local --verbose       # Start with debug logging
  pnpm run test-local --help          # Show this help
`);
}

function parseArguments() {
  const args = process.argv.slice(2);
  const flags = {
    verbose: args.includes('--verbose') || args.includes('-v') || args.includes('--debug') || args.includes('-d'),
    help: args.includes('--help') || args.includes('-h')
  };

  if (flags.help) {
    showHelp();
    process.exit(0);
  }

  VERBOSE = flags.verbose;

  if (flags.verbose) {
    setLogLevel('debug');
    log.info('🔧 Debug/Verbose mode enabled');
    log.info('🔍 Detailed logging will be shown for all operations and saved to logs/');
  } else {
    setLogLevel('info');
  }

  return flags;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function displayIssues(issueService: FileSystemIssueService): Promise<void> {
  log.debug('Fetching issues with filter: { state: "open" }');
  const issues = await issueService.getIssues({ state: 'open' });
  log.debug(`Found ${issues.length} issues`);

  if (issues.length === 0) {
    log.info('📭 No issues found');
    log.debug('No issues to display');
    return;
  }

  log.debug('Displaying issues:', issues.map(i => ({ number: i.number, title: i.title, labels: i.labels })));

  log.info('\n📋 Current Issues:');
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
  // Parse command line arguments
  const flags = parseArguments();

  log.info('🧪 Local PRD Processing Test Environment');
  log.info('=========================================\n');

  // Configuration
  const issuesPath = path.join(__dirname, '../../../.test-issues');
  const prdPath = path.join(__dirname, '../../../spec/prd/customer-data-management.md');

  log.debug('Configuration loaded:', {
    issuesPath: path.resolve(issuesPath),
    prdPath: path.resolve(prdPath),
    __dirname,
    cwd: process.cwd()
  });

  // Check if PRD exists
  log.debug('Checking PRD file existence...');
  if (!fs.existsSync(prdPath)) {
    log.error(`❌ PRD file not found: ${prdPath}`);
    log.error('Please ensure the PRD file exists before running tests.');
    process.exit(1);
  }
  log.debug('✅ PRD file found');

  // Create issue service
  log.debug('Initializing FileSystemIssueService with path:', issuesPath);
  const issueService = new FileSystemIssueService(issuesPath);
  log.debug('✅ Issue service created');

  // SmartPRDProcessor will be initialized lazily when needed
  let processor: SmartPRDProcessor | null = null;
  const getProcessor = () => {
    if (!processor) {
      log.debug('Initializing SmartPRDProcessor...');
      processor = new SmartPRDProcessor(issueService);
      log.debug('✅ PRD processor created');
    }
    return processor;
  };

  log.info(`📁 Issue storage: ${path.resolve(issuesPath)}`);
  log.info(`📄 PRD file: ${prdPath}`);

  // Display AI provider and masked API key
  log.debug('Loading configuration...');
  const config = loadConfig();
  log.debug('Configuration loaded:', {
    hasOpenAIKey: !!config.openai?.apiKey,
    hasGitHubToken: !!config.github?.token,
    hasAnthropicKey: !!config.anthropic?.apiKey
  });

  const apiKey = config.openai?.apiKey || '';
  const maskedKey = apiKey ? `${apiKey.substring(0, 7)}...${apiKey.substring(apiKey.length - 4)}` : 'Not configured';

  log.info(`🤖 AI Provider: OpenAI (GPT-4o)`);
  log.info(`🔑 API Key: ${maskedKey}\n`);

  if (VERBOSE && apiKey) {
    log.debug('API key length:', apiKey.length);
    log.debug('API key prefix:', apiKey.substring(0, 10) + '...');
  }

  // Interactive menu
  let running = true;
  while (running) {
    log.info('\nChoose an action:');
    console.log('1. Process PRD (create new issues)');
    console.log('2. Update PRD and process changes');
    console.log('3. View all issues');
    console.log('4. View specific issue');
    console.log('5. View PRD version for issue');
    console.log('6. View PRD diff for issue');
    console.log('7. Clear all issues');
    console.log('8. Generate processing summary');
    console.log('0. Exit');

    const choice = await question('\nYour choice: ');
    log.debug('User selected choice:', choice);

    switch (choice) {
      case '1':
        log.info('\n🚀 Processing PRD (force create mode)...');
        log.prdStart(prdPath, true);
        log.debug('Starting PRD processing with force create mode');
        log.debug('PRD file path:', prdPath);
        try {
          await getProcessor().processPRD(prdPath, true);
          log.debug('✅ PRD processing completed successfully');
          log.debug('Displaying updated issues...');
          await displayIssues(issueService);
        } catch (error) {
          log.error('❌ Error:', error);
          if (VERBOSE) {
            log.debug('Error details:', error);
            log.debug('Error stack:', (error as Error).stack);
          }
        }
        break;

      case '2':
        log.info('\n🔄 Processing PRD updates...');
        log.prdStart(prdPath, false);
        log.debug('Starting PRD processing with update mode (force create: false)');
        log.debug('PRD file path:', prdPath);
        try {
          await getProcessor().processPRD(prdPath, false);
          log.debug('✅ PRD update processing completed successfully');
          log.debug('Displaying updated issues...');
          await displayIssues(issueService);
        } catch (error) {
          log.error('❌ Error:', error);
          if (VERBOSE) {
            log.debug('Error details:', error);
            log.debug('Error stack:', (error as Error).stack);
          }
        }
        break;

      case '3':
        log.debug('Displaying all issues...');
        await displayIssues(issueService);
        break;

      case '4':
        const issueNum = await question('Enter issue number: ');
        log.debug('User requested issue number:', issueNum);
        log.debug('Parsing issue number:', parseInt(issueNum));

        const issue = await issueService.getIssue(parseInt(issueNum));
        if (issue) {
          log.debug('Issue found:', { number: issue.number, title: issue.title, bodyLength: issue.body.length, commentsCount: issue.comments?.length || 0 });
          console.log('\n' + '='.repeat(80));
          console.log(`Issue #${issue.number}: ${issue.title}`);
          console.log('='.repeat(80));
          console.log(issue.body);
          console.log('='.repeat(80));

          if (issue.comments && issue.comments.length > 0) {
            log.debug(`Displaying ${issue.comments.length} comments`);
            console.log('\nComments:');
            for (const comment of issue.comments) {
              console.log(`\n[${comment.author}] ${new Date(comment.created_at).toLocaleString()}`);
              console.log(comment.body);
            }
          } else {
            log.debug('No comments to display');
          }
        } else {
          log.info('❌ Issue not found');
          log.debug('Issue not found for number:', issueNum);
        }
        break;

      case '5':
        const issueNumForPRD = await question('Enter issue number to view PRD version: ');
        log.debug('User requested PRD version for issue:', issueNumForPRD);
        log.debug('Parsing issue number:', parseInt(issueNumForPRD));

        try {
          log.debug('Calling getPRDVersion for issue:', parseInt(issueNumForPRD));
          const prdVersion = await issueService.getPRDVersion!(parseInt(issueNumForPRD));

          if (prdVersion) {
            log.debug('PRD version found, length:', prdVersion.length);
            log.debug('PRD version preview (first 100 chars):', prdVersion.substring(0, 100) + '...');
            console.log('\n' + '='.repeat(80));
            console.log(`PRD Version for Issue #${issueNumForPRD}`);
            console.log('='.repeat(80));
            console.log(prdVersion);
            console.log('='.repeat(80));
          } else {
            log.info('❌ No PRD version found for this issue');
            log.debug('No PRD version found for issue:', issueNumForPRD);
          }
        } catch (error) {
          log.error('❌ Error retrieving PRD version:', error);
          if (VERBOSE) {
            log.debug('Error details:', error);
            log.debug('Error stack:', (error as Error).stack);
          }
        }
        break;

      case '6':
        const issueNumForDiff = await question('Enter issue number to view PRD diff: ');
        log.debug('User requested PRD diff for issue:', issueNumForDiff);
        log.debug('Parsing issue number:', parseInt(issueNumForDiff));
        log.debug('Reading current PRD from:', prdPath);

        try {
          const currentPRD = fs.readFileSync(prdPath, 'utf8');
          log.debug('Current PRD loaded, length:', currentPRD.length);
          log.debug('Calling getPRDDiff for issue:', parseInt(issueNumForDiff));

          const diff = await issueService.getPRDDiff!(parseInt(issueNumForDiff), currentPRD);
          log.debug('PRD diff generated, length:', diff.length);
          log.debug('Diff preview (first 200 chars):', diff.substring(0, 200) + '...');

          console.log('\n' + '='.repeat(80));
          console.log(`PRD Diff for Issue #${issueNumForDiff}`);
          console.log('='.repeat(80));
          console.log(diff);
          console.log('='.repeat(80));
        } catch (error) {
          log.error('❌ Error generating PRD diff:', error);
          if (VERBOSE) {
            log.debug('Error details:', error);
            log.debug('Error stack:', (error as Error).stack);
          }
        }
        break;

      case '7':
        const confirm = await question('Are you sure you want to clear all issues? (yes/no): ');
        log.debug('User confirmation for clearing issues:', confirm);
        if (confirm.toLowerCase() === 'yes') {
          log.debug('Clearing all issues from path:', issuesPath);
          if (fs.existsSync(issuesPath)) {
            log.debug('Issues directory exists, removing...');
            fs.rmSync(issuesPath, { recursive: true, force: true });
            log.debug('✅ Issues directory removed');
          } else {
            log.debug('Issues directory does not exist');
          }
          log.debug('Creating fresh issues directory...');
          fs.mkdirSync(issuesPath, { recursive: true });
          log.info('✅ All issues cleared');
          log.debug('✅ Fresh issues directory created');
        } else {
          log.debug('Issue clearing cancelled by user');
        }
        break;

      case '8':
        log.debug('User requested processing summary generation');
        try {
          log.info('\n📊 Generating processing summary from logs...');
          const summaryPath = await generateProcessingSummary();
          log.info(`✅ Processing summary saved to: ${summaryPath}`);
          log.info('📄 Both markdown (.md) and JSON (.json) versions have been created');
        } catch (error) {
          log.error('❌ Error generating processing summary:', error);
          if (VERBOSE) {
            log.debug('Summary generation error details:', error);
            log.debug('Error stack:', (error as Error).stack);
          }
        }
        break;

      case '0':
        log.debug('User chose to exit');
        running = false;
        break;

      default:
        log.warn('❌ Invalid choice');
        log.debug('Invalid menu choice:', choice);
    }
  }

  log.info('\n👋 Goodbye!');
  rl.close();
}

// Run the test
main().catch(error => log.error('Unhandled error in main:', error));