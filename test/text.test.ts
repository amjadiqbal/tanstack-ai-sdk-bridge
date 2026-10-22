import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  LanguageModelV4CallOptions,
} from '@ai-sdk/provider';
import { chat, toolDefinition } from '@tanstack/ai';
import { MockLanguageModelV3, MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiSdkTextAdapter, aiSdkText } from '../src';
import { collect, finish, streamOf, textParts, usageV4 } from './helpers';

const user = (content: string) => [{ role: 'user' as const, content }];

describe('aiSdkText: streaming text', () => {
  it('streams text, usage and finish from a spec v4 model through chat()', async () => {
    const model = new MockLanguageModelV4({
      provider: 'deepseek.chat',
      modelId: 'deepseek-chat',
      doStream: { stream: streamOf([...textParts('Hello', ', ', 'world'), finish('stop', usageV4(12, 3, 1))]) },
    });
    const adapter = aiSdkText(model);
    expect(adapter.name).toBe('deepseek');
    expect(adapter.model).toBe('deepseek-chat');
    expect(adapter.specificationVersion).toBe('v4');

    const chunks = await collect(chat({ threadId: 't', adapter, messages: user('Hi') }));
    const types: string[] = chunks.map((c) => c.type);
    expect(types[0]).toBe('RUN_STARTED');
    expect(types).toContain('TEXT_MESSAGE_START');
    expect(types).toContain('TEXT_MESSAGE_END');
    expect(types.at(-1)).toBe('RUN_FINISHED');
    const text = chunks
      .filter((c) => c.type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c as { delta: string }).delta)
      .join('');
    expect(text).toBe('Hello, world');
    // chat() moves finishReason into metadata.tanstack on the public stream.
    const done = chunks.find((c) => c.type === 'RUN_FINISHED') as {
      metadata?: { tanstack?: { finishReason?: string } };
      usage?: unknown;
    };
    expect(done.metadata?.tanstack?.finishReason).toBe('stop');
    expect(JSON.stringify(done.usage)).toContain('12');
  });

  it('returns the full text with stream: false', async () => {
    const model = new MockLanguageModelV4({ doStream: { stream: streamOf([...textParts('All ', 'done'), finish()]) } });
    const result = await chat({ threadId: 't', adapter: aiSdkText(model), messages: user('Hi'), stream: false });
    expect(result.text).toBe('All done');
  });

  it('works with a spec v3 model', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: streamOf([
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: 'from v3' },
          { type: 'text-end', id: 'a' },
          {
            type: 'finish',
            usage: {
              inputTokens: { total: 4, noCache: 4, cacheRead: 2, cacheWrite: undefined },
              outputTokens: { total: 2, text: 2, reasoning: undefined },
            },
            finishReason: { unified: 'stop', raw: 'stop' },
          },
        ]),
      },
    });
    const result = await chat({ threadId: 't', adapter: aiSdkText(model), messages: user('Hi'), stream: false });
    expect(result.text).toBe('from v3');
  });

  it('works with a spec v2 model (AI SDK 5): flat usage, string finish reason, raw file data', async () => {
    const calls: LanguageModelV2CallOptions[] = [];
    const model: LanguageModelV2 = {
      specificationVersion: 'v2',
      provider: 'togetherai.chat',
      modelId: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      supportedUrls: {},
      doGenerate: () => Promise.reject(new Error('not used')),
      doStream: async (options) => {
        calls.push(options);
        return {
          stream: streamOf<LanguageModelV2StreamPart>([
            { type: 'text-start', id: 'a' },
            { type: 'text-delta', id: 'a', delta: 'from v2' },
            { type: 'text-end', id: 'a' },
            { type: 'finish', usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 }, finishReason: 'stop' },
          ]),
        };
      },
    };
    const chunks = await collect(
      chat({
        threadId: 't',
        adapter: aiSdkText(model),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', content: 'What is this?' },
              { type: 'image', source: { type: 'data', value: 'aGVsbG8=', mimeType: 'image/png' } },
            ],
          },
        ],
      }),
    );
    expect(chunks.some((c) => c.type === 'TEXT_MESSAGE_CONTENT')).toBe(true);
    const userMessage = calls[0]?.prompt.find((m) => m.role === 'user');
    expect(userMessage?.content[1]).toMatchObject({ type: 'file', mediaType: 'image/png', data: 'aGVsbG8=' });
  });

  it('sends v4 file parts in the v4 data shape, and image URLs as URL objects', async () => {
    const model = new MockLanguageModelV4({ doStream: { stream: streamOf([...textParts('ok'), finish()]) } });
    await chat({
      threadId: 't',
      adapter: aiSdkText(model),
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'data', value: 'aGVsbG8=', mimeType: 'image/png' } },
            { type: 'image', source: { type: 'url', value: 'https://example.com/cat.jpg' } },
          ],
        },
      ],
    });
    const content = model.doStreamCalls[0]?.prompt.find((m) => m.role === 'user')?.content ?? [];
    expect(content[0]).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
      data: { type: 'data', data: 'aGVsbG8=' },
    });
    expect(content[1]).toMatchObject({ type: 'file', mediaType: 'image/*', data: { type: 'url' } });
  });

  it('maps system prompts and modelOptions to the AI SDK call', async () => {
    const model = new MockLanguageModelV4({ doStream: { stream: streamOf([...textParts('ok'), finish()]) } });
    await chat({
      threadId: 't',
      adapter: aiSdkText(model),
      messages: user('Hi'),
      systemPrompts: ['Be brief.'],
      modelOptions: {
        temperature: 0.2,
        maxOutputTokens: 64,
        stopSequences: ['END'],
        providerOptions: { mock: { flag: true } },
        headers: { 'x-test': '1' },
      },
      stream: false,
    });
    const call = model.doStreamCalls[0] as LanguageModelV4CallOptions;
    expect(call.prompt[0]).toEqual({ role: 'system', content: 'Be brief.' });
    expect(call.temperature).toBe(0.2);
    expect(call.maxOutputTokens).toBe(64);
    expect(call.stopSequences).toEqual(['END']);
    expect(call.providerOptions).toEqual({ mock: { flag: true } });
    expect(call.headers).toEqual({ 'x-test': '1' });
  });
});

describe('aiSdkText: tools', () => {
  it('streams tool calls, lets chat() run the tool, and sends the result back', async () => {
    const execute = vi.fn(async ({ city }: { city: string }) => ({ city, tempC: 21 }));
    const getWeather = toolDefinition({
      name: 'getWeather',
      description: 'Weather for a city',
      inputSchema: z.object({ city: z.string() }),
    }).server(execute);

    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: streamOf([
            { type: 'tool-input-start', id: 'call_1', toolName: 'getWeather' },
            { type: 'tool-input-delta', id: 'call_1', delta: '{"city":' },
            { type: 'tool-input-delta', id: 'call_1', delta: '"Lahore"}' },
            { type: 'tool-input-end', id: 'call_1' },
            { type: 'tool-call', toolCallId: 'call_1', toolName: 'getWeather', input: '{"city":"Lahore"}' },
            finish('tool-calls'),
          ]),
        },
        { stream: streamOf([...textParts('It is 21°C in Lahore.'), finish()]) },
      ],
    });

    const chunks = await collect(
      chat({ threadId: 't', adapter: aiSdkText(model), messages: user('Weather in Lahore?'), tools: [getWeather] }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({ city: 'Lahore' });

    const first = model.doStreamCalls[0] as LanguageModelV4CallOptions;
    expect(first.tools?.[0]).toMatchObject({ type: 'function', name: 'getWeather', description: 'Weather for a city' });
    expect(JSON.stringify(first.tools?.[0])).toContain('"city"');

    const second = model.doStreamCalls[1] as LanguageModelV4CallOptions;
    const assistant = second.prompt.find((m) => m.role === 'assistant');
    expect(assistant?.content).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'getWeather',
        input: { city: 'Lahore' },
      }),
    );
    const tool = second.prompt.find((m) => m.role === 'tool');
    expect(tool?.content[0]).toMatchObject({ type: 'tool-result', toolCallId: 'call_1', toolName: 'getWeather' });
    expect(JSON.stringify(tool?.content[0])).toContain('21');

    const types: string[] = chunks.map((c) => c.type);
    expect(types).toContain('TOOL_CALL_START');
    expect(types).toContain('TOOL_CALL_ARGS');
    expect(types).toContain('TOOL_CALL_END');
    expect(
      chunks
        .filter((c) => c.type === 'TEXT_MESSAGE_CONTENT')
        .map((c) => (c as { delta: string }).delta)
        .join(''),
    ).toBe('It is 21°C in Lahore.');
  });

  it('handles providers that send only a final tool-call part', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: streamOf([{ type: 'tool-call', toolCallId: 'x1', toolName: 'getTime', input: '{}' }, finish('stop')]),
        },
        { stream: streamOf([...textParts('Noon.'), finish()]) },
      ],
    });
    const getTime = toolDefinition({ name: 'getTime', description: 'Time', inputSchema: z.object({}) }).server(
      async () => '12:00',
    );
    const result = (await chat({
      threadId: 't',
      adapter: aiSdkText(model),
      messages: user('Time?'),
      tools: [getTime],
      stream: false,
    })) as unknown as { text: string };
    expect(result.text).toContain('Noon.');
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it('maps toolChoice', async () => {
    const model = new MockLanguageModelV4({ doStream: { stream: streamOf([...textParts('ok'), finish()]) } });
    const t = toolDefinition({
      name: 'lookup',
      description: 'Lookup',
      inputSchema: z.object({ q: z.string() }),
    }).server(async () => 'x');
    await chat({
      threadId: 't',
      adapter: aiSdkText(model),
      messages: user('Hi'),
      tools: [t],
      toolChoice: { type: 'tool', name: 'lookup' },
      stream: false,
    });
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: 'tool', toolName: 'lookup' });
  });
});

describe('aiSdkText: reasoning, errors, abort', () => {
  it('streams reasoning and sets the v4 reasoning option', async () => {
    const model = new MockLanguageModelV4({
      doStream: {
        stream: streamOf([
          { type: 'reasoning-start', id: 'r1' },
          { type: 'reasoning-delta', id: 'r1', delta: 'Thinking it over.' },
          { type: 'reasoning-end', id: 'r1' },
          ...textParts('42'),
          finish(),
        ]),
      },
    });
    const chunks = await collect(
      chat({ threadId: 't', adapter: aiSdkText(model), messages: user('Answer?'), reasoning: 'high' }),
    );
    expect(model.doStreamCalls[0]?.reasoning).toBe('high');
    const types: string[] = chunks.map((c) => c.type);
    expect(types).toContain('REASONING_START');
    expect(types).toContain('REASONING_MESSAGE_CONTENT');
    expect(types.indexOf('REASONING_END')).toBeLessThan(types.indexOf('TEXT_MESSAGE_START'));
  });

  it('maps reasoning off to none', async () => {
    const model = new MockLanguageModelV4({ doStream: { stream: streamOf([...textParts('ok'), finish()]) } });
    await chat({ threadId: 't', adapter: aiSdkText(model), messages: user('Hi'), reasoning: 'off', stream: false });
    expect(model.doStreamCalls[0]?.reasoning).toBe('none');
  });

  it('turns a stream error part into RUN_ERROR', async () => {
    const model = new MockLanguageModelV4({
      doStream: { stream: streamOf([...textParts('partial'), { type: 'error', error: new Error('upstream 500') }]) },
    });
    const chunks = await collect(chat({ threadId: 't', adapter: aiSdkText(model), messages: user('Hi') }));
    const error = chunks.find((c) => c.type === 'RUN_ERROR') as { message?: string } | undefined;
    expect(error?.message).toContain('upstream 500');
  });

  it('turns a thrown doStream error into RUN_ERROR', async () => {
    const model = new MockLanguageModelV4({ doStream: () => Promise.reject(new Error('401 bad key')) });
    const chunks = await collect(chat({ threadId: 't', adapter: aiSdkText(model), messages: user('Hi') }));
    expect(chunks.some((c) => c.type === 'RUN_ERROR')).toBe(true);
  });

  it('passes the abort signal to the model and stops reading on abort', async () => {
    let cancelled = false;
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: 'first' });
          },
          cancel() {
            cancelled = true;
          },
        }),
      }),
    });
    const abortController = new AbortController();
    const seen: string[] = [];
    for await (const chunk of chat({
      threadId: 't',
      adapter: aiSdkText(model),
      messages: user('Hi'),
      abortController,
    })) {
      seen.push(chunk.type);
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') abortController.abort();
    }
    expect(model.doStreamCalls[0]?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(model.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    expect(seen).toContain('TEXT_MESSAGE_CONTENT');
  });
});

describe('aiSdkText: structured output', () => {
  it('asks for JSON with the schema and returns typed data', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: '```json\n{"name":"Lamp","price":25}\n```' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usageV4(20, 8),
        warnings: [],
      },
    });
    const product = await chat({
      threadId: 't',
      adapter: aiSdkText(model),
      messages: user('Invent a product'),
      outputSchema: z.object({ name: z.string(), price: z.number() }),
      stream: false,
    });
    expect(product).toEqual({ name: 'Lamp', price: 25 });
    const call = model.doGenerateCalls[0] as LanguageModelV4CallOptions;
    expect(call.responseFormat?.type).toBe('json');
    expect(JSON.stringify(call.responseFormat)).toContain('"price"');
  });

  it('leaves schema validation to chat(), which rejects data that does not match', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: '{"name":42}' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usageV4(1, 1),
        warnings: [],
      },
    });
    await expect(
      chat({
        threadId: 't',
        adapter: aiSdkText(model),
        messages: user('x'),
        outputSchema: z.object({ name: z.string() }),
        stream: false,
      }),
    ).rejects.toThrow();
    expect(model.doGenerateCalls[0]?.tools).toBeUndefined();
  });

  it('reports invalid JSON', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: 'not json' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usageV4(1, 1),
        warnings: [],
      },
    });
    await expect(
      chat({
        threadId: 't',
        adapter: aiSdkText(model),
        messages: user('x'),
        outputSchema: z.object({ a: z.string() }),
        stream: false,
      }),
    ).rejects.toThrow(/valid JSON/);
  });
});

describe('aiSdkText: construction', () => {
  it('rejects unknown spec versions', () => {
    const model = { specificationVersion: 'v1', provider: 'old', modelId: 'm' } as never;
    expect(() => new AiSdkTextAdapter(model)).toThrow(/spec "v1"/);
  });

  it('takes a custom adapter name', () => {
    expect(aiSdkText(new MockLanguageModelV4(), { name: 'my-llm' }).name).toBe('my-llm');
  });
});
