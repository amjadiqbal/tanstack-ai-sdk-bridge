import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider';

export function streamOf<T>(parts: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

export const usageV4 = (input: number, output: number, reasoning?: number): LanguageModelV4Usage => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning },
});

export const finish = (
  unified: 'stop' | 'tool-calls' | 'length' = 'stop',
  usage = usageV4(10, 5),
): LanguageModelV4StreamPart => ({ type: 'finish', usage, finishReason: { unified, raw: unified } });

export const textParts = (...deltas: string[]): LanguageModelV4StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'response-metadata', id: 'resp-1', modelId: 'mock-model-1' },
  { type: 'text-start', id: 't1' },
  ...deltas.map((delta) => ({ type: 'text-delta' as const, id: 't1', delta })),
  { type: 'text-end', id: 't1' },
];

export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}
