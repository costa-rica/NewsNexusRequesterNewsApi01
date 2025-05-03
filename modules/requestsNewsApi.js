const {
  Article,
  NewsApiRequest,
  EntityWhoFoundArticle,
  NewsArticleAggregatorSource,
} = require("newsnexus07db");
const {
  writeResponseDataFromNewsAggregator,
} = require("./utilitiesReadAndMakeFiles");
const { checkRequestAndModifyDates } = require("./utilitiesMisc");

async function requester(currentParams) {
  // Step 1: prepare paramters
  const requestWindowInDays = 10; // how many days from startDate to endDate
  const andString = currentParams.andString;
  const orString = currentParams.orString;
  const notString = currentParams.notString;
  const dateStartOfRequest = currentParams.dateStartOfRequest;
  const includeDomainsArrayString = currentParams.includeDomainsArrayString;
  const excludeDomainsArrayString = currentParams.excludeDomainsArrayString;

  const dateEndOfRequest = new Date(
    new Date().setDate(
      new Date(dateStartOfRequest).getDate() + requestWindowInDays
    )
  )
    .toISOString()
    .split("T")[0];

  const newsArticleAggregatorSourceObj =
    await NewsArticleAggregatorSource.findOne({
      where: { nameOfOrg: process.env.NAME_OF_ORG_REQUESTING_FROM },
      raw: true, // Returns data without all the database gibberish
    });

  // console.log(`---> passing in dateEndOfRequest: ${dateEndOfRequest}`);

  // Step 2: Check include and exclude domain string and convert to object arrays
  // create array from string in the form of "domain1, domain2, domain3"
  const includeDomainsArray = includeDomainsArrayString
    .split(",")
    .map((domain) => domain.trim());
  const excludeDomainsArray = excludeDomainsArrayString
    .split(",")
    .map((domain) => domain.trim());
  console.log(`excludeDomainsArray: ${excludeDomainsArray}`);
  console.log(typeof excludeDomainsArray);
  console.log(excludeDomainsArray.length);
  process.exit(0);

  // Step 2: Modify the startDate and endDate if necessary
  const { adjustedStartDate, adjustedEndDate } =
    await checkRequestAndModifyDates(
      andString,
      orString,
      notString,
      dateStartOfRequest,
      dateEndOfRequest,
      newsArticleAggregatorSourceObj,
      requestWindowInDays
    );

  console.log(`adjustedStartDate: ${adjustedStartDate}`);
  console.log(`adjustedEndDate: ${adjustedEndDate}`);

  // Step 3: make the request
  let requestResponseData = null;
  let newsApiRequestObj = null;

  if (adjustedStartDate === adjustedEndDate) {
    console.log(`No request needed for ${requestParametersObject.andString}`);
    return adjustedEndDate;
  }

  try {
    ({ requestResponseData, newsApiRequestObj } =
      await makeNewsApiRequestDetailedTest(
        newsArticleAggregatorSourceObj,
        adjustedStartDate,
        adjustedEndDate,
        andString,
        orString,
        notString,
        [],
        []
      ));
  } catch (error) {
    console.error("Error during GNews API request:", error);
    return; // prevent proceeding to storeGNewsArticles if request failed
  }

  // return "2025-05-03";
  return adjustedEndDate;
}

async function makeNewsApiRequestDetailedTest(
  source,
  startDate,
  endDate,
  keywordsAnd,
  keywordsOr,
  keywordsNot,
  includeWebsiteDomainObjArray = [],
  excludeWebsiteDomainObjArray = []
) {}

// Make a single requuest to the News API API
async function makeNewsApiRequestDetailed(
  source,
  startDate,
  endDate,
  keywordsAnd,
  keywordsOr,
  keywordsNot,
  includeWebsiteDomainObjArray = [],
  excludeWebsiteDomainObjArray = []
) {
  // console.log(`keywordsAnd: ${keywordsAnd}, ${typeof keywordsAnd}`);
  // console.log(`keywordsOr: ${keywordsOr}, ${typeof keywordsOr}`);
  // console.log(`keywordsNot: ${keywordsNot}, ${typeof keywordsNot}`);

  // if (Array.isArray(includeWebsiteDomainObjArray)) {
  //   const includeSourcesArrayNames = includeWebsiteDomainObjArray.map(
  //     (obj) => obj.name
  //   );
  //   console.log(
  //     "[makeNewsApiRequestDetailed02] includeSourcesArrayNames:",
  //     includeSourcesArrayNames
  //   );
  // } else {
  //   console.log(
  //     "[makeNewsApiRequestDetailed02] includeWebsiteDomainObjArray is not an array:",
  //     includeWebsiteDomainObjArray
  //   );
  // }

  function splitPreservingQuotes(str) {
    return str.match(/"[^"]+"|\S+/g)?.map((s) => s.trim()) || [];
  }

  const andArray = splitPreservingQuotes(keywordsAnd ? keywordsAnd : "");
  const orArray = splitPreservingQuotes(keywordsOr ? keywordsOr : "");
  const notArray = splitPreservingQuotes(keywordsNot ? keywordsNot : "");

  const includeSourcesArray = includeWebsiteDomainObjArray.map(
    (obj) => obj.name
  );
  const excludeSourcesArray = excludeWebsiteDomainObjArray.map(
    (obj) => obj.name
  );

  // Step 1: prepare token and dates
  const token = source.apiKey;
  if (!endDate) {
    endDate = new Date().toISOString().split("T")[0];
  }
  if (!startDate) {
    // startDate should be 29 days prior to endDate - account limitation
    startDate = new Date(new Date().setDate(new Date().getDate() - 29))
      .toISOString()
      .split("T")[0];
  }

  let queryParams = [];

  if (includeSourcesArray && includeSourcesArray.length > 0) {
    queryParams.push(`domains=${includeSourcesArray.join(",")}`);
  }

  if (excludeSourcesArray && excludeSourcesArray.length > 0) {
    queryParams.push(`excludeDomains=${excludeSourcesArray.join(",")}`);
  }

  const andPart = andArray.length > 0 ? andArray.join(" AND ") : "";
  const orPart = orArray.length > 0 ? `(${orArray.join(" OR ")})` : "";
  const notPart =
    notArray.length > 0 ? notArray.map((k) => `NOT ${k}`).join(" AND ") : "";

  const fullQuery = [andPart, orPart, notPart].filter(Boolean).join(" AND ");

  if (fullQuery) {
    queryParams.push(`q=${encodeURIComponent(fullQuery)}`);
  }

  if (startDate) {
    queryParams.push(`from=${startDate}`);
  }

  if (endDate) {
    queryParams.push(`to=${endDate}`);
  }

  // Always required
  queryParams.push("language=en");
  queryParams.push(`apiKey=${source.apiKey}`);

  const requestUrl = `${source.url}everything?${queryParams.join("&")}`;
  console.log("- [makeNewsApiRequestDetailed] requestUrl", requestUrl);
  let status = "success";
  let requestResponseData = null;
  let newsApiRequest = null;
  if (process.env.ACTIVATE_API_REQUESTS_TO_OUTSIDE_SOURCES === "true") {
    const response = await fetch(requestUrl);
    requestResponseData = await response.json();

    if (!requestResponseData.articles) {
      status = "error";
      writeResponseDataFromNewsAggregator(
        source.id,
        { id: "failed", url: requestUrl },
        requestResponseData,
        true
      );
    }
    // Step 4: create new NewsApiRequest
    newsApiRequest = await NewsApiRequest.create({
      newsArticleAggregatorSourceId: source.id,
      dateStartOfRequest: startDate,
      dateEndOfRequest: endDate,
      countOfArticlesReceivedFromRequest: requestResponseData.articles?.length,
      status,
      url: requestUrl,
      andString: keywordsAnd,
      orString: keywordsOr,
      notString: keywordsNot,
    });

    for (const domain of includeWebsiteDomainObjArray) {
      await NewsApiRequestWebsiteDomainContract.create({
        newsApiRequestId: newsApiRequest.id,
        websiteDomainId: domain.websiteDomainId,
        includedOrExcludedFromRequest: "included",
      });
    }
    for (const domain of excludeWebsiteDomainObjArray) {
      await NewsApiRequestWebsiteDomainContract.create({
        newsApiRequestId: newsApiRequest.id,
        websiteDomainId: domain.websiteDomainId,
        includedOrExcludedFromRequest: "excluded",
      });
    }
  } else {
    newsApiRequest = requestUrl;
  }

  return { requestResponseData, newsApiRequest };
}

module.exports = {
  requester,
};
