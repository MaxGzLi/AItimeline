// @ts-check

import {
  createCommandModelClientFromEnv,
  createModelSourceImportWorker,
  createOpenAICompatibleModelClientFromEnv,
  createOpenAICompatibleSourceImportWorker,
  createSourceImportWorker,
  createTavilySearchProvider,
  DISCOVERY_AGGREGATE_DOMAINS,
  parseContentLanguage
} from "../../../../packages/core/dist/index.js";

export function createConfiguredSourceImportWorker(env) {
  const modelName = env.AITIMELINE_MODEL_NAME ?? env.OPENAI_MODEL;
  const contentLanguage = readConfiguredContentLanguage(env);
  const commandClient = createConfiguredCommandModelClient(env);

  if (commandClient) {
    const commandWorker = createModelSourceImportWorker({
      ...(contentLanguage ? { contentLanguage } : {}),
      client: commandClient
    });
    console.log("[aitimeline] source import using command model runner.");

    return commandWorker;
  }

  if (!modelName) {
    return createSourceImportWorker(contentLanguage ? { contentLanguage } : {});
  }

  const worker = createOpenAICompatibleSourceImportWorker(
    env,
    contentLanguage ? { modelRunner: { contentLanguage } } : {}
  );
  console.log(`[aitimeline] source import using model runner (${modelName}).`);

  return worker;
}

export function readConfiguredContentLanguage(env) {
  const value = env.AITIMELINE_CONTENT_LANGUAGE ?? "zh";

  if (value === "none") {
    return undefined;
  }

  const contentLanguage = parseContentLanguage(value);

  if (!contentLanguage) {
    console.warn(`[aitimeline] unsupported AITIMELINE_CONTENT_LANGUAGE "${value}"; defaulting to "zh".`);
    return "zh";
  }

  return contentLanguage;
}

export function resolveContentLanguage(persistenceStore, env) {
  return persistenceStore.getSnapshot().userSettings.contentLanguage ?? readConfiguredContentLanguage(env) ?? "zh";
}

// A user-provided CLI command wins over the OpenAI-compatible env: it is the more
// explicit choice, and it lets people without an API key run a local agent CLI.
function createConfiguredCommandModelClient(env) {
  const command = firstNonBlankEnv(env.AITIMELINE_MODEL_COMMAND);

  return command ? createCommandModelClientFromEnv(env, { command }) : undefined;
}

export function createConfiguredAskModelClient(env) {
  const commandClient = createConfiguredCommandModelClient(env);

  if (commandClient) {
    return commandClient;
  }

  const modelName = env.AITIMELINE_MODEL_NAME ?? env.OPENAI_MODEL;

  return modelName ? createOpenAICompatibleModelClientFromEnv(env) : undefined;
}

export function createConfiguredDeepReadModelClients(env) {
  const modelEnv = {
    ...env,
    AITIMELINE_MODEL_NAME: firstNonBlankEnv(env.AITIMELINE_MODEL_NAME, env.OPENAI_MODEL),
    AITIMELINE_MODEL_API_KEY: firstNonBlankEnv(env.AITIMELINE_MODEL_API_KEY, env.OPENAI_API_KEY),
    AITIMELINE_MODEL_BASE_URL: firstNonBlankEnv(env.AITIMELINE_MODEL_BASE_URL, env.OPENAI_BASE_URL),
    OPENAI_MODEL: firstNonBlankEnv(env.OPENAI_MODEL),
    OPENAI_API_KEY: firstNonBlankEnv(env.OPENAI_API_KEY),
    OPENAI_BASE_URL: firstNonBlankEnv(env.OPENAI_BASE_URL)
  };
  const deepReadModelName = firstNonBlankEnv(env.AITIMELINE_MODEL_DEEPREAD_NAME);
  const defaultModelName = modelEnv.AITIMELINE_MODEL_NAME;
  // Per-request output cap and whole-article token budget are different numbers:
  // passing the 50k-150k article budget as request max_tokens would make every
  // call fail on providers with lower output limits.
  const requestMaxTokens = Number.parseInt(env.AITIMELINE_MODEL_DEEPREAD_MAX_TOKENS ?? "", 10);
  const articleTokenBudget = getDeepReadArticleTokenBudget(env);
  const commandClient = createConfiguredCommandModelClient(env);
  const defaultClient =
    commandClient ?? (defaultModelName ? createOpenAICompatibleModelClientFromEnv(modelEnv) : undefined);
  const deepReadClient = deepReadModelName
    ? createOpenAICompatibleModelClientFromEnv(modelEnv, {
        model: deepReadModelName,
        apiKey: firstNonBlankEnv(
          env.AITIMELINE_MODEL_DEEPREAD_API_KEY,
          modelEnv.AITIMELINE_MODEL_API_KEY,
          modelEnv.OPENAI_API_KEY
        ),
        baseUrl: firstNonBlankEnv(
          env.AITIMELINE_MODEL_DEEPREAD_BASE_URL,
          modelEnv.AITIMELINE_MODEL_BASE_URL,
          modelEnv.OPENAI_BASE_URL
        ),
        ...(Number.isFinite(requestMaxTokens) ? { maxTokens: requestMaxTokens } : {})
      })
    : undefined;

  if (deepReadClient) {
    console.log(`[aitimeline] deep-read articles using model runner (${deepReadModelName}).`);
  } else if (defaultClient) {
    console.log(
      `[aitimeline] deep-read articles falling back to default model runner (${commandClient ? "command" : defaultModelName}).`
    );
  }

  return {
    deepReadClient,
    defaultClient,
    maxTokens: articleTokenBudget
  };
}

function firstNonBlankEnv(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function getDeepReadArticleTokenBudget(env) {
  const parsed = Number.parseInt(env.AITIMELINE_DEEPREAD_ARTICLE_TOKEN_BUDGET ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return 100000;
  }

  return Math.max(50000, Math.min(150000, parsed));
}

export function createConfiguredSearchProvider(env) {
  const apiKey = env.AITIMELINE_SEARCH_API_KEY;

  if (!apiKey) {
    return undefined;
  }

  const provider = env.AITIMELINE_SEARCH_PROVIDER ?? "tavily";

  if (provider !== "tavily") {
    console.warn(`[aitimeline] unsupported search provider "${provider}"; source discovery stays disabled.`);
    return undefined;
  }

  console.log("[aitimeline] source discovery using tavily search.");

  return createTavilySearchProvider({
    apiKey,
    baseUrl: env.AITIMELINE_SEARCH_BASE_URL,
    excludeDomains: DISCOVERY_AGGREGATE_DOMAINS
  });
}
