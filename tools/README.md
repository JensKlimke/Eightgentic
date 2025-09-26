# Eightgent Tools

Agentic code generation tools for processing Product Requirements Documents (PRDs) into GitHub issues and executable code.

## Architecture

This directory contains the core tooling infrastructure for the Eightgent platform:

```
tools/
├── src/
│   ├── processors/          # PRD processing engines
│   ├── services/            # Issue management services
│   ├── cli/                 # Command-line interfaces
│   ├── config/              # Configuration management
│   └── index.ts             # Main exports
├── prompts/                 # AI prompts
├── templates/               # Issue templates
└── dist/                    # Compiled TypeScript
```

## Quick Start

### Installation
```bash
cd tools
pnpm install
```

### Build
```bash
pnpm run build
```

### Development
```bash
pnpm run dev  # Watch mode
```

## Usage

### Local Testing
```bash
pnpm run test-local
```

### Process PRD Files
```bash
# Basic processor (Anthropic)
pnpm run process-prd spec/prd/customer-data-management.md

# OpenAI processor
pnpm run process-prd-openai spec/prd/customer-data-management.md

# Smart processor (with issue updates)
pnpm run process-prd-smart spec/prd/customer-data-management.md
```

## Core Components

### Processors
- **BasicPRDProcessor** - Anthropic Claude-based PRD analysis
- **OpenAIPRDProcessor** - OpenAI GPT-based PRD analysis
- **SmartPRDProcessor** - Intelligent update system with multi-stage analysis

### Services
- **IIssueService** - Interface for issue management
- **FileSystemIssueService** - File-based issue storage
- **GitHubIssueService** - GitHub API integration
- **InMemoryIssueService** - In-memory testing

### Configuration

Set environment variables:
```bash
OPENAI_API_KEY=your_openai_key
GITHUB_TOKEN=your_github_token
GITHUB_OWNER=your_username
GITHUB_REPO=your_repository
```

## Development

### Adding New Processors
1. Create processor in `src/processors/`
2. Export from `src/processors/index.ts`
3. Add CLI script if needed

### Adding New Services
1. Implement `IIssueService` interface
2. Add to `src/services/implementations/`
3. Update `IssueServiceFactory`