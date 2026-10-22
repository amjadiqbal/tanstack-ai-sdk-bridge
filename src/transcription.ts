import type { TranscriptionModelV2, TranscriptionModelV3, TranscriptionModelV4 } from '@ai-sdk/provider';
import type { TranscriptionOptions, TranscriptionResult } from '@tanstack/ai';
import { toRunErrorPayload } from '@tanstack/ai/adapter-internals';
import { BaseTranscriptionAdapter } from '@tanstack/ai/adapters';
import {
  type AiSdkAdapterOptions,
  type AiSdkCallOptions,
  adapterName,
  base64ToBytes,
  callExtras,
  parseDataUrl,
  randomId,
  type SpecVersion,
  specVersionOf,
} from './shared';

/** Any AI SDK transcription model: spec v2, v3 or v4. */
export type AiSdkTranscriptionModel = TranscriptionModelV2 | TranscriptionModelV3 | TranscriptionModelV4;

/** `modelOptions` for `generateTranscription()` with a bridged model. */
export interface AiSdkTranscriptionModelOptions extends AiSdkCallOptions {
  /** Media type of the audio when it cannot be read from a `Blob`/`File` or data URL. Default `audio/mpeg`. */
  mediaType?: string;
}

const SPECS: ReadonlyArray<SpecVersion> = ['v2', 'v3', 'v4'];

async function toAudio(
  audio: TranscriptionOptions['audio'],
  fallbackType: string,
  signal: AbortSignal | undefined,
): Promise<{ data: Uint8Array; mediaType: string }> {
  if (typeof audio === 'string') {
    if (/^https?:\/\//.test(audio)) {
      const response = await fetch(audio, signal ? { signal } : undefined);
      if (!response.ok) throw new Error(`Could not download audio (${response.status}) from ${audio}`);
      return {
        data: new Uint8Array(await response.arrayBuffer()),
        mediaType: response.headers.get('content-type')?.split(';')[0] || fallbackType,
      };
    }
    const dataUrl = parseDataUrl(audio);
    if (dataUrl) return { data: base64ToBytes(dataUrl.base64), mediaType: dataUrl.mediaType };
    return { data: base64ToBytes(audio), mediaType: fallbackType };
  }
  if (audio instanceof ArrayBuffer) return { data: new Uint8Array(audio), mediaType: fallbackType };
  return { data: new Uint8Array(await audio.arrayBuffer()), mediaType: audio.type || fallbackType };
}

/**
 * TanStack AI transcription adapter around an AI SDK transcription model.
 * `language` and `prompt` have no AI SDK equivalent: pass them in `modelOptions.providerOptions`.
 */
export class AiSdkTranscriptionAdapter<TModel extends string = string> extends BaseTranscriptionAdapter<
  TModel,
  AiSdkTranscriptionModelOptions
> {
  readonly name: string;
  readonly transcriptionModel: AiSdkTranscriptionModel;
  readonly specificationVersion: SpecVersion;

  constructor(model: AiSdkTranscriptionModel, options?: AiSdkAdapterOptions) {
    super(model.modelId as TModel, {});
    this.specificationVersion = specVersionOf(model, 'transcription', SPECS);
    this.transcriptionModel = model;
    this.name = adapterName(model, options);
  }

  async transcribe(options: TranscriptionOptions<AiSdkTranscriptionModelOptions>): Promise<TranscriptionResult> {
    const { model, logger, modelOptions, abortSignal } = options;
    try {
      const audio = await toAudio(options.audio, modelOptions?.mediaType ?? 'audio/mpeg', abortSignal);
      logger.request(`activity=transcription provider=${this.name} model=${model} bytes=${audio.data.length}`, {
        provider: this.name,
        model,
      });
      const result = await (this.transcriptionModel as TranscriptionModelV4).doGenerate({
        audio: audio.data,
        mediaType: audio.mediaType,
        ...callExtras(modelOptions, abortSignal),
      });
      return {
        id: randomId(this.name),
        model: result.response?.modelId ?? model,
        text: result.text,
        ...(result.language !== undefined && { language: result.language }),
        ...(result.durationInSeconds !== undefined && { duration: result.durationInSeconds }),
        ...(result.segments.length > 0 && {
          segments: result.segments.map((segment, id) => ({
            id,
            start: segment.startSecond,
            end: segment.endSecond,
            text: segment.text,
          })),
        }),
      };
    } catch (error: unknown) {
      logger.errors(`${this.name}.transcribe fatal`, {
        error: toRunErrorPayload(error, `${this.name}.transcribe failed`),
        source: `${this.name}.transcribe`,
      });
      throw error;
    }
  }
}

/**
 * Wraps an AI SDK transcription model as a TanStack AI transcription adapter.
 *
 * @example
 * import { generateTranscription } from '@tanstack/ai'
 * import { deepgram } from '@ai-sdk/deepgram'
 * await generateTranscription({ adapter: aiSdkTranscription(deepgram.transcription('nova-3')), audio: file })
 */
export function aiSdkTranscription(
  model: AiSdkTranscriptionModel,
  options?: AiSdkAdapterOptions,
): AiSdkTranscriptionAdapter<string> {
  return new AiSdkTranscriptionAdapter(model, options);
}
