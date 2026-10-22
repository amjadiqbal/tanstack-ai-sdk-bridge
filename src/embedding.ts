import type { EmbeddingModelV2, EmbeddingModelV3, EmbeddingModelV4 } from '@ai-sdk/provider';
import type { EmbeddingOptions, EmbeddingResult } from '@tanstack/ai';
import { requireTextOnlyEmbeddingInput } from '@tanstack/ai';
import { toRunErrorPayload } from '@tanstack/ai/adapter-internals';
import { BaseEmbeddingAdapter } from '@tanstack/ai/adapters';
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

/** Any AI SDK embedding model: spec v2, v3 or v4. */
export type AiSdkEmbeddingModel = EmbeddingModelV2<string> | EmbeddingModelV3 | EmbeddingModelV4;

/** `modelOptions` for `embed()` with a bridged model. */
export interface AiSdkEmbeddingModelOptions extends AiSdkCallOptions {}

const SPECS: ReadonlyArray<SpecVersion> = ['v2', 'v3', 'v4'];

/** TanStack AI embedding adapter around an AI SDK embedding model. Splits large inputs by `maxEmbeddingsPerCall`. */
export class AiSdkEmbeddingAdapter<TModel extends string = string> extends BaseEmbeddingAdapter<
  TModel,
  AiSdkEmbeddingModelOptions
> {
  readonly name: string;
  readonly embeddingModel: AiSdkEmbeddingModel;
  readonly specificationVersion: SpecVersion;

  constructor(model: AiSdkEmbeddingModel, options?: AiSdkAdapterOptions) {
    super(model.modelId as TModel, {});
    this.specificationVersion = specVersionOf(model, 'embedding', SPECS);
    this.embeddingModel = model;
    this.name = adapterName(model, options);
  }

  async createEmbeddings(options: EmbeddingOptions<AiSdkEmbeddingModelOptions>): Promise<EmbeddingResult> {
    const { model, logger, modelOptions, dimensions } = options;
    const values = requireTextOnlyEmbeddingInput(options.input, this.name, model);
    if (dimensions !== undefined && this.specificationVersion !== 'v4') {
      throw new Error(
        `${this.name}: \`dimensions\` needs an AI SDK v4 embedding model; set it through modelOptions.providerOptions instead.`,
      );
    }
    try {
      logger.request(`activity=embed provider=${this.name} model=${model} inputs=${values.length}`, {
        provider: this.name,
        model,
      });
      const max = (await this.embeddingModel.maxEmbeddingsPerCall) ?? values.length;
      const size = Math.max(1, Math.min(max, values.length || 1));
      const vectors: number[][] = [];
      let tokens: number | undefined;
      for (let start = 0; start < values.length; start += size) {
        const batch = values.slice(start, start + size);
        const result = await (this.embeddingModel as EmbeddingModelV4).doEmbed({
          values: batch,
          ...(dimensions !== undefined && { dimensions }),
          ...callExtras(modelOptions, undefined),
        });
        vectors.push(...result.embeddings);
        if (result.usage) tokens = (tokens ?? 0) + result.usage.tokens;
      }
      return {
        id: randomId(this.name),
        model,
        embeddings: vectors.map((vector, index) => ({ vector, index })),
        ...(tokens !== undefined && { usage: tokenUsage(tokens, 0) }),
      };
    } catch (error: unknown) {
      logger.errors(`${this.name}.createEmbeddings fatal`, {
        error: toRunErrorPayload(error, `${this.name}.createEmbeddings failed`),
        source: `${this.name}.createEmbeddings`,
      });
      throw error;
    }
  }
}

/**
 * Wraps an AI SDK embedding model as a TanStack AI embedding adapter.
 *
 * @example
 * import { embed } from '@tanstack/ai'
 * import { openai } from '@ai-sdk/openai'
 * await embed({ adapter: aiSdkEmbedding(openai.embedding('text-embedding-3-small')), input: ['hello'] })
 */
export function aiSdkEmbedding(
  model: AiSdkEmbeddingModel,
  options?: AiSdkAdapterOptions,
): AiSdkEmbeddingAdapter<string> {
  return new AiSdkEmbeddingAdapter(model, options);
}
