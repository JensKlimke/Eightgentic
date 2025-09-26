// config/index.ts
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from parent directory (project root)
dotenv.config({ path: path.join(__dirname, '../../..', '.env') });

export interface Config {
  openai?: {
    apiKey: string;
  };
  github?: {
    token: string;
    owner: string;
    repo: string;
  };
  anthropic?: {
    apiKey: string;
  };
}

export function loadConfig(): Config {
  return {
    openai: {
      apiKey: process.env.OPENAI_API_KEY || ''
    },
    github: {
      token: process.env.GITHUB_TOKEN || '',
      owner: process.env.GITHUB_OWNER || '',
      repo: process.env.GITHUB_REPO || ''
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || ''
    }
  };
}