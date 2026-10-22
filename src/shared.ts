import type { TokenUsage } from '@tanstack/ai';

/** AI SDK provider spec versions this package reads. */
export type SpecVersion = 'v2' | 'v3' | 'v4';

/** Fields every AI SDK model object has, whatever its kind and spec version. */
export interface AiSdkModelIdentity {
  readonly specificationVersion: string;
  readonly provider: string;
  readonly modelId: string;
}

/** Options every bridge adapter takes besides the model. */
export interface AiSdkAdapterOptions {
  /**
   * Adapter name shown by TanStack AI (devtools, usage, history source).
   * Defaults to the first segment of the AI SDK provider id, e.g. `deepseek` for `deepseek.chat`.
   */
  name?: string;
}

/** Per-call options shared by every activity. `providerOptions` goes to the AI SDK model unchanged. */
export interface AiSdkCallOptions {
  /** AI SDK `providerOptions`, keyed by provider, e.g. `{ openai: { user: 'u1' } }`. */
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Extra HTTP headers for this call. */
  headers?: Record<string, string | undefined>;
}

export function specVersionOf(
  model: AiSdkModelIdentity,
  kind: string,
  supported: ReadonlyArray<SpecVersion>,
): SpecVersion {
  const version = model.specificationVersion as SpecVersion;
  if (!supported.includes(version)) {
    throw new Error(
      `@amjadiqbal/tanstack-ai-sdk-bridge: ${kind} model "${model.provider}/${model.modelId}" uses AI SDK spec ` +
        `"${model.specificationVersion}", supported: ${supported.join(', ')}.`,
    );
  }
  return version;
}

export function adapterName(model: AiSdkModelIdentity, options: AiSdkAdapterOptions | undefined): string {
  return options?.name ?? (model.provider.split('.')[0] || model.provider);
}

export function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function tokenUsage(input: number | undefined, output: number | undefined, total?: number): TokenUsage {
  const promptTokens = input ?? 0;
  const completionTokens = output ?? 0;
  return { promptTokens, completionTokens, totalTokens: total ?? promptTokens + completionTokens };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Splits `data:<type>;base64,<data>` into its parts. Returns undefined for anything else. */
export function parseDataUrl(value: string): { mediaType: string; base64: string } | undefined {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s.exec(value);
  if (!match) return undefined;
  return { mediaType: match[1] ?? 'application/octet-stream', base64: match[2] ?? '' };
}

/** Pass-through call fields, without keys whose value is undefined. */
export function callExtras(options: AiSdkCallOptions | undefined, abortSignal: AbortSignal | undefined) {
  return {
    ...(options?.providerOptions !== undefined && { providerOptions: options.providerOptions }),
    ...(options?.headers !== undefined && { headers: definedHeaders(options.headers) }),
    ...(abortSignal !== undefined && { abortSignal }),
  } as {
    providerOptions?: Record<string, Record<string, never>>;
    headers?: Record<string, string>;
    abortSignal?: AbortSignal;
  };
}

function definedHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
