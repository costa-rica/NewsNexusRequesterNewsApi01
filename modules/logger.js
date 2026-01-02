const winston = require("winston");
const path = require("path");
const fs = require("fs");

// Detect if running as child process
const isChildProcess = process.send !== undefined;

// Determine environment
const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const isTesting = nodeEnv === "testing";
const isDevelopment = nodeEnv === "development";

// Determine process name and validate
let processName;
let processId;

if (isChildProcess) {
  // Child process: Look for NAME_CHILD_PROCESS or NAME_CHILD_PROCESS_* variables
  const childProcessName =
    process.env.NAME_CHILD_PROCESS ||
    Object.keys(process.env).find((key) =>
      key.startsWith("NAME_CHILD_PROCESS_")
    )
      ? process.env[
          Object.keys(process.env).find((key) =>
            key.startsWith("NAME_CHILD_PROCESS_")
          )
        ]
      : null;

  if (!childProcessName) {
    console.error(
      "FATAL ERROR: Child process requires NAME_CHILD_PROCESS or NAME_CHILD_PROCESS_[descriptor] environment variable.\n" +
        "Please add the appropriate variable to the parent process .env file.\n" +
        "Example: NAME_CHILD_PROCESS=MyApp_Worker or NAME_CHILD_PROCESS_BACKUP=MyApp_BackupService"
    );
    process.exit(1);
  }

  processName = childProcessName;
  processId = `${childProcessName}:${process.pid}`;
} else {
  // Parent process: Use NAME_APP
  processName = process.env.NAME_APP || "app";
  processId = processName;
}

// Configuration
const logDir = process.env.PATH_TO_LOGS || "./logs";
const maxSize = parseInt(process.env.LOG_MAX_SIZE) || 10485760; // 10MB
const maxFiles = parseInt(process.env.LOG_MAX_FILES) || 10;

// Determine log level based on environment
let logLevel;
if (isProduction) {
  logLevel = "error"; // Only errors in production
} else if (isTesting) {
  logLevel = "info"; // Info and above in testing
} else {
  logLevel = "debug"; // All levels in development
}

// Define log format for files (production and testing)
const fileLogFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return `[${timestamp}] [${level.toUpperCase()}] [${processId}] ${message}${metaStr}`;
  })
);

// Define log format for console (development)
const consoleLogFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return `${timestamp} ${level} [${processId}] ${message}${metaStr}`;
  })
);

// Create logger
const logger = winston.createLogger({
  level: logLevel,
  transports: [],
  exitOnError: false,
});

// Add transports based on environment
if (isProduction || isTesting) {
  // Production and Testing: Write to files
  try {
    // Create log directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      console.warn(`Created log directory: ${logDir}`);
    }

    logger.add(
      new winston.transports.File({
        filename: path.join(logDir, `${processName}.log`),
        maxsize: maxSize,
        maxFiles: maxFiles,
        tailable: true,
        format: fileLogFormat,
      })
    );
  } catch (error) {
    console.error(
      `Failed to initialize file logging: ${error.message}. Falling back to console logging.`
    );
    // Fall back to console logging
    logger.add(
      new winston.transports.Console({
        format: consoleLogFormat,
      })
    );
  }
} else {
  // Development: Console only
  logger.add(
    new winston.transports.Console({
      format: consoleLogFormat,
    })
  );
}

// Monkey-patch console methods to use Winston
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};

console.log = (...args) => logger.info(args.join(" "));
console.error = (...args) => logger.error(args.join(" "));
console.warn = (...args) => logger.warn(args.join(" "));
console.info = (...args) => logger.info(args.join(" "));
console.debug = (...args) => logger.debug(args.join(" "));

// Log initialization message
logger.info(
  `Logger initialized for ${isChildProcess ? "child" : "parent"} process: ${processId} in ${nodeEnv} mode (log level: ${logLevel})`
);

module.exports = logger;
