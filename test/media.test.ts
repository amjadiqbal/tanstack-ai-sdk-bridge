import type { EmbeddingModelV2 } from '@ai-sdk/provider';
import { embed, generateImage, generateSpeech, generateTranscription, rerank } from '@tanstack/ai';
import {
  MockEmbeddingModelV4,
  MockImageModelV4,
  MockRerankingModelV4,
  MockSpeechModelV4,
  MockTranscriptionModelV4,
} from 'ai/test';
import { describe, expect, it } from 'vitest';
import { aiSdkEmbedding, aiSdkImage, aiSdkRerank, aiSdkSpeech, aiSdkTranscription } from '../src';

const response = (modelId: string) => ({ timestamp: new Date(0), modelId, headers: undefined });

describe('aiSdkEmbedding', () => {
  it('embeds in batches of maxEmbeddingsPerCall and keeps order and usage', async () => {
    const model = new MockEmbeddingModelV4({
      provider: 'openai.embedding',
      modelId: 'text-embedding-3-small',
      maxEmbeddingsPerCall: 2,
      doEmbed: async ({ values }) => ({
        embeddings: values.map((v) => [v.length, 1]),
        usage: { tokens: values.length * 3 },
        warnings: [],
      }),
    });
    const result = await embed({
      adapter: aiSdkEmbedding(model),
      input: ['a', 'bb', 'ccc', 'dddd', 'eeeee'],
      dimensions: 2,
    });
    expect(model.doEmbedCalls.map((c) => c.values)).toEqual([['a', 'bb'], ['ccc', 'dddd'], ['eeeee']]);
    expect(model.doEmbedCalls[0]?.dimensions).toBe(2);
    expect(result.embeddings.map((e) => e.vector[0])).toEqual([1, 2, 3, 4, 5]);
    expect(result.embeddings.map((e) => e.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.usage?.promptTokens).toBe(15);
  });

  it('works with a spec v2 model and rejects dimensions there', async () => {
    const model: EmbeddingModelV2<string> = {
      specificationVersion: 'v2',
      provider: 'voyage.embedding',
      modelId: 'voyage-3',
      maxEmbeddingsPerCall: undefined,
      supportsParallelCalls: true,
      doEmbed: async ({ values }) => ({ embeddings: values.map(() => [0.5]) }),
    };
    const result = await embed({ adapter: aiSdkEmbedding(model), input: 'one' });
    expect(result.embeddings).toEqual([{ vector: [0.5], index: 0 }]);
    await expect(embed({ adapter: aiSdkEmbedding(model), input: 'one', dimensions: 8 })).rejects.toThrow(/dimensions/);
  });
});

describe('aiSdkTranscription', () => {
  it('sends bytes with the media type and maps segments', async () => {
    const model = new MockTranscriptionModelV4({
      provider: 'deepgram.transcription',
      modelId: 'nova-3',
      doGenerate: async () => ({
        text: 'hello there',
        segments: [
          { text: 'hello', startSecond: 0, endSecond: 0.5 },
          { text: 'there', startSecond: 0.5, endSecond: 1 },
        ],
        language: 'en',
        durationInSeconds: 1,
        warnings: [],
        response: response('nova-3'),
      }),
    });
    let seen: { audio: unknown; mediaType: string } | undefined;
    const original = model.doGenerate;
    model.doGenerate = (options) => {
      seen = { audio: options.audio, mediaType: options.mediaType };
      return original(options);
    };
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
    const result = await generateTranscription({ threadId: 't', adapter: aiSdkTranscription(model), audio });
    expect(result.text).toBe('hello there');
    expect(result.language).toBe('en');
    expect(result.duration).toBe(1);
    expect(result.segments).toEqual([
      { id: 0, start: 0, end: 0.5, text: 'hello' },
      { id: 1, start: 0.5, end: 1, text: 'there' },
    ]);
    expect(seen?.mediaType).toBe('audio/wav');
    expect(Array.from(seen?.audio as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('reads data URLs', async () => {
    let mediaType = '';
    const model = new MockTranscriptionModelV4({
      doGenerate: async (options) => {
        mediaType = options.mediaType;
        return {
          text: 'ok',
          segments: [],
          language: undefined,
          durationInSeconds: undefined,
          warnings: [],
          response: response('m'),
        };
      },
    });
    await generateTranscription({
      threadId: 't',
      adapter: aiSdkTranscription(model),
      audio: 'data:audio/ogg;base64,AQID',
    });
    expect(mediaType).toBe('audio/ogg');
  });
});

describe('aiSdkSpeech', () => {
  it('passes voice, format and speed and returns base64 audio', async () => {
    const calls: unknown[] = [];
    const model = new MockSpeechModelV4({
      provider: 'openai.speech',
      modelId: 'gpt-4o-mini-tts',
      doGenerate: async (options) => {
        calls.push(options);
        return { audio: new Uint8Array([104, 105]), warnings: [], response: response('gpt-4o-mini-tts') };
      },
    });
    const result = await generateSpeech({
      threadId: 't',
      adapter: aiSdkSpeech(model),
      text: 'hi',
      voice: 'alloy',
      format: 'wav',
      speed: 1.25,
      modelOptions: { instructions: 'cheerful' },
    });
    expect(calls[0]).toMatchObject({
      text: 'hi',
      voice: 'alloy',
      outputFormat: 'wav',
      speed: 1.25,
      instructions: 'cheerful',
    });
    expect(result.audio).toBe('aGk=');
    expect(result.format).toBe('wav');
    expect(result.contentType).toBe('audio/wav');
  });
});

describe('aiSdkSpeech: reported format', () => {
  const speak = (audio: Uint8Array | string, headers?: Record<string, string>) =>
    new MockSpeechModelV4({
      doGenerate: async () => ({ audio, warnings: [], response: { ...response('tts'), headers } }),
    });

  it('reads the format from the content-type header when none was requested', async () => {
    const result = await generateSpeech({
      threadId: 't',
      adapter: aiSdkSpeech(speak(new Uint8Array([1, 2]), { 'Content-Type': 'audio/flac' })),
      text: 'hi',
    });
    expect(result.format).toBe('flac');
    expect(result.contentType).toBe('audio/flac');
  });

  it('reads the format from the audio bytes when there is no header', async () => {
    const wav = new Uint8Array(
      [...'RIFF']
        .map((c) => c.charCodeAt(0))
        .concat(
          [0, 0, 0, 0],
          [...'WAVE'].map((c) => c.charCodeAt(0)),
        ),
    );
    const result = await generateSpeech({ threadId: 't', adapter: aiSdkSpeech(speak(wav)), text: 'hi' });
    expect(result.format).toBe('wav');
    expect(result.contentType).toBe('audio/wav');
    const mp3 = await generateSpeech({
      threadId: 't',
      adapter: aiSdkSpeech(speak(new Uint8Array([0x49, 0x44, 0x33, 4]))),
      text: 'hi',
    });
    expect(mp3.format).toBe('mp3');
  });

  it('tells Ogg Opus from other Ogg', async () => {
    const page = (packet: string) => {
      const header = new Uint8Array(28);
      header.set([...'OggS'].map((c) => c.charCodeAt(0)));
      header[26] = 1;
      return new Uint8Array([...header, ...[...packet].map((c) => c.charCodeAt(0))]);
    };
    const opus = await generateSpeech({ threadId: 't', adapter: aiSdkSpeech(speak(page('OpusHead'))), text: 'hi' });
    expect(opus.format).toBe('opus');
    expect(opus.contentType).toBe('audio/ogg');
    const vorbis = await generateSpeech({
      threadId: 't',
      adapter: aiSdkSpeech(speak(page('\u0001vorbis'))),
      text: 'hi',
    });
    expect(vorbis.format).toBe('ogg');
    expect(vorbis.contentType).toBe('audio/ogg');
  });

  it('labels an audio/ogg header as ogg', async () => {
    const result = await generateSpeech({
      threadId: 't',
      adapter: aiSdkSpeech(speak(new Uint8Array([1]), { 'content-type': 'audio/ogg' })),
      text: 'hi',
    });
    expect(result.format).toBe('ogg');
  });

  it('says unknown instead of guessing mp3', async () => {
    const result = await generateSpeech({
      threadId: 't',
      adapter: aiSdkSpeech(speak(new Uint8Array([1, 2, 3]))),
      text: 'hi',
    });
    expect(result.format).toBe('unknown');
    expect(result.contentType).toBe('application/octet-stream');
  });
});

describe('aiSdkImage', () => {
  it('generates the requested number of images across calls of maxImagesPerCall', async () => {
    const calls: { n: number; prompt: string | undefined; size: string | undefined }[] = [];
    const model = new MockImageModelV4({
      provider: 'replicate.image',
      modelId: 'flux',
      maxImagesPerCall: 2,
      doGenerate: async (options) => {
        calls.push({ n: options.n, prompt: options.prompt, size: options.size });
        return {
          images: Array.from({ length: options.n }, (_, i) => `img${calls.length}-${i}`),
          warnings: [],
          response: response('flux'),
        };
      },
    });
    const result = await generateImage({
      threadId: 't',
      adapter: aiSdkImage(model),
      prompt: 'a lighthouse',
      numberOfImages: 3,
      size: '512x512',
    });
    expect(calls.map((c) => c.n)).toEqual([2, 1]);
    expect(calls[0]).toMatchObject({ prompt: 'a lighthouse', size: '512x512' });
    expect(result.images).toEqual([{ b64Json: 'img1-0' }, { b64Json: 'img1-1' }, { b64Json: 'img2-0' }]);
  });

  it('sends a mask from modelOptions', async () => {
    let mask: unknown;
    const model = new MockImageModelV4({
      maxImagesPerCall: 1,
      doGenerate: async (options) => {
        mask = options.mask;
        return { images: ['x'], warnings: [], response: response('m') };
      },
    });
    const file = { type: 'file' as const, mediaType: 'image/png', data: 'bWFzaw==' };
    await generateImage({ threadId: 't', adapter: aiSdkImage(model), prompt: 'fill', modelOptions: { mask: file } });
    expect(mask).toEqual(file);
  });
});

describe('aiSdkRerank', () => {
  it('maps documents and relevance scores', async () => {
    const model = new MockRerankingModelV4({
      provider: 'cohere.reranking',
      modelId: 'rerank-v3.5',
      doRerank: async ({ documents, query, topN }) => {
        expect(documents).toEqual({ type: 'text', values: ['cats', 'refunds', 'dogs'] });
        expect(query).toBe('refund policy');
        expect(topN).toBe(2);
        return {
          ranking: [
            { index: 1, relevanceScore: 0.97 },
            { index: 0, relevanceScore: 0.1 },
          ],
        };
      },
    });
    const result = await rerank({
      adapter: aiSdkRerank(model),
      query: 'refund policy',
      documents: ['cats', 'refunds', 'dogs'],
      topN: 2,
    });
    expect(JSON.stringify(result)).toContain('0.97');
    const ranking = result as unknown as { results?: { index: number }[]; ranking?: { index: number }[] };
    expect((ranking.results ?? ranking.ranking)?.[0]?.index).toBe(1);
  });
});

describe('abort signals', () => {
  it('pass the activity abortSignal to transcription, speech, image and rerank models', async () => {
    const seen: Record<string, AbortSignal | undefined> = {};
    const controller = new AbortController();
    const abortSignal = controller.signal;
    await generateTranscription({
      threadId: 't',
      adapter: aiSdkTranscription(
        new MockTranscriptionModelV4({
          doGenerate: async (o) => {
            seen.transcription = o.abortSignal;
            return {
              text: '',
              segments: [],
              language: undefined,
              durationInSeconds: undefined,
              warnings: [],
              response: response('m'),
            };
          },
        }),
      ),
      audio: new Blob([new Uint8Array([1])]),
      abortSignal,
    });
    await generateSpeech({
      threadId: 't',
      adapter: aiSdkSpeech(
        new MockSpeechModelV4({
          doGenerate: async (o) => {
            seen.speech = o.abortSignal;
            return { audio: new Uint8Array([1]), warnings: [], response: response('m') };
          },
        }),
      ),
      text: 'hi',
      abortSignal,
    });
    await generateImage({
      threadId: 't',
      adapter: aiSdkImage(
        new MockImageModelV4({
          maxImagesPerCall: 1,
          doGenerate: async (o) => {
            seen.image = o.abortSignal;
            return { images: ['x'], warnings: [], response: response('m') };
          },
        }),
      ),
      prompt: 'x',
      abortSignal,
    });
    await rerank({
      adapter: aiSdkRerank(
        new MockRerankingModelV4({
          doRerank: async (o) => {
            seen.rerank = o.abortSignal;
            return { ranking: [{ index: 0, relevanceScore: 1 }] };
          },
        }),
      ),
      query: 'q',
      documents: ['a'],
      abortSignal,
    });
    for (const kind of ['transcription', 'speech', 'image', 'rerank']) expect(seen[kind], kind).toBe(abortSignal);
  });
});
