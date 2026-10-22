/**
 * Real AI SDK provider packages, talking HTTP to aimock (a local server that speaks each provider's wire format).
 * No live provider API is called and no API key is used.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createCerebras } from '@ai-sdk/cerebras';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createFireworks } from '@ai-sdk/fireworks';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenAICompatible as createOpenAICompatibleV2 } from '@ai-sdk/openai-compatible-v2';
import { createOpenAICompatible as createOpenAICompatibleV3 } from '@ai-sdk/openai-compatible-v3';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { LLMock } from '@copilotkit/aimock';
import {
  chat,
  embed,
  generateImage,
  generateSpeech,
  generateTranscription,
  rerank,
  toolDefinition,
} from '@tanstack/ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  type AiSdkLanguageModel,
  aiSdkEmbedding,
  aiSdkImage,
  aiSdkRerank,
  aiSdkSpeech,
  aiSdkText,
  aiSdkTranscription,
} from '../src';
import { collect } from './helpers';

const mock = new LLMock({ port: 0 });
let url = '';
const key = 'mock-key';

beforeAll(async () => {
  // Second turn: only matches when the tool result (with the tool's output) reached the provider.
  mock.addFixture({
    match: { userMessage: /weather in Lahore/, hasToolResult: true, toolResultContains: 'sunny' },
    response: { content: 'It is 21°C and sunny in Lahore.' },
  });
  mock.onMessage(/weather in Lahore/, {
    toolCalls: [{ id: 'call_weather_1', name: 'getWeather', arguments: '{"city":"Lahore"}' }],
  });
  mock.onMessage(/think first/, { content: 'The answer is 42.', reasoning: 'Six times seven is forty-two.' });
  mock.onMessage(/Invent a product/, { content: JSON.stringify({ name: 'Desk lamp', price: 25 }) });
  mock.onMessage(/Say hello/, { content: 'Hello from the bridge!' });
  mock.onEmbedding(/./, { embedding: [0.1, 0.2, 0.3] });
  mock.onImage(/lighthouse/, { images: [{ b64Json: 'aW1hZ2U=' }] });
  mock.onSpeech(/Hello there/, { audio: 'YXVkaW8=', format: 'mp3' });
  mock.onTranscription({ transcription: { text: 'hello from aimock', language: 'english', duration: 1.5 } });
  mock.onRerank(/refund/, [
    { index: 1, relevance_score: 0.93 },
    { index: 0, relevance_score: 0.12 },
  ]);
  url = await mock.start();
});

afterAll(async () => {
  await mock.stop();
});

const textOf = (chunks: { type: string }[]) =>
  chunks
    .filter((c) => c.type === 'TEXT_MESSAGE_CONTENT')
    .map((c) => (c as unknown as { delta: string }).delta)
    .join('');

const chatProviders: Array<[string, () => AiSdkLanguageModel, string]> = [
  ['@ai-sdk/deepseek', () => createDeepSeek({ baseURL: `${url}/v1`, apiKey: key })('deepseek-chat'), 'v4'],
  ['@ai-sdk/anthropic', () => createAnthropic({ baseURL: `${url}/v1`, apiKey: key })('claude-sonnet-4-5'), 'v4'],
  ['@ai-sdk/openai (Responses API)', () => createOpenAI({ baseURL: `${url}/v1`, apiKey: key })('gpt-4o'), 'v4'],
  ['@ai-sdk/openai (Chat Completions)', () => createOpenAI({ baseURL: `${url}/v1`, apiKey: key }).chat('gpt-4o'), 'v4'],
  [
    '@ai-sdk/togetherai',
    () => createTogetherAI({ baseURL: `${url}/v1`, apiKey: key })('meta-llama/Llama-3.3-70B-Instruct-Turbo'),
    'v4',
  ],
  ['@ai-sdk/cerebras', () => createCerebras({ baseURL: `${url}/v1`, apiKey: key })('llama-3.3-70b'), 'v4'],
  [
    '@ai-sdk/fireworks',
    () => createFireworks({ baseURL: `${url}/v1`, apiKey: key })('accounts/fireworks/models/llama-v3p3-70b-instruct'),
    'v4',
  ],
  ['ollama-ai-provider-v2', () => createOllama({ baseURL: `${url}/api` })('llama3.2'), 'v4'],
  [
    '@ai-sdk/openai-compatible 3.x (AI SDK 7)',
    () => createOpenAICompatible({ name: 'local', baseURL: `${url}/v1`, apiKey: key })('any-model'),
    'v4',
  ],
  [
    '@ai-sdk/openai-compatible 2.x (AI SDK 6)',
    () => createOpenAICompatibleV3({ name: 'local', baseURL: `${url}/v1`, apiKey: key })('any-model'),
    'v3',
  ],
  [
    '@ai-sdk/openai-compatible 1.x (AI SDK 5)',
    () => createOpenAICompatibleV2({ name: 'local', baseURL: `${url}/v1`, apiKey: key })('any-model'),
    'v2',
  ],
];

describe.each(chatProviders)('%s via aimock', (_label, makeModel, spec) => {
  it('reports the expected AI SDK spec version', () => {
    expect(aiSdkText(makeModel()).specificationVersion).toBe(spec);
  });

  it('streams a text answer with usage', async () => {
    const chunks = await collect(
      chat({ threadId: 't', adapter: aiSdkText(makeModel()), messages: [{ role: 'user', content: 'Say hello' }] }),
    );
    expect(chunks.find((c) => c.type === 'RUN_ERROR')).toBeUndefined();
    expect(textOf(chunks)).toBe('Hello from the bridge!');
    expect(chunks.at(-1)?.type).toBe('RUN_FINISHED');
  });

  it('runs a server tool and continues the conversation', async () => {
    const execute = vi.fn(async ({ city }: { city: string }) => ({ city, tempC: 21, sky: 'sunny' }));
    const getWeather = toolDefinition({
      name: 'getWeather',
      description: 'Current weather for a city',
      inputSchema: z.object({ city: z.string() }),
    }).server(execute);
    const chunks = await collect(
      chat({
        threadId: 't',
        adapter: aiSdkText(makeModel()),
        messages: [{ role: 'user', content: 'What is the weather in Lahore?' }],
        tools: [getWeather],
      }),
    );
    expect(chunks.find((c) => c.type === 'RUN_ERROR')).toBeUndefined();
    expect(execute).toHaveBeenCalledWith({ city: 'Lahore' }, expect.anything());
    expect(textOf(chunks)).toBe('It is 21°C and sunny in Lahore.');
  });

  it('returns structured output', async () => {
    const product = await chat({
      threadId: 't',
      adapter: aiSdkText(makeModel()),
      messages: [{ role: 'user', content: 'Invent a product' }],
      outputSchema: z.object({ name: z.string(), price: z.number() }),
      stream: false,
    });
    expect(product).toEqual({ name: 'Desk lamp', price: 25 });
  });
});

describe('reasoning via aimock', () => {
  it.each([
    ['@ai-sdk/anthropic', () => createAnthropic({ baseURL: `${url}/v1`, apiKey: key })('claude-sonnet-4-5')],
    ['@ai-sdk/deepseek', () => createDeepSeek({ baseURL: `${url}/v1`, apiKey: key })('deepseek-reasoner')],
  ] as const)('%s streams reasoning before the answer', async (_label, makeModel) => {
    const chunks = await collect(
      chat({
        threadId: 't',
        adapter: aiSdkText(makeModel()),
        messages: [{ role: 'user', content: 'Please think first: what is 6 x 7?' }],
        reasoning: 'high',
      }),
    );
    expect(chunks.find((c) => c.type === 'RUN_ERROR')).toBeUndefined();
    const reasoning = chunks
      .filter((c) => c.type === 'REASONING_MESSAGE_CONTENT')
      .map((c) => (c as unknown as { delta: string }).delta)
      .join('');
    expect(reasoning).toContain('forty-two');
    expect(textOf(chunks)).toBe('The answer is 42.');
  });
});

// Cohere chat/embeddings and Ollama embeddings are left out: aimock 1.46's responses for those
// fail the providers' own response validation, so they would test the mock, not the bridge.
describe('embeddings via aimock', () => {
  it.each([
    ['@ai-sdk/openai', () => createOpenAI({ baseURL: `${url}/v1`, apiKey: key }).embedding('text-embedding-3-small')],
  ] as const)('%s', async (_label, makeModel) => {
    const result = await embed({ adapter: aiSdkEmbedding(makeModel()), input: ['red guitar', 'blue drums'] });
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[1]?.index).toBe(1);
    expect(result.embeddings[0]?.vector.length).toBeGreaterThan(0);
  });
});

describe('@ai-sdk/openai media models via aimock', () => {
  const openai = () => createOpenAI({ baseURL: `${url}/v1`, apiKey: key });

  it('generates an image', async () => {
    const result = await generateImage({
      threadId: 't',
      adapter: aiSdkImage(openai().image('gpt-image-1')),
      prompt: 'a lighthouse at dusk',
    });
    expect(result.images).toEqual([{ b64Json: 'aW1hZ2U=' }]);
  });

  it('generates speech', async () => {
    const result = await generateSpeech({
      threadId: 't',
      adapter: aiSdkSpeech(openai().speech('gpt-4o-mini-tts')),
      text: 'Hello there',
      voice: 'alloy',
      format: 'mp3',
    });
    expect(result.audio).toBe('YXVkaW8=');
    expect(result.format).toBe('mp3');
  });

  it('transcribes audio', async () => {
    const audio = new Blob([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0])], { type: 'audio/wav' });
    const result = await generateTranscription({
      threadId: 't',
      adapter: aiSdkTranscription(openai().transcription('whisper-1')),
      audio,
    });
    expect(result.text).toBe('hello from aimock');
  });
});

describe('@ai-sdk/cohere reranking via aimock', () => {
  it('ranks documents', async () => {
    const cohere = createCohere({ baseURL: `${url}/v2`, apiKey: key });
    const result = await rerank({
      adapter: aiSdkRerank(cohere.reranking('rerank-v3.5')),
      query: 'refund policy',
      documents: ['shipping times', 'refunds within 30 days'],
    });
    expect(JSON.stringify(result)).toContain('0.93');
  });
});
