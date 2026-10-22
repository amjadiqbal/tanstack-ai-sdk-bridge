import type { SpeechModelV2, SpeechModelV3, SpeechModelV4 } from '@ai-sdk/provider';
import type { TTSOptions, TTSResult } from '@tanstack/ai';
import { toRunErrorPayload } from '@tanstack/ai/adapter-internals';
import { BaseTTSAdapter } from '@tanstack/ai/adapters';
import {
  type AiSdkAdapterOptions,
  type AiSdkCallOptions,
  adapterName,
  bytesToBase64,
  callExtras,
  randomId,
  type SpecVersion,
  specVersionOf,
} from './shared';

/** Any AI SDK speech model: spec v2, v3 or v4. */
export type AiSdkSpeechModel = SpeechModelV2 | SpeechModelV3 | SpeechModelV4;

/** `modelOptions` for `generateSpeech()` with a bridged model. */
export interface AiSdkSpeechModelOptions extends AiSdkCallOptions {
  /** Style instructions, for models that take them. */
  instructions?: string;
  /** Language of the text, e.g. `en`. */
  language?: string;
}

const SPECS: ReadonlyArray<SpecVersion> = ['v2', 'v3', 'v4'];

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};

/** TanStack AI text-to-speech adapter around an AI SDK speech model. */
export class AiSdkSpeechAdapter<TModel extends string = string> extends BaseTTSAdapter<
  TModel,
  AiSdkSpeechModelOptions
> {
  readonly name: string;
  readonly speechModel: AiSdkSpeechModel;
  readonly specificationVersion: SpecVersion;

  constructor(model: AiSdkSpeechModel, options?: AiSdkAdapterOptions) {
    super(model.modelId as TModel, {});
    this.specificationVersion = specVersionOf(model, 'speech', SPECS);
    this.speechModel = model;
    this.name = adapterName(model, options);
  }

  async generateSpeech(options: TTSOptions<AiSdkSpeechModelOptions>): Promise<TTSResult> {
    const { model, logger, modelOptions, abortSignal, text, voice, format, speed } = options;
    try {
      logger.request(
        `activity=tts provider=${this.name} model=${model} format=${format ?? 'default'} voice=${voice ?? 'default'}`,
        {
          provider: this.name,
          model,
        },
      );
      const result = await (this.speechModel as SpeechModelV4).doGenerate({
        text,
        ...(voice !== undefined && { voice }),
        ...(format !== undefined && { outputFormat: format }),
        ...(speed !== undefined && { speed }),
        ...(modelOptions?.instructions !== undefined && { instructions: modelOptions.instructions }),
        ...(modelOptions?.language !== undefined && { language: modelOptions.language }),
        ...callExtras(modelOptions, abortSignal),
      });
      const audio = typeof result.audio === 'string' ? result.audio : bytesToBase64(result.audio);
      const outputFormat = format ?? 'mp3';
      const headerType = (result.response?.headers as Record<string, string> | undefined)?.['content-type'];
      return {
        id: randomId(this.name),
        model: result.response?.modelId ?? model,
        audio,
        format: outputFormat,
        contentType: headerType?.split(';')[0] || CONTENT_TYPES[outputFormat] || 'application/octet-stream',
      };
    } catch (error: unknown) {
      logger.errors(`${this.name}.generateSpeech fatal`, {
        error: toRunErrorPayload(error, `${this.name}.generateSpeech failed`),
        source: `${this.name}.generateSpeech`,
      });
      throw error;
    }
  }
}

/**
 * Wraps an AI SDK speech model as a TanStack AI text-to-speech adapter.
 *
 * @example
 * import { generateSpeech } from '@tanstack/ai'
 * import { openai } from '@ai-sdk/openai'
 * await generateSpeech({ threadId, adapter: aiSdkSpeech(openai.speech('gpt-4o-mini-tts')), text: 'Hello', voice: 'alloy' })
 */
export function aiSdkSpeech(model: AiSdkSpeechModel, options?: AiSdkAdapterOptions): AiSdkSpeechAdapter<string> {
  return new AiSdkSpeechAdapter(model, options);
}
