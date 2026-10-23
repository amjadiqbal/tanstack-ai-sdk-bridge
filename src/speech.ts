import type { SpeechModelV2, SpeechModelV3, SpeechModelV4 } from '@ai-sdk/provider';
import type { TTSOptions, TTSResult } from '@tanstack/ai';
import { toRunErrorPayload } from '@tanstack/ai/adapter-internals';
import { BaseTTSAdapter } from '@tanstack/ai/adapters';
import {
  type AiSdkAdapterOptions,
  type AiSdkCallOptions,
  adapterName,
  base64ToBytes,
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
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};

const FORMATS_BY_TYPE: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/opus': 'opus',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/pcm': 'pcm',
  'audio/l16': 'pcm',
};

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value;
  }
  return undefined;
}

function formatFromContentType(type: string | undefined): string | undefined {
  return type ? FORMATS_BY_TYPE[type.toLowerCase()] : undefined;
}

/** Recognises MP3, WAV, Ogg (Opus or other), FLAC and ADTS AAC from their first bytes. */
export function formatFromBytes(bytes: Uint8Array): string | undefined {
  const ascii = (start: number, text: string) => [...text].every((char, i) => bytes[start + i] === char.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'wav';
  // An Ogg stream whose first packet (after the 27-byte page header and its segment table) is `OpusHead` is Opus;
  // other Ogg (e.g. Vorbis) is reported as `ogg`.
  if (ascii(0, 'OggS')) return ascii(27 + (bytes[26] ?? 0), 'OpusHead') ? 'opus' : 'ogg';
  if (ascii(0, 'fLaC')) return 'flac';
  if (ascii(0, 'ID3')) return 'mp3';
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return (b1 & 0x06) === 0 ? 'aac' : 'mp3';
  return undefined;
}

/**
 * TanStack AI text-to-speech adapter around an AI SDK speech model.
 * `format` in the result is what the provider returned (content-type header or audio bytes),
 * falling back to the requested format, else `unknown`. `contentType` is the header value, else the media type of the
 * format, else `application/octet-stream`.
 */
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
      const bytes = typeof result.audio === 'string' ? base64ToBytes(result.audio) : result.audio;
      const audio = typeof result.audio === 'string' ? result.audio : bytesToBase64(result.audio);
      const headerType = headerValue(result.response?.headers, 'content-type')?.split(';')[0]?.trim();
      // Report what the provider returned: its content-type header, else the audio's magic bytes,
      // else the format that was asked for.
      const detected = formatFromContentType(headerType) ?? formatFromBytes(bytes);
      const outputFormat = detected ?? format ?? 'unknown';
      return {
        id: randomId(this.name),
        model: result.response?.modelId ?? model,
        audio,
        format: outputFormat,
        contentType: headerType || CONTENT_TYPES[outputFormat] || 'application/octet-stream',
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
