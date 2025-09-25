# Repository Structure

Here's the recommended folder structure for your repository:

```
your-repo/
├── .github/
│   └── workflows/
│       └── prd-to-issues.yml
├── spec/
│   ├── prd/                    # PRD documents go here
│   │   ├── feature-x.md        # Example PRD
│   │   └── integration-y.md    # Another PRD
│   └── arch/                   # Architecture docs
├── scripts/
│   └── prd-processor.ts        # Main processing script
├── prompts/
│   └── prd-analysis-prompt.md  # System prompt for Claude
├── templates/
│   ├── technical-feature-template.md
│   ├── non-technical-feature-template.md
│   ├── enabler-feature-template.md
│   └── open-question-template.md
├── package.json                # Dependencies
└── README.md
```

## Setup Instructions

### 1. Repository Secrets
Add these secrets in your GitHub repository settings:

- `ANTHROPIC_API_KEY`: Your Anthropic API key for Claude
- `GITHUB_TOKEN`: Automatically provided by GitHub Actions

### 2. Package.json
Create a `package.json` file:

```json
{
  "name": "prd-processor",
  "version": "1.0.0",
  "description": "Automated PRD to GitHub Issues processor",
  "scripts": {
    "process-prd": "ts-node scripts/prd-processor.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "@octokit/rest": "^20.0.0",
    "typescript": "^5.0.0",
    "ts-node": "^10.9.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0"
  }
}
```

### 3. Initial Workflow Test

1. Set up the folder structure
2. Add all the files (workflow, scripts, prompts, templates)
3. Configure repository secrets
4. Create a test PRD in `spec/prd/test-feature.md`
5. Push to trigger the workflow

### 4. PRD Document Format

Your PRD documents should be well-structured markdown files. Here's a suggested format:

```markdown
# Feature Name

## Overview
Brief description of what we're building and why.

## Goals
- Primary goal 1
- Primary goal 2

## Requirements
### Functional Requirements
- Requirement 1
- Requirement 2

### Non-Functional Requirements  
- Performance requirements
- Security requirements
- Scalability requirements

## User Stories
As a [user type], I want [functionality] so that [benefit].

## Success Metrics
How we'll measure success.

## Open Questions
- Question 1: What should happen when...?
- Question 2: How do we handle...?

## Dependencies
- External system X
- Feature Y must be completed first

## Timeline
Expected delivery timeline and milestones.
```

## Workflow Behavior

1. **Trigger**: Workflow runs when PRD files are added/modified in `spec/prd/`
2. **Analysis**: Claude analyzes the PRD content using the system prompt
3. **Issue Creation**: Automatically creates GitHub issues for:
    - Technical features (🔧)
    - Non-technical features (📋)
    - Enabler features (🚀)
    - Open questions (❓) - marked as blockers
4. **Labeling**: Issues get appropriate labels for filtering and organization
5. **Summary**: Commit comment with summary of created issues

## Customization Options

- **Modify templates**: Adjust issue templates in `/templates/` folder
- **Update system prompt**: Fine-tune the analysis behavior in `/prompts/`
- **Add validation**: Extend the TypeScript script for additional checks
- **Custom labels**: Modify the labeling strategy in the processor script
- **Integration**: Add Slack notifications, project board automation, etc.

This solution provides a complete automated pipeline from PRD document to organized, actionable GitHub issues ready for development teams.