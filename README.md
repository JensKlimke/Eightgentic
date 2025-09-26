# Eightgent - Agentic Code Generation Platform

Transform Product Requirements Documents (PRDs) into executable code using AI-powered agents.

## 🏗️ Architecture

Eightgent is designed as a **dual-purpose platform**:

1. **Generation Tools** (`tools/`) - AI-powered agents for processing PRDs
2. **Generated Code** (`src/`) - Output directory for generated application code

```
eightgent/
├── tools/                   # 🤖 Agentic generation tools
│   ├── src/
│   │   ├── processors/      # PRD → Issues processors
│   │   ├── services/        # Issue management
│   │   ├── cli/             # Command-line tools
│   │   └── config/          # Configuration
│   ├── prompts/             # AI prompts
│   ├── templates/           # Issue templates
│   └── dist/                # Compiled tools
├── src/                     # 📁 Generated application code
├── spec/                    # 📋 PRD specifications
│   └── prd/
└── .github/                 # ⚙️ Workflows
```

## 🚀 Quick Start

### Installation
```bash
# Install dependencies for both tools and generated code
pnpm install

# Install tools dependencies
cd tools && pnpm install
```

### Environment Setup
```bash
# Copy and configure environment
cp .env.example .env

# Set your API keys
OPENAI_API_KEY=your_openai_key
GITHUB_TOKEN=your_github_token
```

### Process a PRD
```bash
# Interactive local testing
pnpm run test-local

# Process PRD with smart updates
pnpm run process-prd-smart spec/prd/customer-data-management.md
```

## 🔧 Tools Overview

### Processors
- **SmartPRDProcessor** - Intelligent 3-stage analysis with issue updates
- **OpenAIPRDProcessor** - OpenAI GPT-4 based processing
- **BasicPRDProcessor** - Anthropic Claude based processing

### Services
- **FileSystemIssueService** - Local file-based issue storage
- **GitHubIssueService** - GitHub API integration
- **InMemoryIssueService** - Testing service

### Features
- ✅ **Smart Issue Updates** - Only updates changed issues
- ✅ **PRD Version Tracking** - Stores PRD snapshots with issues
- ✅ **Multi-stage Analysis** - Identifies relevant issues → plans updates → creates new issues
- ✅ **Dependency Injection** - Pluggable service architecture
- ✅ **TypeScript Best Practices** - Proper module structure and exports

## 📖 Usage

### Development Workflow

1. **Write PRD** - Create specification in `spec/prd/`
2. **Process PRD** - Run tools to generate issues
3. **Generate Code** - Tools output code to `src/`
4. **Iterate** - Update PRD and re-process for smart updates

### Available Commands

```bash
# Tools development
pnpm run build:tools         # Build tools
pnpm run dev:tools           # Watch mode for tools

# PRD Processing
pnpm run test-local          # Interactive testing
pnpm run process-prd-smart   # Smart processing with updates
pnpm run process-prd-openai  # OpenAI processing
pnpm run process-prd         # Basic Anthropic processing

# Generated Code
pnpm run build:generated     # Build generated code
pnpm run build              # Build everything
```

### Configuration

Tools configuration in `tools/src/config/`:
- OpenAI API integration
- GitHub API setup
- Service factory patterns

## 🎯 Core Concepts

### Agentic Generation
The platform uses AI agents to:
1. **Analyze** PRDs for features and requirements
2. **Generate** GitHub issues with proper categorization
3. **Update** existing issues intelligently
4. **Track** changes between PRD versions

### Issue Management
- **File-based Storage** - Issues stored as YAML + Markdown files
- **PRD Version Tracking** - Each issue links to PRD snapshot
- **Smart Diffing** - Compare current PRD with stored versions
- **Incremental Updates** - Only change what's actually different

### TypeScript Architecture
- **Barrel Exports** - Clean import patterns
- **Dependency Injection** - Testable service architecture
- **Type Safety** - Full TypeScript coverage
- **Modular Design** - Separated concerns and responsibilities

## 📁 Generated Code

The `src/` directory is reserved for **generated application code**. The tools will output:
- API endpoints
- Database models
- UI components
- Business logic
- Tests

## 🛠️ Development

### Adding New Processors
```typescript
// tools/src/processors/MyProcessor.ts
export class MyProcessor {
  async processPRD(prdContent: string): Promise<void> {
    // Implementation
  }
}
```

### Creating Custom Services
```typescript
// Implement IIssueService interface
export class MyIssueService implements IIssueService {
  // Required methods
}
```

### Extending Configuration
```typescript
// tools/src/config/index.ts
export interface CustomConfig extends Config {
  myService?: {
    apiKey: string;
  };
}
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes in `tools/` directory
4. Test with `pnpm run test-local`
5. Submit pull request

## 📜 License

MIT License - see LICENSE file for details.