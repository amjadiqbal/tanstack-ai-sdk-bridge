import type {
  LanguageModelV4FilePart,
  LanguageModelV4FunctionTool,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4ToolChoice,
  LanguageModelV4ToolResultOutput,
} from '@ai-sdk/provider';
import type { ContentPart, ModelMessage, TextOptions, Tool, ToolChoice } from '@tanstack/ai';
import { isFileSource, normalizeSystemPrompts, unsupportedFileSourceError } from '@tanstack/ai';
import type { SpecVersion } from './shared';

const DEFAULT_MEDIA_TYPE: Record<string, string> = {
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
  document: 'application/pdf',
};

type MediaPart = Exclude<ContentPart, { type: 'text' }>;

function filePart(part: MediaPart, adapterName: string): LanguageModelV4FilePart {
  const { source } = part;
  if (isFileSource(source)) throw unsupportedFileSourceError(adapterName);
  const mediaType = source.mimeType ?? DEFAULT_MEDIA_TYPE[part.type] ?? 'application/octet-stream';
  if (source.type === 'url') {
    return { type: 'file', mediaType, data: { type: 'url', url: new URL(source.value) } };
  }
  return { type: 'file', mediaType, data: { type: 'data', data: source.value } };
}

function textOf(content: ModelMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.content)
    .join('');
}

function parseJson(value: string): unknown {
  if (value.trim() === '') return {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toolOutput(message: ModelMessage): LanguageModelV4ToolResultOutput {
  if (message.error !== undefined) return { type: 'error-text', value: message.error || textOf(message.content) };
  return { type: 'text', value: textOf(message.content) };
}

/**
 * Converts TanStack AI system prompts and messages into an AI SDK V4 prompt.
 * `toPromptForSpec` then adapts file parts for V2/V3 models.
 */
export function toAiSdkPrompt(
  options: Pick<TextOptions, 'messages' | 'systemPrompts'>,
  adapterName: string,
): LanguageModelV4Prompt {
  const prompt: LanguageModelV4Prompt = [];
  for (const system of normalizeSystemPrompts(options.systemPrompts)) {
    if (system.content) prompt.push({ role: 'system', content: system.content });
  }

  const toolNames = new Map<string, string>();
  for (const message of options.messages) {
    for (const call of message.toolCalls ?? []) toolNames.set(call.id, call.function.name);
  }

  for (const message of options.messages) {
    if (message.role === 'user') {
      const content: Extract<LanguageModelV4Message, { role: 'user' }>['content'] = [];
      if (typeof message.content === 'string') {
        content.push({ type: 'text', text: message.content });
      } else {
        for (const part of message.content ?? []) {
          content.push(part.type === 'text' ? { type: 'text', text: part.content } : filePart(part, adapterName));
        }
      }
      if (content.length > 0) prompt.push({ role: 'user', content });
      continue;
    }

    if (message.role === 'assistant') {
      const content: Extract<LanguageModelV4Message, { role: 'assistant' }>['content'] = [];
      for (const thinking of message.thinking ?? []) {
        if (thinking.content && !thinking.redacted) content.push({ type: 'reasoning', text: thinking.content });
      }
      const text = textOf(message.content);
      if (text) content.push({ type: 'text', text });
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.function.name,
          input: parseJson(call.function.arguments),
        });
      }
      if (content.length > 0) prompt.push({ role: 'assistant', content });
      continue;
    }

    // role: 'tool'
    const toolCallId = message.toolCallId ?? '';
    const part = {
      type: 'tool-result' as const,
      toolCallId,
      toolName: toolNames.get(toolCallId) ?? message.name ?? 'unknown',
      output: toolOutput(message),
    };
    const last = prompt[prompt.length - 1];
    if (last?.role === 'tool') last.content.push(part);
    else prompt.push({ role: 'tool', content: [part] });
  }
  return prompt;
}

/**
 * V2/V3 file parts carry raw data (base64 string, bytes or URL) instead of V4's `{ type, ... }` wrapper,
 * and V2's tool result `content` output differs. Everything else in the prompt is the same shape.
 */
export function toPromptForSpec(prompt: LanguageModelV4Prompt, version: SpecVersion): unknown[] {
  if (version === 'v4') return prompt;
  return prompt.map((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== 'file') return part;
        const data = part.data;
        const raw = data.type === 'url' ? data.url : data.type === 'data' ? data.data : undefined;
        if (raw === undefined) throw new Error(`File data of type "${data.type}" needs an AI SDK v4 model.`);
        return { ...part, data: raw };
      }),
    };
  });
}

export function toAiSdkTools(tools: ReadonlyArray<Tool> | undefined): LanguageModelV4FunctionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as LanguageModelV4FunctionTool['inputSchema'],
  }));
}

export function toAiSdkToolChoice(choice: ToolChoice | undefined): LanguageModelV4ToolChoice | undefined {
  if (choice === undefined) return undefined;
  if (typeof choice === 'string') return { type: choice };
  return { type: 'tool', toolName: choice.name };
}
