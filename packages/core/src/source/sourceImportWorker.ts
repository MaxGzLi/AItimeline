import { createModelKnowledgePostRunner, type CreateModelKnowledgePostRunnerOptions } from "../harness/modelRunner.js";
import { defaultAgentHarnessConfig, deterministicKnowledgePostRunner } from "../harness/runner.js";
import type { ContentLanguage } from "../harness/contentLanguage.js";
import {
  createOpenAICompatibleModelClientFromEnv,
  type OpenAICompatibleModelClientEnv,
  type OpenAICompatibleModelClientOptions
} from "../model/openaiCompatibleClient.js";
import type {
  AgentHarnessConfig,
  AgentHarnessRun,
  AgentHarnessRunResult,
  AgentHarnessUserContext,
  HarnessValidationResult,
  KnowledgeChunk,
  KnowledgePost,
  KnowledgePostAgentRunner,
  PaperDigestInput,
  Source,
  SourceAsset,
  SourceImport,
  SourceRegistry,
  SourceQualityVerdict,
  TransformationStatus
} from "../types.js";
import { createSourceRegistry } from "./sourceRegistry.js";
import {
  createModelSourceQualityGate,
  deterministicSourceQualityGate,
  findCachedSourceQualityVerdict,
  type SourceQualityGateRunner
} from "./sourceQualityGate.js";

export interface SourceImportWorkerInput {
  id?: string;
  source: Source;
  assets?: SourceAsset[];
  chunks: KnowledgeChunk[];
  sourceRegistry?: SourceRegistry;
  paperDigest?: PaperDigestInput;
  contentLanguage?: ContentLanguage;
  createdAt?: string;
  recommendedBecause?: string;
  config?: AgentHarnessConfig;
  userContext?: AgentHarnessUserContext;
  sourceQualityVerdicts?: SourceQualityVerdict[];
  qualityGateConceptHints?: string[];
  skipQualityGate?: boolean;
  /** See AgentHarnessConfig.lenientGrounding — set for browser-clipped sources. */
  lenientGrounding?: boolean;
}

export interface SourceImportWorkerResult {
  importRecord: SourceImport;
  source: Source;
  assets: SourceAsset[];
  chunks: KnowledgeChunk[];
  sourceRegistry: SourceRegistry;
  posts: KnowledgePost[];
  validation: HarnessValidationResult[];
  harnessRun?: AgentHarnessRun;
  qualityGate?: SourceQualityVerdict;
  errorMessage?: string;
}

export interface SourceImportWorker {
  runner: KnowledgePostAgentRunner;
  run(input: SourceImportWorkerInput): Promise<SourceImportWorkerResult>;
}

export interface CreateSourceImportWorkerOptions {
  runner?: KnowledgePostAgentRunner;
  contentLanguage?: ContentLanguage;
  qualityGate?: SourceQualityGateRunner | false;
}

export interface CreateModelSourceImportWorkerOptions
  extends Omit<CreateModelKnowledgePostRunnerOptions, "client"> {
  client: CreateModelKnowledgePostRunnerOptions["client"];
  qualityGate?: SourceQualityGateRunner | false;
}

export interface CreateOpenAICompatibleSourceImportWorkerOptions {
  modelClient?: Partial<OpenAICompatibleModelClientOptions>;
  modelRunner?: Omit<CreateModelKnowledgePostRunnerOptions, "client">;
  qualityGate?: SourceQualityGateRunner | false;
}

export function createSourceImportWorker(
  options: CreateSourceImportWorkerOptions = {}
): SourceImportWorker {
  const runner = options.runner ?? deterministicKnowledgePostRunner;
  const qualityGate = options.qualityGate === false ? undefined : options.qualityGate ?? deterministicSourceQualityGate;

  return {
    runner,
    run: (input) => runSourceImport(input, runner, options.contentLanguage, qualityGate)
  };
}

export function createModelSourceImportWorker(
  options: CreateModelSourceImportWorkerOptions
): SourceImportWorker {
  return createSourceImportWorker({
    runner: createModelKnowledgePostRunner(options),
    qualityGate:
      options.qualityGate === false
        ? false
        : options.qualityGate ?? createModelSourceQualityGate({ client: options.client })
  });
}

export function createOpenAICompatibleSourceImportWorker(
  env: OpenAICompatibleModelClientEnv,
  options: CreateOpenAICompatibleSourceImportWorkerOptions = {}
): SourceImportWorker {
  const client = createOpenAICompatibleModelClientFromEnv(env, options.modelClient);

  return createModelSourceImportWorker({
    ...(options.modelRunner ?? {}),
    client,
    qualityGate: options.qualityGate
  });
}

export async function runSourceImport(
  input: SourceImportWorkerInput,
  runner: KnowledgePostAgentRunner = deterministicKnowledgePostRunner,
  defaultContentLanguage?: ContentLanguage,
  qualityGate?: SourceQualityGateRunner
): Promise<SourceImportWorkerResult> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const contentLanguage = input.contentLanguage ?? defaultContentLanguage;
  const assets = input.assets ?? [];
  const sourceRegistry =
    input.sourceRegistry ??
    createSourceRegistry({
      sources: [input.source],
      assets,
      chunks: input.chunks,
      createdAt
    });
  const qualityGateVerdict =
    input.skipQualityGate || !qualityGate
      ? undefined
      : findCachedSourceQualityVerdict(input.source, input.sourceQualityVerdicts) ??
        (await qualityGate.evaluate({
          source: input.source,
          chunks: input.chunks,
          userContext: input.userContext,
          conceptHints: input.qualityGateConceptHints,
          createdAt
        }));

  if (qualityGateVerdict?.verdict === "reject") {
    const errorMessage = `Source quality gate rejected this source: ${qualityGateVerdict.reasons.join("; ")}`;

    return {
      importRecord: createImportRecord(input, createdAt, "failed", errorMessage),
      source: input.source,
      assets,
      chunks: input.chunks,
      sourceRegistry,
      posts: [],
      validation: [],
      qualityGate: qualityGateVerdict,
      errorMessage
    };
  }

  try {
    const harnessResult = await runner.run({
      id: input.id,
      source: input.source,
      chunks: input.chunks,
      sourceRegistry,
      paperDigest: input.paperDigest,
      createdAt,
      recommendedBecause: input.recommendedBecause,
      contentLanguage,
      config: input.lenientGrounding
        ? { ...(input.config ?? defaultAgentHarnessConfig), lenientGrounding: true }
        : input.config,
      userContext: input.userContext
    });
    const acceptedPosts = collectAcceptedHarnessPosts(harnessResult);
    const runSucceeded = harnessResult.run.status === "succeeded" && acceptedPosts.length > 0;
    const status = runSucceeded ? "ready" : "failed";
    const errorMessage = status === "failed" ? summarizeValidationFailure(harnessResult) : undefined;
    const exposedPosts = runSucceeded ? acceptedPosts : [];
    const harnessRun: AgentHarnessRun = {
      ...harnessResult.run,
      status: runSucceeded ? "succeeded" : "failed",
      outputPostIds: exposedPosts.map((post) => post.id)
    };

    return {
      importRecord: createImportRecord(input, createdAt, status, errorMessage),
      source: input.source,
      assets,
      chunks: input.chunks,
      sourceRegistry: harnessResult.sourceRegistry ?? sourceRegistry,
      posts: exposedPosts,
      validation: harnessResult.validation,
      harnessRun,
      qualityGate: qualityGateVerdict,
      errorMessage
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown source import error.";

    return {
      importRecord: createImportRecord(input, createdAt, "failed", errorMessage),
      source: input.source,
      assets,
      chunks: input.chunks,
      sourceRegistry,
      posts: [],
      validation: [],
      qualityGate: qualityGateVerdict,
      errorMessage
    };
  }
}

function collectAcceptedHarnessPosts(result: AgentHarnessRunResult): KnowledgePost[] {
  const postIdCounts = new Map<string, number>();
  const outputPostIdCounts = new Map<string, number>();

  for (const post of result.posts) {
    postIdCounts.set(post.id, (postIdCounts.get(post.id) ?? 0) + 1);
  }

  for (const postId of result.run.outputPostIds) {
    outputPostIdCounts.set(postId, (outputPostIdCounts.get(postId) ?? 0) + 1);
  }

  return result.posts.filter((post, index) => {
    if (postIdCounts.get(post.id) !== 1 || outputPostIdCounts.get(post.id) !== 1) {
      return false;
    }

    const resultValidation = findPostValidation(result.validation, result.posts, post.id, index);
    const runValidation = findPostValidation(result.run.validation, result.posts, post.id, index);

    return (
      isAcceptedValidationSet(resultValidation) &&
      isAcceptedValidationSet(runValidation)
    );
  });
}

function findPostValidation(
  validation: readonly HarnessValidationResult[],
  posts: readonly KnowledgePost[],
  postId: string,
  index: number
): HarnessValidationResult[] {
  const globalRecords = validation.filter((record) => !record.postId);
  const idMatches = validation.filter((record) => record.postId === postId);

  if (idMatches.length) {
    return [...globalRecords, ...idMatches];
  }

  const indexMatch = validation.length === posts.length ? validation[index] : undefined;

  return indexMatch ? [...globalRecords, indexMatch] : globalRecords;
}

function isAcceptedValidationSet(validation: readonly HarnessValidationResult[]): boolean {
  return (
    validation.length > 0 &&
    validation.every(
      (record) => record.valid && !record.issues.some((issue) => issue.severity === "error")
    )
  );
}

function createImportRecord(
  input: SourceImportWorkerInput,
  createdAt: string,
  status: TransformationStatus,
  errorMessage?: string
): SourceImport {
  return {
    id: input.id ?? buildImportId(input.source.id, createdAt),
    source: input.source,
    status,
    createdAt,
    errorMessage
  };
}

function summarizeValidationFailure(result: AgentHarnessRunResult): string {
  const firstError = result.validation
    .flatMap((validation) => validation.issues)
    .find((issue) => issue.severity === "error");

  return firstError?.message ?? "Harness validation failed.";
}

function buildImportId(sourceId: string, createdAt: string): string {
  return `${sourceId}-import-${createdAt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}
