import type { TokenUsage } from '@tanstack/ai';

/** AI SDK V2 usage: flat counts. */
interface UsageV2 {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  reasoningTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
}

/** AI SDK V3/V4 usage: nested counts. */
interface UsageV3 {
  inputTokens: {
    total: number | undefined;
    noCache?: number | undefined;
    cacheRead: number | undefined;
    cacheWrite: number | undefined;
  };
  outputTokens: { total: number | undefined; text?: number | undefined; reasoning: number | undefined };
}

/** Maps AI SDK language-model usage (any spec version) to TanStack AI `TokenUsage`. */
export function languageModelUsage(usage: UsageV2 | UsageV3 | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  let input: number | undefined;
  let output: number | undefined;
  let total: number | undefined;
  let cached: number | undefined;
  let cacheWrite: number | undefined;
  let reasoning: number | undefined;
  if (typeof usage.inputTokens === 'object' && usage.inputTokens !== null) {
    const v3 = usage as UsageV3;
    input = v3.inputTokens.total;
    output = v3.outputTokens.total;
    cached = v3.inputTokens.cacheRead;
    cacheWrite = v3.inputTokens.cacheWrite;
    reasoning = v3.outputTokens.reasoning;
  } else {
    const v2 = usage as UsageV2;
    input = v2.inputTokens;
    output = v2.outputTokens;
    total = v2.totalTokens;
    cached = v2.cachedInputTokens;
    reasoning = v2.reasoningTokens;
  }
  if (input === undefined && output === undefined && total === undefined) return undefined;
  const promptTokens = input ?? 0;
  const completionTokens = output ?? 0;
  const result: TokenUsage = { promptTokens, completionTokens, totalTokens: total ?? promptTokens + completionTokens };
  if (cached !== undefined || cacheWrite !== undefined) {
    result.promptTokensDetails = {
      ...(cached !== undefined && { cachedTokens: cached }),
      ...(cacheWrite !== undefined && { cacheWriteTokens: cacheWrite }),
    };
  }
  if (reasoning !== undefined) {
    result.completionTokensDetails = { reasoningTokens: reasoning };
  }
  return result;
}
