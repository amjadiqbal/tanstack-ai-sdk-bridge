import type { LanguageModelV2, LanguageModelV3, LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider';
import type { AdapterYieldChunk, ReasoningLevel, TextOptions } from '@tanstack/ai';
import { EventType } from '@tanstack/ai';
import type { InternalLogger } from '@tanstack/ai/adapter-internals';
import { tanstackMetadata, toRunErrorPayload, transformMessagesForReplay } from '@tanstack/ai/adapter-internals';
import type { StructuredOutputOptions, StructuredOutputResult } from '@tanstack/ai/adapters';
import { BaseTextAdapter } from '@tanstack/ai/adapters';
import { toAiSdkPrompt, toAiSdkToolChoice, toAiSdkTools, toPromptForSpec } from './messages';
import {
  type AiSdkAdapterOptions,
  type AiSdkCallOptions,
  adapterName,
  randomId,
  type SpecVersion,
  specVersionOf,
} from './shared';
import { languageModelUsage } from './usage';

/** Any AI SDK language model: spec v2 (AI SDK 5), v3 (AI SDK 6) or v4 (AI SDK 7). */
export type AiSdkLanguageModel = LanguageModelV2 | LanguageModelV3 | LanguageModelV4;

/** `modelOptions` for `chat()` with a bridged model. Sampling settings go to the AI SDK call unchanged. */
export interface AiSdkTextModelOptions extends AiSdkCallOptions {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  seed?: number;
}

type AnyStreamPart = { type: string; [key: string]: unknown };
type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls';
type Modalities = readonly ['text', 'image', 'audio', 'video', 'document'];
type MetadataByModality = { text: unknown; image: unknown; audio: unknown; video: unknown; document: unknown };

const SPECS: ReadonlyArray<SpecVersion> = ['v2', 'v3', 'v4'];

const REASONING: Record<ReasoningLevel, NonNullable<LanguageModelV4CallOptions['reasoning']>> = {
  off: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

function finishReason(reason: unknown, sawToolCalls: boolean): FinishReason {
  if (sawToolCalls) return 'tool_calls';
  const unified = typeof reason === 'object' && reason !== null ? (reason as { unified?: string }).unified : reason;
  switch (unified) {
    case 'length':
      return 'length';
    case 'content-filter':
      return 'content_filter';
    case 'tool-calls':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

function parseObject(json: string): unknown {
  try {
    const value = JSON.parse(json || '{}');
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Parses a model's JSON answer, also when the model wrapped it in a Markdown code fence. */
export function parseJsonAnswer(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (fenced?.[1]) return JSON.parse(fenced[1]);
    throw error;
  }
}

/** Replay-safe tool call ids: letters, digits, `_` and `-`, at most 64 characters. */
function cleanToolCallId(id: string, { attempt }: { attempt: number }): string {
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return attempt === 0 ? clean : `${clean.slice(0, 50)}_${attempt}`;
}

/**
 * TanStack AI text adapter around an AI SDK language model.
 * Streams text, reasoning and tool calls as AG-UI events and maps usage and finish reasons.
 */
export class AiSdkTextAdapter<TModel extends string = string> extends BaseTextAdapter<
  TModel,
  AiSdkTextModelOptions,
  Modalities,
  MetadataByModality,
  ReadonlyArray<string>,
  unknown,
  never,
  { levels: ReasoningLevel; budget: false }
> {
  readonly name: string;
  override readonly api = 'ai-sdk';
  override readonly provider: string;
  override readonly inputModalities: Modalities = ['text', 'image', 'audio', 'video', 'document'];
  /** The wrapped AI SDK model. */
  readonly languageModel: AiSdkLanguageModel;
  /** AI SDK spec version of the wrapped model. */
  readonly specificationVersion: SpecVersion;

  constructor(model: AiSdkLanguageModel, options?: AiSdkAdapterOptions) {
    super({}, model.modelId as TModel);
    this.specificationVersion = specVersionOf(model, 'language', SPECS);
    this.languageModel = model;
    this.name = adapterName(model, options);
    this.provider = this.name;
  }

  private callOptions(options: TextOptions<AiSdkTextModelOptions>): LanguageModelV4CallOptions {
    const { messages } = transformMessagesForReplay(
      options.messages,
      { provider: this.name, api: this.api, model: this.model },
      cleanToolCallId,
    );
    const prompt = toAiSdkPrompt({ messages, systemPrompts: options.systemPrompts }, this.name);
    const { providerOptions, headers, ...sampling } = options.modelOptions ?? {};
    const tools = toAiSdkTools(options.tools);
    const toolChoice = tools ? toAiSdkToolChoice(options.toolChoice) : undefined;
    const abortSignal = options.abortController?.signal ?? options.request?.signal ?? undefined;
    const call: LanguageModelV4CallOptions = {
      prompt: toPromptForSpec(prompt, this.specificationVersion) as LanguageModelV4CallOptions['prompt'],
      ...sampling,
      ...(tools && { tools }),
      ...(toolChoice && { toolChoice }),
      ...(abortSignal && { abortSignal }),
      ...(headers && { headers }),
      ...(providerOptions && { providerOptions: providerOptions as LanguageModelV4CallOptions['providerOptions'] }),
    };
    if (options.reasoning && this.specificationVersion === 'v4') call.reasoning = REASONING[options.reasoning.level];
    return call;
  }

  async *chatStream(options: TextOptions<AiSdkTextModelOptions>): AsyncIterable<AdapterYieldChunk> {
    const { logger } = options;
    const source = { provider: this.name, api: this.api, model: options.model };
    try {
      const call = this.callOptions(options);
      logger.request(
        `activity=chat provider=${this.name} model=${this.model} messages=${options.messages.length} tools=${options.tools?.length ?? 0} stream=true`,
        { provider: this.name, model: this.model },
      );
      const result = await (this.languageModel as LanguageModelV4).doStream(call);
      const stream = result.stream as ReadableStream<AnyStreamPart>;
      for await (const chunk of this.mapStream(stream, options, logger, call.abortSignal)) {
        yield { ...chunk, metadata: { ...chunk.metadata, tanstack: { ...tanstackMetadata(chunk), source } } };
      }
    } catch (error: unknown) {
      logger.errors(`${this.name}.chatStream fatal`, { error, source: `${this.name}.chatStream` });
      yield this.runError(error, options.model, source);
    }
  }

  private runError(error: unknown, model: string, source: object): AdapterYieldChunk {
    const payload = toRunErrorPayload(error, 'An unknown error occurred during the chat stream.');
    return {
      type: EventType.RUN_ERROR,
      metadata: { tanstack: { source } },
      model,
      timestamp: Date.now(),
      message: payload.message,
      code: payload.code,
      error: { message: payload.message, code: payload.code },
    } as AdapterYieldChunk;
  }

  private async *mapStream(
    stream: ReadableStream<AnyStreamPart>,
    options: TextOptions<AiSdkTextModelOptions>,
    logger: InternalLogger,
    abortSignal: AbortSignal | undefined,
  ): AsyncIterable<AdapterYieldChunk> {
    const runId = options.runId ?? randomId('run');
    const threadId = options.threadId;
    const messageId = randomId('msg');
    let model = options.model;
    let text = '';
    let textOpen = false;
    let reasoningId: string | undefined;
    let finished = false;
    const started = new Map<string, { name: string; args: string; index: number }>();
    const skipped = new Set<string>();
    let toolCallCount = 0;

    yield {
      type: EventType.RUN_STARTED,
      runId,
      threadId,
      model,
      timestamp: Date.now(),
      parentRunId: options.parentRunId,
    } as AdapterYieldChunk;

    const closeReasoning = function* (): Generator<AdapterYieldChunk> {
      if (!reasoningId) return;
      yield {
        type: EventType.REASONING_MESSAGE_END,
        messageId: reasoningId,
        model,
        timestamp: Date.now(),
      } as AdapterYieldChunk;
      yield {
        type: EventType.REASONING_END,
        messageId: reasoningId,
        model,
        timestamp: Date.now(),
      } as AdapterYieldChunk;
      reasoningId = undefined;
    };

    const reader = stream.getReader();
    const onAbort = () => void reader.cancel().catch(() => undefined);
    if (abortSignal?.aborted) onAbort();
    else abortSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      while (true) {
        const { done, value: part } = await reader.read();
        if (done) break;
        logger.provider(`provider=${this.name}`, { chunk: part });
        switch (part.type) {
          case 'response-metadata':
            if (typeof part.modelId === 'string') model = part.modelId;
            break;

          case 'text-delta': {
            const delta = String(part.delta ?? part.textDelta ?? '');
            if (!delta) break;
            yield* closeReasoning();
            if (!textOpen) {
              textOpen = true;
              yield {
                type: EventType.TEXT_MESSAGE_START,
                messageId,
                role: 'assistant',
                model,
                timestamp: Date.now(),
              } as AdapterYieldChunk;
            }
            text += delta;
            yield {
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta,
              content: text,
              model,
              timestamp: Date.now(),
            } as AdapterYieldChunk;
            break;
          }

          case 'reasoning-start':
          case 'reasoning-delta': {
            if (!reasoningId) {
              reasoningId = randomId('reasoning');
              yield {
                type: EventType.REASONING_START,
                messageId: reasoningId,
                model,
                timestamp: Date.now(),
              } as AdapterYieldChunk;
              yield {
                type: EventType.REASONING_MESSAGE_START,
                messageId: reasoningId,
                role: 'reasoning',
                model,
                timestamp: Date.now(),
              } as AdapterYieldChunk;
            }
            const delta = part.type === 'reasoning-delta' ? String(part.delta ?? '') : '';
            if (delta) {
              yield {
                type: EventType.REASONING_MESSAGE_CONTENT,
                messageId: reasoningId,
                delta,
                model,
                timestamp: Date.now(),
              } as AdapterYieldChunk;
            }
            break;
          }

          case 'reasoning-end':
            yield* closeReasoning();
            break;

          case 'tool-input-start': {
            const id = String(part.id);
            if (part.providerExecuted) {
              skipped.add(id);
              break;
            }
            yield* closeReasoning();
            const name = String(part.toolName);
            started.set(id, { name, args: '', index: toolCallCount++ });
            yield {
              type: EventType.TOOL_CALL_START,
              toolCallId: id,
              toolCallName: name,
              parentMessageId: messageId,
              index: started.get(id)?.index,
              model,
              timestamp: Date.now(),
            } as AdapterYieldChunk;
            break;
          }

          case 'tool-input-delta': {
            const id = String(part.id);
            const call = started.get(id);
            if (!call || skipped.has(id)) break;
            const delta = String(part.delta ?? '');
            call.args += delta;
            yield {
              type: EventType.TOOL_CALL_ARGS,
              toolCallId: id,
              delta,
              args: call.args,
              model,
              timestamp: Date.now(),
            } as AdapterYieldChunk;
            break;
          }

          case 'tool-call': {
            const id = String(part.toolCallId);
            if (part.providerExecuted || skipped.has(id)) break;
            const name = String(part.toolName);
            const input = typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? part.args ?? {});
            let call = started.get(id);
            if (!call) {
              yield* closeReasoning();
              call = { name, args: '', index: toolCallCount++ };
              started.set(id, call);
              yield {
                type: EventType.TOOL_CALL_START,
                toolCallId: id,
                toolCallName: name,
                parentMessageId: messageId,
                index: call.index,
                model,
                timestamp: Date.now(),
              } as AdapterYieldChunk;
            }
            if (call.args !== input) {
              const delta = input.startsWith(call.args) ? input.slice(call.args.length) : input;
              call.args = input;
              if (delta) {
                yield {
                  type: EventType.TOOL_CALL_ARGS,
                  toolCallId: id,
                  delta,
                  args: input,
                  model,
                  timestamp: Date.now(),
                } as AdapterYieldChunk;
              }
            }
            const parsed = parseObject(input);
            yield {
              type: EventType.TOOL_CALL_END,
              toolCallId: id,
              toolCallName: name,
              args: input,
              ...(parsed !== undefined && { input: parsed }),
              model,
              timestamp: Date.now(),
            } as AdapterYieldChunk;
            break;
          }

          case 'error':
            yield* closeReasoning();
            yield this.runError(part.error, model, { provider: this.name, api: this.api, model });
            return;

          case 'finish': {
            yield* closeReasoning();
            if (textOpen) {
              textOpen = false;
              yield { type: EventType.TEXT_MESSAGE_END, messageId, model, timestamp: Date.now() } as AdapterYieldChunk;
            }
            const usage = languageModelUsage(part.usage as Parameters<typeof languageModelUsage>[0]);
            finished = true;
            yield {
              type: EventType.RUN_FINISHED,
              runId,
              threadId,
              model,
              finishReason: finishReason(part.finishReason, toolCallCount > 0),
              ...(usage && { usage }),
              timestamp: Date.now(),
            } as AdapterYieldChunk;
            break;
          }

          default:
            // stream-start, raw, source, file, provider tool results, approvals: nothing to map.
            break;
        }
      }
    } finally {
      abortSignal?.removeEventListener('abort', onAbort);
      reader.releaseLock();
    }

    if (!finished) {
      yield* closeReasoning();
      if (textOpen)
        yield { type: EventType.TEXT_MESSAGE_END, messageId, model, timestamp: Date.now() } as AdapterYieldChunk;
      yield {
        type: EventType.RUN_FINISHED,
        runId,
        threadId,
        model,
        finishReason: toolCallCount > 0 ? 'tool_calls' : 'stop',
        timestamp: Date.now(),
      } as AdapterYieldChunk;
    }
  }

  async structuredOutput(
    options: StructuredOutputOptions<AiSdkTextModelOptions>,
  ): Promise<StructuredOutputResult<unknown>> {
    const { chatOptions, outputSchema } = options;
    const { logger } = chatOptions;
    try {
      const call = this.callOptions({ ...chatOptions, tools: undefined });
      call.responseFormat = { type: 'json', schema: outputSchema as never };
      logger.request(
        `activity=chat provider=${this.name} model=${this.model} messages=${chatOptions.messages.length} stream=false structured=true`,
        { provider: this.name, model: this.model },
      );
      const result = await (this.languageModel as LanguageModelV4).doGenerate(call);
      const rawText = result.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('');
      if (finishReason(result.finishReason, false) === 'length') {
        throw new Error('the response was cut off at the maximum token limit; raise modelOptions.maxOutputTokens');
      }
      let data: unknown;
      try {
        data = parseJsonAnswer(rawText);
      } catch {
        throw new Error(
          `the model did not return valid JSON: ${rawText.slice(0, 200)}${rawText.length > 200 ? '...' : ''}`,
        );
      }
      const usage = languageModelUsage(result.usage as Parameters<typeof languageModelUsage>[0]);
      return {
        data,
        rawText,
        ...(usage && { usage }),
        ...(result.response?.id && { responseId: result.response.id }),
        ...(result.response?.modelId && { model: result.response.modelId }),
      };
    } catch (error: unknown) {
      logger.errors(`${this.name}.structuredOutput fatal`, { error, source: `${this.name}.structuredOutput` });
      throw new Error(`Structured output generation failed: ${(error as Error)?.message ?? String(error)}`, {
        cause: error,
      });
    }
  }
}

/**
 * Wraps an AI SDK language model as a TanStack AI text adapter.
 *
 * @example
 * import { chat } from '@tanstack/ai'
 * import { deepseek } from '@ai-sdk/deepseek'
 * chat({ adapter: aiSdkText(deepseek('deepseek-chat')), messages })
 */
export function aiSdkText(model: AiSdkLanguageModel, options?: AiSdkAdapterOptions): AiSdkTextAdapter<string> {
  return new AiSdkTextAdapter(model, options);
}
