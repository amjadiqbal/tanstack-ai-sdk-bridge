import type { RerankingModelV3, RerankingModelV4 } from '@ai-sdk/provider';
import type { RerankAdapterResult, RerankOptions } from '@tanstack/ai';
import { toRunErrorPayload } from '@tanstack/ai/adapter-internals';
import { BaseRerankAdapter } from '@tanstack/ai/adapters';
import {
  type AiSdkAdapterOptions,
  type AiSdkCallOptions,
  adapterName,
  callExtras,
  randomId,
  type SpecVersion,
  specVersionOf,
  tokenUsage,
} from './shared';

/** Any AI SDK reranking model: spec v3 or v4 (AI SDK 5 had no reranking models). */
export type AiSdkRerankingModel = RerankingModelV3 | RerankingModelV4;

/** `modelOptions` for `rerank()` with a bridged model. */
export interface AiSdkRerankModelOptions extends AiSdkCallOptions {}

const SPECS: ReadonlyArray<SpecVersion> = ['v3', 'v4'];

/** TanStack AI rerank adapter around an AI SDK reranking model. AI SDK reports no token usage for reranking. */
export class AiSdkRerankAdapter<TModel extends string = string> extends BaseRerankAdapter<
  TModel,
  AiSdkRerankModelOptions
> {
  readonly name: string;
  readonly rerankingModel: AiSdkRerankingModel;
  readonly specificationVersion: SpecVersion;

  constructor(model: AiSdkRerankingModel, options?: AiSdkAdapterOptions) {
    super({}, model.modelId as TModel);
    this.specificationVersion = specVersionOf(model, 'reranking', SPECS);
    this.rerankingModel = model;
    this.name = adapterName(model, options);
  }

  async rerank(options: RerankOptions<AiSdkRerankModelOptions>): Promise<RerankAdapterResult> {
    const { model, logger, modelOptions, abortSignal, query, documents, topN } = options;
    try {
      logger.request(`activity=rerank provider=${this.name} model=${model} documents=${documents.length}`, {
        provider: this.name,
        model,
      });
      const result = await (this.rerankingModel as RerankingModelV4).doRerank({
        query,
        documents: { type: 'text', values: documents },
        ...(topN !== undefined && { topN }),
        ...callExtras(modelOptions, abortSignal),
      });
      return {
        id: result.response?.id ?? randomId(this.name),
        ranking: result.ranking.map(({ index, relevanceScore }) => ({ index, score: relevanceScore })),
        usage: tokenUsage(0, 0),
      };
    } catch (error: unknown) {
      logger.errors(`${this.name}.rerank fatal`, {
        error: toRunErrorPayload(error, `${this.name}.rerank failed`),
        source: `${this.name}.rerank`,
      });
      throw error;
    }
  }
}

/**
 * Wraps an AI SDK reranking model as a TanStack AI rerank adapter.
 *
 * @example
 * import { rerank } from '@tanstack/ai'
 * import { cohere } from '@ai-sdk/cohere'
 * await rerank({ adapter: aiSdkRerank(cohere.reranking('rerank-v3.5')), query, documents })
 */
export function aiSdkRerank(model: AiSdkRerankingModel, options?: AiSdkAdapterOptions): AiSdkRerankAdapter<string> {
  return new AiSdkRerankAdapter(model, options);
}
