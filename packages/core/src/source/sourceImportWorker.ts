import { createModelKnowledgePostRunner, type CreateModelKnowledgePostRunnerOptions } from "../harness/modelRunner.js";
import { deterministicKnowledgePostRunner } from "../harness/runner.js";
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
  Source,
  SourceAsset,
  SourceImport,
  SourceRegistry,
  TransformationStatus
} from "../types.js";
import { createSourceRegistry } from "./sourceRegistry.js";

export interface SourceImportWorkerInput {
  id?: string;
  source: Source;
  assets?: SourceAsset[];
  chunks: KnowledgeChunk[];
  sourceRegistry?: SourceRegistry;
  createdAt?: string;
  recommendedBecause?: string;
  config?: AgentHarnessConfig;
  userContext?: AgentHarnessUserContext;
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
  errorMessage?: string;
}

export interface SourceImportWorker {
  runner: KnowledgePostAgentRunner;
  run(input: SourceImportWorkerInput): Promise<SourceImportWorkerResult>;
}

export interface CreateSourceImportWorkerOptions {
  runner?: KnowledgePostAgentRunner;
}

export interface CreateModelSourceImportWorkerOptions
  extends Omit<CreateModelKnowledgePostRunnerOptions, "client"> {
  client: CreateModelKnowledgePostRunnerOptions["client"];
}

export interface CreateOpenAICompatibleSourceImportWorkerOptions {
  modelClient?: Partial<OpenAICompatibleModelClientOptions>;
  modelRunner?: Omit<CreateModelKnowledgePostRunnerOptions, "client">;
}

export function createSourceImportWorker(
  options: CreateSourceImportWorkerOptions = {}
): SourceImportWorker {
  const runner = options.runner ?? deterministicKnowledgePostRunner;

  return {
    runner,
    run: (input) => runSourceImport(input, runner)
  };
}

export function createModelSourceImportWorker(
  options: CreateModelSourceImportWorkerOptions
): SourceImportWorker {
  return createSourceImportWorker({
    runner: createModelKnowledgePostRunner(options)
  });
}

export function createOpenAICompatibleSourceImportWorker(
  env: OpenAICompatibleModelClientEnv,
  options: CreateOpenAICompatibleSourceImportWorkerOptions = {}
): SourceImportWorker {
  const client = createOpenAICompatibleModelClientFromEnv(env, options.modelClient);

  return createModelSourceImportWorker({
    ...(options.modelRunner ?? {}),
    client
  });
}

export async function runSourceImport(
  input: SourceImportWorkerInput,
  runner: KnowledgePostAgentRunner = deterministicKnowledgePostRunner
): Promise<SourceImportWorkerResult> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const assets = input.assets ?? [];
  const sourceRegistry =
    input.sourceRegistry ??
    createSourceRegistry({
      sources: [input.source],
      assets,
      chunks: input.chunks,
      createdAt
    });

  try {
    const harnessResult = await runner.run({
      id: input.id,
      source: input.source,
      chunks: input.chunks,
      sourceRegistry,
      createdAt,
      recommendedBecause: input.recommendedBecause,
      config: input.config,
      userContext: input.userContext
    });
    const status = harnessResult.run.status === "succeeded" ? "ready" : "failed";
    const errorMessage = status === "failed" ? summarizeValidationFailure(harnessResult) : undefined;

    return {
      importRecord: createImportRecord(input, createdAt, status, errorMessage),
      source: input.source,
      assets,
      chunks: input.chunks,
      sourceRegistry: harnessResult.sourceRegistry ?? sourceRegistry,
      posts: harnessResult.posts,
      validation: harnessResult.validation,
      harnessRun: harnessResult.run,
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
      errorMessage
    };
  }
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
