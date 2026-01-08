const {
  Article,
  NewsApiRequest,
  EntityWhoFoundArticle,
  NewsArticleAggregatorSource,
  WebsiteDomain,
  NewsApiRequestWebsiteDomainContract,
  ArticleContent,
} = require("newsnexus10db");
const {
  writeResponseDataFromNewsAggregator,
} = require("./utilitiesReadAndMakeFiles");
const {
  checkRequestAndModifyDates,
  runSemanticScorer,
} = require("./utilitiesMisc");
const logger = require("./logger");

async function requester(currentParams, indexMaster) {
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

  // Step 2: Check include and exclude domain string and convert to object arrays
  const includeDomainsArray = includeDomainsArrayString
    .split(",")
    .map((domain) => domain.trim());
  const excludeDomainsArray = excludeDomainsArrayString
    .split(",")
    .map((domain) => domain.trim());
  let excludeDomainsObjArray = [];
  let includeDomainsObjArray = [];

  if (includeDomainsArray.length > 0) {
    for (const domain of includeDomainsArray) {
      const domainObj = await WebsiteDomain.findOne({
        where: { name: domain },
        raw: true,
      });
      if (domainObj) {
        includeDomainsObjArray.push(domainObj);
      }
    }
  }
  if (excludeDomainsArray.length > 0) {
    for (const domain of excludeDomainsArray) {
      const domainObj = await WebsiteDomain.findOne({
        where: { name: domain },
        raw: true,
      });
      if (domainObj) {
        excludeDomainsObjArray.push(domainObj);
      }
    }
  }

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

  logger.info(`adjustedStartDate: ${adjustedStartDate}`);
  logger.info(`adjustedEndDate: ${adjustedEndDate}`);

  // Step 3: make the request
  let requestResponseData = null;
  let newsApiRequestObj = null;

  if (adjustedStartDate === adjustedEndDate) {
    logger.info(`No request needed for ${requestParametersObject.andString}`);
    return adjustedEndDate;
  }

  try {
    ({ requestResponseData, newsApiRequestObj } =
      await makeNewsApiRequestDetailed(
        newsArticleAggregatorSourceObj,
        adjustedStartDate,
        adjustedEndDate,
        andString,
        orString,
        notString,
        includeDomainsObjArray,
        excludeDomainsObjArray,
        indexMaster
      ));
  } catch (error) {
    logger.error(
      `Error during ${process.env.NAME_OF_ORG_REQUESTING_FROM} API request:`,
      error
    );
    return; // prevent proceeding to storeGNewsArticles if request failed
  }

  // logger.info(
  //   "-----> [in requester after makeNewsApiRequestDetailed] newsApiRequestObj ",
  //   newsApiRequestObj
  // );
  // Step 4: store the articles
  if (!requestResponseData?.articles) {
    logger.info(
      `No articles received from ${process.env.NAME_OF_ORG_REQUESTING_FROM} request response`
    );
  } else {
    // Store articles and update NewsApiRequest
    await storeNewsApiArticles(requestResponseData, newsApiRequestObj);
    logger.info(`completed NewsApiRequest.id: ${newsApiRequestObj.id}`);
  }

  // return "2025-05-03";
  return adjustedEndDate;
}

// Make a single requuest to the News API API
async function makeNewsApiRequestDetailed(
  source,
  startDate,
  endDate,
  keywordsAnd,
  keywordsOr,
  keywordsNot,
  includeWebsiteDomainObjArray = [],
  excludeWebsiteDomainObjArray = [],
  indexMaster
) {
  // logger.info(`keywordsAnd: ${keywordsAnd}, ${typeof keywordsAnd}`);
  // logger.info(`keywordsOr: ${keywordsOr}, ${typeof keywordsOr}`);
  // logger.info(`keywordsNot: ${keywordsNot}, ${typeof keywordsNot}`);

  // logger.info(
  //   `---> includeWebsiteDomainObjArray: ${includeWebsiteDomainObjArray}, ${typeof includeWebsiteDomainObjArray}`
  // );
  // logger.info(
  //   `---> excludeWebsiteDomainObjArray: ${JSON.stringify(
  //     excludeWebsiteDomainObjArray
  //   )}, ${typeof excludeWebsiteDomainObjArray}`
  // );

  function splitPreservingQuotes(str) {
    return str.match(/"[^"]+"|\S+/g)?.map((s) => s.trim()) || [];
  }

  const andArray = splitPreservingQuotes(keywordsAnd ? keywordsAnd : "");
  const orArray = splitPreservingQuotes(keywordsOr ? keywordsOr : "");
  const notArray = splitPreservingQuotes(keywordsNot ? keywordsNot : "");

  let includeSourcesArray;
  let excludeSourcesArray;
  if (includeWebsiteDomainObjArray.length === 0) {
    includeSourcesArray = null;
  } else {
    logger.info("THIS SHOULD NOT FIRE");
    includeSourcesArray = includeWebsiteDomainObjArray.map((obj) => obj.name);
  }
  if (excludeWebsiteDomainObjArray.length === 0) {
    excludeSourcesArray = null;
  } else {
    excludeSourcesArray = excludeWebsiteDomainObjArray.map((obj) => obj.name);
  }

  // Step 1: prepare dates
  if (!endDate) {
    endDate = new Date().toISOString().split("T")[0];
  }

  if (
    !startDate ||
    new Date(startDate) <
      new Date(new Date().setDate(new Date().getDate() - 29))
  ) {
    // startDate should be 29 days prior to endDate - account limitation
    startDate = new Date(new Date().setDate(new Date().getDate() - 29))
      .toISOString()
      .split("T")[0];
  }

  // const startDateTest = new Date(startDate);

  // logger.info("-------");
  // logger.info(`startDate: ${startDate} ${typeof startDate}`);
  // logger.info("-------");
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
  // logger.info("- [makeNewsApiRequestDetailed] requestUrl", requestUrl);
  let status = "success";
  let requestResponseData = null;
  // let newsApiRequest = null;
  let newsApiRequestObj = null;

  if (process.env.ACTIVATE_API_REQUESTS_TO_OUTSIDE_SOURCES === "true") {
    const response = await fetch(requestUrl);
    requestResponseData = await response.json();

    if (!requestResponseData.articles) {
      status = "error";
      // logger.info(" #1 writeResponseDataFromNewsAggregator");
      writeResponseDataFromNewsAggregator(
        source.id,
        { id: `failed_indexMaster${indexMaster}`, url: requestUrl },
        requestResponseData,
        true
      );
      if (requestResponseData.code === "rateLimited") {
        logger.info(
          `--> ⛔ Ending process: rate limited by ${process.env.NAME_OF_ORG_REQUESTING_FROM}`
        );
        await runSemanticScorer();
        process.exit(1);
      }
    }
    // Step 4: create new NewsApiRequest
    newsApiRequestObj = await NewsApiRequest.create({
      newsArticleAggregatorSourceId: source.id,
      dateStartOfRequest: startDate,
      dateEndOfRequest: endDate,
      countOfArticlesReceivedFromRequest: requestResponseData.articles?.length,
      countOfArticlesAvailableFromRequest: requestResponseData.totalResults,
      status,
      url: requestUrl,
      andString: keywordsAnd,
      orString: keywordsOr,
      notString: keywordsNot,
      isFromAutomation: true,
    });

    for (const domain of includeWebsiteDomainObjArray) {
      await NewsApiRequestWebsiteDomainContract.create({
        newsApiRequestId: newsApiRequestObj.id,
        websiteDomainId: domain.id,
        includedOrExcludedFromRequest: "included",
      });
    }
    for (const domain of excludeWebsiteDomainObjArray) {
      await NewsApiRequestWebsiteDomainContract.create({
        newsApiRequestId: newsApiRequestObj.id,
        websiteDomainId: domain.id,
        includedOrExcludedFromRequest: "excluded",
      });
    }
  } else {
    newsApiRequestObj = requestUrl;
  }

  // logger.info(
  //   "-----> [in makeNewsApiRequestDetailed] newsApiRequestObj ",
  //   newsApiRequestObj
  // );

  return { requestResponseData, newsApiRequestObj };
}

async function storeNewsApiArticles(requestResponseData, newsApiRequest) {
  // logger.info("-----> newsApiRequest ", newsApiRequest);

  // leverages the hasOne association from the NewsArticleAggregatorSource model
  const newsApiSource = await NewsArticleAggregatorSource.findOne({
    where: { nameOfOrg: process.env.NAME_OF_ORG_REQUESTING_FROM },
    include: [{ model: EntityWhoFoundArticle }],
  });

  const entityWhoFoundArticleId = newsApiSource.EntityWhoFoundArticle?.id;

  try {
    let countOfArticlesSavedToDbFromRequest = 0;
    for (let article of requestResponseData.articles) {
      // Append article

      const existingArticle = await Article.findOne({
        where: { url: article.url },
      });
      if (existingArticle) {
        continue;
      }
      const newArticle = await Article.create({
        publicationName: article.source.name,
        title: article.title,
        author: article.author,
        description: article?.description,
        url: article.url,
        urlToImage: article?.urlToImage,
        publishedDate: article?.publishedAt,
        entityWhoFoundArticleId: entityWhoFoundArticleId,
        newsApiRequestId: newsApiRequest.id,
      });

      if (article?.content) {
        // Append ArticleContent
        await ArticleContent.create({
          articleId: newArticle.id,
          content: article.content,
        });
      }
      countOfArticlesSavedToDbFromRequest++;
    }
    // Append NewsApiRequest
    await newsApiRequest.update({
      countOfArticlesSavedToDbFromRequest: countOfArticlesSavedToDbFromRequest,
    });
    // logger.info(" #2 writeResponseDataFromNewsAggregator");
    writeResponseDataFromNewsAggregator(
      newsApiSource.id,
      newsApiRequest,
      requestResponseData,
      false
      // newsApiRequest.url
    );
  } catch (error) {
    logger.error(error);
    requestResponseData.error = error;
    // logger.info(" #3 writeResponseDataFromNewsAggregator");
    writeResponseDataFromNewsAggregator(
      newsApiSource.id,
      newsApiRequest,
      requestResponseData,
      true
      // newsApiRequest.url
    );
  }
}

module.exports = {
  requester,
};
