const winston = require("winston");
const path = require("path");
const fs = require("fs");

// ============================================================================
// ENVIRONMENT VARIABLE VALIDATION
// ============================================================================

// Validate required environment variables
const requiredVars = ["NODE_ENV", "NAME_APP", "PATH_TO_LOGS"];
const missingVars = requiredVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(
    `FATAL ERROR: Missing required environment variable(s): ${missingVars.join(", ")}\n` +
      `Please add the following to your .env file:\n` +
      missingVars.map((v) => `  ${v}=<value>`).join("\n")
  );
  process.exit(1);
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Determine environment
const nodeEnv = process.env.NODE_ENV;
const isProduction = nodeEnv === "production";
const isTesting = nodeEnv === "testing";
const isDevelopment = nodeEnv === "development";

// Validate NODE_ENV value
if (!isProduction && !isTesting && !isDevelopment) {
  console.error(
    `FATAL ERROR: NODE_ENV must be one of: development, testing, production\n` +
      `Current value: ${nodeEnv}`
  );
  process.exit(1);
}

// Detect if running as child process
const isChildProcess = process.send !== undefined;

// Determine process name
let processName;
let processId;

if (isChildProcess) {
  // Child process: Look for NAME_CHILD_PROCESS_* variables
  const childProcessEnvKey = Object.keys(process.env).find((key) =>
    key.startsWith("NAME_CHILD_PROCESS_")
  );

  if (!childProcessEnvKey) {
    console.error(
      "FATAL ERROR: Child process requires NAME_CHILD_PROCESS_[descriptor] environment variable.\n" +
        "Please add the appropriate variable to the parent process .env file.\n" +
        "Example: NAME_CHILD_PROCESS_SEMANTIC_SCORER=MyApp_SemanticScorer"
    );
    process.exit(1);
  }

  processName = process.env[childProcessEnvKey];
  processId = `${processName}:${process.pid}`;
} else {
  // Parent process: Use NAME_APP
  processName = process.env.NAME_APP;
  processId = processName;
}

// Log directory and file rotation settings
const logDir = process.env.PATH_TO_LOGS;
const maxSizeMB = parseInt(process.env.LOG_MAX_SIZE) || 5; // Default 5MB
const maxSizeBytes = maxSizeMB * 1024 * 1024; // Convert MB to bytes
const maxFiles = parseInt(process.env.LOG_MAX_FILES) || 5; // Default 5 files

// Determine log level based on environment
let logLevel;
if (isDevelopment) {
  logLevel = "debug"; // All levels in development
} else if (isTesting || isProduction) {
  logLevel = "info"; // Info and above in testing and production
}

// ============================================================================
// LOG FORMATS
// ============================================================================

// Define log format for files (production and testing)
const fileLogFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    const stackStr = stack ? `\n${stack}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] [${processId}] ${message}${metaStr}${stackStr}`;
  })
);

// Define log format for console (development and testing)
const consoleLogFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    const stackStr = stack ? `\n${stack}` : "";
    return `${timestamp} ${level} [${processId}] ${message}${metaStr}${stackStr}`;
  })
);

// ============================================================================
// LOGGER CREATION
// ============================================================================

const logger = winston.createLogger({
  level: logLevel,
  transports: [],
  exitOnError: false,
});

// ============================================================================
// CONFIGURE TRANSPORTS BASED ON ENVIRONMENT
// ============================================================================

if (isDevelopment) {
  // Development Mode: Console only
  logger.add(
    new winston.transports.Console({
      format: consoleLogFormat,
    })
  );
} else if (isTesting) {
  // Testing Mode: Both console AND log files
  try {
    // Create log directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      console.log(`Created log directory: ${logDir}`);
    }

    // Add file transport
    logger.add(
      new winston.transports.File({
        filename: path.join(logDir, `${processName}.log`),
        maxsize: maxSizeBytes,
        maxFiles: maxFiles,
        tailable: true,
        format: fileLogFormat,
      })
    );

    // Add console transport
    logger.add(
      new winston.transports.Console({
        format: consoleLogFormat,
      })
    );
  } catch (error) {
    console.error(
      `Failed to initialize file logging: ${error.message}. Falling back to console logging only.`
    );
    // Fall back to console logging only
    logger.add(
      new winston.transports.Console({
        format: consoleLogFormat,
      })
    );
  }
} else if (isProduction) {
  // Production Mode: Log files only
  try {
    // Create log directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      console.log(`Created log directory: ${logDir}`);
    }

    logger.add(
      new winston.transports.File({
        filename: path.join(logDir, `${processName}.log`),
        maxsize: maxSizeBytes,
        maxFiles: maxFiles,
        tailable: true,
        format: fileLogFormat,
      })
    );
  } catch (error) {
    console.error(
      `FATAL ERROR: Failed to initialize file logging in production mode: ${error.message}`
    );
    process.exit(1);
  }
}

// ============================================================================
// INITIALIZATION MESSAGE
// ============================================================================

logger.info(
  `Logger initialized for ${isChildProcess ? "child" : "parent"} process: ${processId} in ${nodeEnv} mode (log level: ${logLevel}, maxSize: ${maxSizeMB}MB, maxFiles: ${maxFiles})`
);

module.exports = logger;
