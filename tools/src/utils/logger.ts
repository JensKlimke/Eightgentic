import winston from 'winston';
import * as path from 'path';

// Define log levels with priorities
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4
};

// Create logs directory path
const logsDir = path.join(__dirname, '../../../logs');

// Custom format for file logs with detailed context (single-line JSON)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json({ space: 0 }) // Explicitly no spacing for single-line
);

// Custom format for console logs with emoji indicators
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const emoji = {
      error: '❌',
      warn: '⚠️',
      info: '📋',
      debug: '🔍',
      verbose: '🔬'
    }[level.replace(/\u001b\[[0-9;]*m/g, '')] || '📝';

    let output = `${emoji} [${timestamp}] ${level}: ${message}`;

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      output += '\n' + JSON.stringify(meta, null, 2);
    }

    return output;
  })
);

// Logger configuration
const logger = winston.createLogger({
  levels: LOG_LEVELS,
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    }),

    // Separate file for error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 3,
      tailable: true
    }),

    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
    })
  ],

  // Handle uncaught exceptions and unhandled rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: fileFormat
    })
  ],

  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: fileFormat
    })
  ]
});

// Create a child logger for specific modules
export function createModuleLogger(module: string) {
  return logger.child({ module });
}

// Enhanced logging methods with context
export const log = {
  error: (message: string, meta?: any) => logger.error(message, meta),
  warn: (message: string, meta?: any) => logger.warn(message, meta),
  info: (message: string, meta?: any) => logger.info(message, meta),
  debug: (message: string, meta?: any) => logger.debug(message, meta),
  verbose: (message: string, meta?: any) => logger.verbose(message, meta),

  // Special methods for PRD processing
  prdStart: (prdPath: string, forceCreate: boolean) => {
    logger.info('🚀 PRD Processing Started', {
      action: 'prd_processing_start',
      prdPath,
      forceCreate,
      timestamp: new Date().toISOString()
    });
  },

  prdEnd: (prdPath: string, issuesCreated: number, issuesUpdated: number) => {
    logger.info('✅ PRD Processing Completed', {
      action: 'prd_processing_end',
      prdPath,
      issuesCreated,
      issuesUpdated,
      timestamp: new Date().toISOString()
    });
  },

  issueCreated: (issueNumber: number, title: string, labels: string[], reason: string, content?: string) => {
    logger.info('📝 Issue Created', {
      action: 'issue_created',
      issueNumber,
      title,
      labels,
      reason,
      contentLength: content?.length || 0,
      contentPreview: content ? content.substring(0, 200) + '...' : undefined,
      timestamp: new Date().toISOString()
    });
  },

  issueUpdated: (issueNumber: number, title: string, changes: string[], reason: string) => {
    logger.info('📝 Issue Updated', {
      action: 'issue_updated',
      issueNumber,
      title,
      changes,
      reason,
      timestamp: new Date().toISOString()
    });
  },

  aiInteraction: (prompt: string, response: string, model: string, tokens?: number) => {
    logger.debug('🤖 AI Interaction', {
      action: 'ai_interaction',
      model,
      tokens,
      promptLength: prompt.length,
      responseLength: response.length,
      promptPreview: prompt.substring(0, 100) + '...',
      responsePreview: response.substring(0, 200) + '...',
      timestamp: new Date().toISOString()
    });
  },

  prdAnalysis: (section: string, analysis: any, reasoning: string) => {
    logger.debug('🔍 PRD Analysis', {
      action: 'prd_analysis',
      section,
      analysis,
      reasoning,
      timestamp: new Date().toISOString()
    });
  }
};

// Set log level based on verbose flag
export function setLogLevel(level: 'error' | 'warn' | 'info' | 'debug' | 'verbose') {
  logger.level = level;
  logger.info(`🔧 Log level set to: ${level}`);
}

// Create logs directory if it doesn't exist
import * as fs from 'fs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

export default logger;