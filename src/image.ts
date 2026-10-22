import type { ImageModelV2, ImageModelV3, ImageModelV4, ImageModelV4File } from '@ai-sdk/provider';
import type { ImageGenerationOptions, ImageGenerationResult } from '@tanstack/ai';
import { isFileSource, unsupportedFileSourceError } from '@tanstack/ai';
import { toRunErrorPayload } from '@tanstack/ai/adapter-internals';
import { BaseImageAdapter } from '@tanstack/ai/adapters';
import {
  type AiSdkAdapterOptions,
  type AiSdkCallOptions,
  adapterName,
  bytesToBase64,
  randomId,
  type SpecVersion,
  specVersionOf,
  tokenUsage,
} from './shared';

/** Any AI SDK image model: spec v2, v3 or v4. */
export type AiSdkImageModel = ImageModelV2 | ImageModelV3 | ImageModelV4;

/** `modelOptions` for `generateImage()` with a bridged model. */
export interface AiSdkImageModelOptions extends AiSdkCallOptions {
  /** Aspect ratio such as `16:9`, for models that take one instead of a size. */
  aspectRatio?: `${number}:${number}`;
  seed?: number;
}

const SPECS: ReadonlyArray<SpecVersion> = ['v2', 'v3', 'v4'];

/**
 * TanStack AI image adapter around an AI SDK image model.
 * Text parts of the prompt become the prompt; image parts become input files (AI SDK v3/v4 models).
 */
export class AiSdkImageAdapter<TModel extends string = string> extends BaseImageAdapter<
  TModel,
  AiSdkImageModelOptions
> {
  readonly name: string;
  readonly imageModel: AiSdkImageModel;
  readonly specificationVersion: SpecVersion;

  constructor(model: AiSdkImageModel, options?: AiSdkAdapterOptions) {
    super(model.modelId as TModel, {});
    this.specificationVersion = specVersionOf(model, 'image', SPECS);
    this.imageModel = model;
    this.name = adapterName(model, options);
  }

  private promptOf(prompt: ImageGenerationOptions['prompt']): { text: string; files: ImageModelV4File[] } {
    if (typeof prompt === 'string') return { text: prompt, files: [] };
    const texts: string[] = [];
    const files: ImageModelV4File[] = [];
    for (const part of prompt) {
      if (part.type === 'text') {
        texts.push(part.content);
        continue;
      }
      if (part.type !== 'image') throw new Error(`${this.name}: image models take text and image prompt parts only`);
      if (isFileSource(part.source)) throw unsupportedFileSourceError(this.name);
      files.push(
        part.source.type === 'url'
          ? { type: 'url', url: part.source.value }
          : { type: 'file', mediaType: part.source.mimeType, data: part.source.value },
      );
    }
    if (files.length > 0 && this.specificationVersion === 'v2') {
      throw new Error(`${this.name}: image inputs need an AI SDK v3 or v4 image model`);
    }
    return { text: texts.join('\n'), files };
  }

  async generateImages(options: ImageGenerationOptions<AiSdkImageModelOptions>): Promise<ImageGenerationResult> {
    const { model, logger, modelOptions, abortSignal, size } = options;
    const wanted = options.numberOfImages ?? 1;
    try {
      const { text, files } = this.promptOf(options.prompt);
      const maxSetting = this.imageModel.maxImagesPerCall;
      const max =
        (typeof maxSetting === 'function' ? await maxSetting({ modelId: this.imageModel.modelId }) : maxSetting) ?? 1;
      logger.request(`activity=image provider=${this.name} model=${model} n=${wanted} size=${size ?? 'default'}`, {
        provider: this.name,
        model,
      });
      const images: string[] = [];
      let input = 0;
      let output = 0;
      let sawUsage = false;
      while (images.length < wanted) {
        const n = Math.min(Math.max(1, max), wanted - images.length);
        const result = await (this.imageModel as ImageModelV4).doGenerate({
          prompt: text,
          n,
          size: size as `${number}x${number}` | undefined,
          aspectRatio: modelOptions?.aspectRatio,
          seed: modelOptions?.seed,
          files: files.length > 0 ? files : undefined,
          mask: undefined,
          providerOptions: (modelOptions?.providerOptions ?? {}) as ImageModelV4['doGenerate'] extends (
            o: infer O,
          ) => unknown
            ? O extends { providerOptions: infer P }
              ? P
              : never
            : never,
          ...(modelOptions?.headers && { headers: modelOptions.headers }),
          ...(abortSignal && { abortSignal }),
        });
        if (result.images.length === 0) break;
        for (const image of result.images) images.push(typeof image === 'string' ? image : bytesToBase64(image));
        if (result.usage) {
          sawUsage = true;
          input += result.usage.inputTokens ?? 0;
          output += result.usage.outputTokens ?? 0;
        }
      }
      return {
        id: randomId(this.name),
        model,
        images: images.slice(0, wanted).map((b64Json) => ({ b64Json })),
        ...(sawUsage && { usage: tokenUsage(input, output) }),
      };
    } catch (error: unknown) {
      logger.errors(`${this.name}.generateImages fatal`, {
        error: toRunErrorPayload(error, `${this.name}.generateImages failed`),
        source: `${this.name}.generateImages`,
      });
      throw error;
    }
  }
}

/**
 * Wraps an AI SDK image model as a TanStack AI image adapter.
 *
 * @example
 * import { generateImage } from '@tanstack/ai'
 * import { replicate } from '@ai-sdk/replicate'
 * await generateImage({ adapter: aiSdkImage(replicate.image('black-forest-labs/flux-schnell')), prompt: 'a lighthouse' })
 */
export function aiSdkImage(model: AiSdkImageModel, options?: AiSdkAdapterOptions): AiSdkImageAdapter<string> {
  return new AiSdkImageAdapter(model, options);
}
