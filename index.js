require("dotenv").config();
// Initialize Winston logger early (replaces console.* methods)
const logger = require("./modules/logger");

logger.info("Starting NewsNexusRequesterNewsApi01");

// ============================================================================
// TIME GUARDRAIL CHECK
// ============================================================================

function checkTimeGuardrail() {
  // Check for bypass flag
  const runAnyway = process.argv.includes("--run-anyway");
  if (runAnyway) {
    logger.warn(
      "TIME GUARDRAIL BYPASSED: --run-anyway flag detected. Running outside configured time window."
    );
    return;
  }

  // Parse configuration
  const guardrailTargetTime = process.env.GUARDRAIL_TARGET_TIME || "23:00";
  const guardrailWindowMins =
    parseInt(process.env.GUARDRAIL_TARGET_WINDOW_IN_MINS) || 5;

  // Validate time format
  const timeRegex = /^(\d{1,2}):(\d{2})$/;
  const match = guardrailTargetTime.match(timeRegex);

  if (!match) {
    logger.error(
      `FATAL ERROR: Invalid GUARDRAIL_TARGET_TIME format: "${guardrailTargetTime}". Expected HH:MM (24-hour format).`
    );
    process.exit(1);
  }

  const targetHour = parseInt(match[1]);
  const targetMinute = parseInt(match[2]);

  // Validate hour and minute ranges
  if (targetHour < 0 || targetHour > 23) {
    logger.error(
      `FATAL ERROR: Invalid hour in GUARDRAIL_TARGET_TIME: ${targetHour}. Must be 0-23.`
    );
    process.exit(1);
  }

  if (targetMinute < 0 || targetMinute > 59) {
    logger.error(
      `FATAL ERROR: Invalid minute in GUARDRAIL_TARGET_TIME: ${targetMinute}. Must be 0-59.`
    );
    process.exit(1);
  }

  // Calculate time window in minutes
  const targetMinutes = targetHour * 60 + targetMinute;
  const startMinutes = targetMinutes - guardrailWindowMins;
  const endMinutes = targetMinutes + guardrailWindowMins;

  // Get current UTC time in minutes
  const now = new Date();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  // Format time helper (handles day boundaries)
  const formatTime = (mins) => {
    const normalizedMins = ((mins % 1440) + 1440) % 1440; // 1440 = 24 * 60
    const h = Math.floor(normalizedMins / 60);
    const m = normalizedMins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  // Check if current time is within window
  let inWindow = false;

  // Handle case where window crosses midnight
  if (startMinutes < 0 || endMinutes >= 1440) {
    // Window crosses midnight
    const normalizedStart = ((startMinutes % 1440) + 1440) % 1440;
    const normalizedEnd = ((endMinutes % 1440) + 1440) % 1440;

    if (normalizedStart > normalizedEnd) {
      // Window wraps around midnight (e.g., 23:55 - 00:05)
      inWindow = currentMinutes >= normalizedStart || currentMinutes <= normalizedEnd;
    } else {
      inWindow = currentMinutes >= normalizedStart && currentMinutes <= normalizedEnd;
    }
  } else {
    // Normal case: window does not cross midnight
    inWindow = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  if (!inWindow) {
    const startTimeFormatted = formatTime(startMinutes);
    const endTimeFormatted = formatTime(endMinutes);
    const currentTimeFormatted = formatTime(currentMinutes);

    logger.error(
      `TIME GUARDRAIL VIOLATION: Current UTC time ${currentTimeFormatted} is outside the configured window ${startTimeFormatted} - ${endTimeFormatted}.`
    );
    logger.error(
      `Configured target: ${guardrailTargetTime} UTC ± ${guardrailWindowMins} minutes.`
    );
    logger.error(
      `To run anyway, use: node index.js --run-anyway`
    );
    process.exit(1);
  }

  logger.info(
    `TIME GUARDRAIL PASSED: Current UTC time is within the configured window (${formatTime(
      startMinutes
    )} - ${formatTime(endMinutes)})`
  );
}

// Execute guardrail check
checkTimeGuardrail();

// Initialize database models BEFORE importing other modules
const { initModels, sequelize } = require("newsnexus10db");
initModels();
logger.info(
  `database location: ${process.env.PATH_DATABASE}${process.env.NAME_DB}`
);

const {
  getRequestsParameterArrayFromExcelFile,
} = require("./modules/utilitiesReadAndMakeFiles");
const {
  createArraysOfParametersNeverRequestedAndRequested,
  findEndDateToQueryParameters,
  runSemanticScorer,
} = require("./modules/utilitiesMisc");
const { requester } = require("./modules/requestsNewsApi");

logger.info(
  `--------------------------------------------------------------------------------`
);
logger.info(
  `- Start NewsNexusRequesterNewsApi01 ${new Date().toISOString()} --`
);
logger.info(
  `MILISECONDS_IN_BETWEEN_REQUESTS: ${process.env.MILISECONDS_IN_BETWEEN_REQUESTS}`
);
logger.info(
  `--------------------------------------------------------------------------------`
);

async function main() {
  logger.info("Starting main function");
  // Step 1: Create Array of Parameters for Requests - prioritized based on dateEndOfRequest
  // Step 1.1: Get the query objects from Excel file
  const queryObjects = await getRequestsParameterArrayFromExcelFile();

  // Step 1.2: Create arrays of parameters never requested and requested
  const { arrayOfParametersNeverRequested, arrayOfParametersRequested } =
    await createArraysOfParametersNeverRequestedAndRequested(queryObjects);

  // Step 1.3: Sort the requested array in ascending order by dateEndOfRequest
  const arrayOfParametersRequestedSortedAscendingByDateEndOfRequest =
    arrayOfParametersRequested.sort((a, b) => {
      return new Date(a.dateEndOfRequest) - new Date(b.dateEndOfRequest);
    });

  // Step 1.4: Create the prioritized array
  const arrayOfPrioritizedParameters = [
    ...arrayOfParametersNeverRequested,
    ...arrayOfParametersRequestedSortedAscendingByDateEndOfRequest,
  ];

  logger.info(
    "- status: preparing paramters dateEndOfRequest this could take a while... updating for each row in Excel spreadsheet."
  );
  // Step 1.5: Add the endDate to each request from the existing NewsApiRequests table
  for (let i = 0; i < arrayOfPrioritizedParameters.length; i++) {
    arrayOfPrioritizedParameters[i].dateEndOfRequest =
      await findEndDateToQueryParameters(arrayOfPrioritizedParameters[i]);
    if (i % 1000 === 0) {
      logger.info(
        `-- ${i} of ${arrayOfPrioritizedParameters.length} rows processed --`
      );
    }
  }

  logger.info("- status: finished preparing paramters dateEndOfRequest");
  if (arrayOfPrioritizedParameters.length === 0) {
    logger.info(
      "--- No (unrequested) request parameters found in Excel file. Exiting process. ---"
    );
    return;
  }

  // Step 2: Process the requests
  let indexMaster = 0;
  let index = 0;

  // logger.info(arrayOfPrioritizedParameters);

  while (true) {
    const currentParams = arrayOfPrioritizedParameters[index];
    if (!currentParams.dateEndOfRequest) {
      logger.info(
        `--- No dateEndOfRequest found for request index ${index} (indexMaster ${indexMaster}). Exiting process. ---`
      );
      break;
    }
    let dateEndOfRequest;

    logger.info(
      `-- ${indexMaster}: Start processing request for AND ${currentParams.andString} OR ${currentParams.orString} NOT ${currentParams.notString}`
    );
    // logger.info(`dateEndOfRequest: ${currentParams.dateEndOfRequest}`);

    // Step 2.1: Verify that dateEndOfRequest is today or prior
    if (
      new Date(currentParams?.dateEndOfRequest) <=
      new Date(new Date().toISOString().split("T")[0])
    ) {
      dateEndOfRequest = await requester(currentParams, indexMaster);
      // logger.info(`Doing some requesting 🛒 ...`);
      currentParams.dateEndOfRequest = dateEndOfRequest;
      logger.info(`dateEndOfRequest: ${currentParams.dateEndOfRequest}`);
    }
    // Step 2.2: Respect pacing
    await sleep(process.env.MILISECONDS_IN_BETWEEN_REQUESTS);

    logger.info(`End of ${index} request loop --`);
    index++;
    indexMaster++;
    const limit = Number(process.env.LIMIT_MAXIMUM_MASTER_INDEX) || 5;

    if (indexMaster === limit) {
      logger.info(`--- [End process] Went through ${limit} requests ---`);
      await runSemanticScorer();
      break;
    }

    // Step 2.3: Check if all requests have been processed
    // Step 2.3.1: [End process] Check if all requests have been processed and dateEndOfRequest is today
    if (
      index === arrayOfPrioritizedParameters.length &&
      dateEndOfRequest === new Date().toISOString().split("T")[0]
    ) {
      logger.info(
        `--- [End process] All ${process.env.NAME_OF_ORG_REQUESTING_FROM} queries updated ---`
      );
      break;
    }

    // Step 2.3.2: [Restart looping]Check if all requests have been processed and dateEndOfRequest is not today
    if (index === arrayOfPrioritizedParameters.length) {
      logger.info(
        `--- [Restart looping] Went through all ${arrayOfPrioritizedParameters.length} queries and dateEndOfRequest is not today ---`
      );
      index = 0;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
