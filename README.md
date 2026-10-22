<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="art/banner-dark.png">
    <img alt="AI SDK Bridge: any Vercel AI SDK provider as a TanStack AI adapter" src="art/banner-light.png" width="100%">
  </picture>
</p>

# TanStack AI SDK Bridge: use Vercel AI SDK providers with TanStack AI

Use any Vercel AI SDK provider (`@ai-sdk/*` and community providers) as a [TanStack AI](https://tanstack.com/ai) adapter. The bridge reads the AI SDK provider spec (v2, v3 and v4), so a provider package works with `chat()`, `embed()`, `generateTranscription()`, `generateSpeech()`, `generateImage()` and `rerank()` without a dedicated TanStack adapter. It is also the shortest path for moving an AI SDK app to TanStack AI: keep your provider setup and change the rest step by step.

Tested with: `@ai-sdk/deepseek`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/togetherai`, `@ai-sdk/cerebras`, `@ai-sdk/fireworks`, `@ai-sdk/cohere` (rerank), `ollama-ai-provider-v2` and `@ai-sdk/openai-compatible` 1.x, 2.x and 3.x (AI SDK 5, 6 and 7). See [What is tested](#what-is-tested).

[![npm](https://img.shields.io/npm/v/@amjadiqbal/tanstack-ai-sdk-bridge?style=flat-square)](https://www.npmjs.com/package/@amjadiqbal/tanstack-ai-sdk-bridge)
[![TanStack AI](https://img.shields.io/badge/TanStack%20AI-1.x-8B5CF6?style=flat-square)](https://tanstack.com/ai)
[![License](https://img.shields.io/npm/l/@amjadiqbal/tanstack-ai-sdk-bridge?style=flat-square)](LICENSE.md)

```ts
import { chat } from '@tanstack/ai'
import { aiSdkText } from '@amjadiqbal/tanstack-ai-sdk-bridge'
import { deepseek } from '@ai-sdk/deepseek'

const stream = chat({
  adapter: aiSdkText(deepseek('deepseek-chat')),
  messages: [{ role: 'user', content: 'Hello!' }],
  threadId: 'thread-1',
})
```

- **Text**: streaming chat, tool calls (TanStack's agent loop runs your tools), reasoning, structured output (`outputSchema`), token usage, abort (see [Abort](#abort)).
- **Embeddings, transcription, speech, image generation, rerank**: one adapter function each.
- **AI SDK 5, 6 and 7 providers**: provider spec v2, v3 and v4 are all read.
- **No AI SDK runtime code**: the built package imports only `@tanstack/ai`. `@ai-sdk/provider` is a dependency because the published type declarations use its model types; nothing from it runs. No `ai` package needed.

## Install

```bash
npm i @amjadiqbal/tanstack-ai-sdk-bridge @tanstack/ai
```

Then the AI SDK provider you want, for example `npm i @ai-sdk/deepseek`. Requires `@tanstack/ai` 1.x and Node 20+.

## Usage

### Chat with a TanStack Start (or any Fetch API) route

```ts
// src/routes/api/chat.ts
import { createFileRoute } from '@tanstack/react-router'
import { chat, toServerSentEventsResponse } from '@tanstack/ai'
import { aiSdkText } from '@amjadiqbal/tanstack-ai-sdk-bridge'
import { createDeepSeek } from '@ai-sdk/deepseek'

const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY })

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages, threadId } = await request.json()
        const stream = chat({
          adapter: aiSdkText(deepseek('deepseek-chat')),
          messages,
          threadId,
          systemPrompts: ['You are a helpful assistant.'],
          modelOptions: { temperature: 0.3, maxOutputTokens: 1024 },
        })
        return toServerSentEventsResponse(stream)
      },
    },
  },
})
```

The client is plain TanStack AI; nothing from this package runs in the browser:

```tsx
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react'

const { messages, sendMessage, isLoading, stop } = useChat({
  connection: fetchServerSentEvents('/api/chat'),
})
```

### Tools

Tools are TanStack AI tools. The bridge sends their JSON Schema to the AI SDK model and streams the calls back, and `chat()` runs them.

```ts
import { chat, toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

const getWeather = toolDefinition({
  name: 'getWeather',
  description: 'Get the weather for a city',
  inputSchema: z.object({ city: z.string() }),
}).server(async ({ city }) => ({ city, tempC: 21 }))

chat({ adapter: aiSdkText(deepseek('deepseek-chat')), messages, threadId, tools: [getWeather] })
```

### Structured output

```ts
const product = await chat({
  adapter: aiSdkText(deepseek('deepseek-chat')),
  messages: [{ role: 'user', content: 'Invent a product.' }],
  threadId: 'product-1',
  outputSchema: z.object({ name: z.string(), price: z.number() }),
  stream: false,
})
// product: { name: string; price: number }
```

What the bridge does for `outputSchema`, exactly:

- After the agent loop, TanStack AI calls the adapter's `structuredOutput()`. The bridge makes **one non-streaming** `doGenerate` call with the conversation, **without tools**, and `responseFormat: { type: 'json', schema }` (the JSON Schema TanStack AI made from your schema). Whether the provider enforces the schema depends on the provider.
- It joins the text parts of the answer and parses them as JSON. An answer wrapped in a Markdown code fence is accepted.
- It throws `Structured output generation failed: ...` (original error as `cause`) when the answer was cut off at the token limit, when the text is not JSON, or when the provider call fails.
- The bridge does not check the data against the schema; `chat()` does that with your schema after the bridge returns.
- `structuredOutputStream` and combined tools-plus-schema in one request are not implemented, so TanStack AI uses its non-streaming path.

### Reasoning

`chat({ reasoning: 'high' })` sets the AI SDK `reasoning` call option on AI SDK 7 (spec v4) models, and reasoning deltas stream as TanStack reasoning events. `'off'` becomes `'none'`. For AI SDK 5 and 6 providers, set reasoning in `modelOptions.providerOptions` the way that provider documents it.

### Model options

`modelOptions` takes the AI SDK call settings and passes them through:

| Option | AI SDK call option |
|---|---|
| `temperature`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `seed`, `stopSequences`, `maxOutputTokens` | same name |
| `providerOptions` | `providerOptions`, e.g. `{ deepseek: { ... } }` |
| `headers` | `headers` |

### Embeddings

```ts
import { embed } from '@tanstack/ai'
import { aiSdkEmbedding } from '@amjadiqbal/tanstack-ai-sdk-bridge'
import { openai } from '@ai-sdk/openai'

const { embeddings } = await embed({
  adapter: aiSdkEmbedding(openai.embedding('text-embedding-3-small')),
  input: ['red guitar', 'blue drum kit'],
})
```

Large inputs are split by the model's `maxEmbeddingsPerCall`. `dimensions` is sent to AI SDK 7 (spec v4) embedding models. On spec v2/v3 models the bridge throws if `dimensions` is set, because their spec has no such field: leave it unset and pass the provider's own option instead, for example `modelOptions: { providerOptions: { openai: { dimensions: 512 } } }`.

### Transcription, speech, image, rerank

```ts
import { generateImage, generateSpeech, generateTranscription, rerank } from '@tanstack/ai'
import { aiSdkImage, aiSdkRerank, aiSdkSpeech, aiSdkTranscription } from '@amjadiqbal/tanstack-ai-sdk-bridge'

import { openai } from '@ai-sdk/openai'
import { cohere } from '@ai-sdk/cohere'

const threadId = 'media-1'
await generateTranscription({ threadId, adapter: aiSdkTranscription(openai.transcription('whisper-1')), audio: file })
await generateSpeech({ threadId, adapter: aiSdkSpeech(openai.speech('gpt-4o-mini-tts')), text: 'Hello', voice: 'alloy' })
await generateImage({ threadId, adapter: aiSdkImage(openai.image('gpt-image-1')), prompt: 'a lighthouse at dusk' })
await rerank({ adapter: aiSdkRerank(cohere.reranking('rerank-v3.5')), query: 'refund policy', documents })
```

| TanStack AI | Bridge | AI SDK model | Spec versions |
|---|---|---|---|
| `chat()` | `aiSdkText(model)` | `LanguageModel` | v2, v3, v4 |
| `embed()` | `aiSdkEmbedding(model)` | `EmbeddingModel` | v2, v3, v4 |
| `generateTranscription()` | `aiSdkTranscription(model)` | `TranscriptionModel` | v2, v3, v4 |
| `generateSpeech()` | `aiSdkSpeech(model)` | `SpeechModel` | v2, v3, v4 |
| `generateImage()` | `aiSdkImage(model)` | `ImageModel` | v2, v3, v4 |
| `rerank()` | `aiSdkRerank(model)` | `RerankingModel` | v3, v4 |

Activity-specific `modelOptions`, on top of `providerOptions` and `headers`:

| Adapter | `modelOptions` | Notes |
|---|---|---|
| `aiSdkTranscription` | `mediaType` | Media type of the audio when it can't be read from a `Blob`/`File` type or a data URL. Default `audio/mpeg`. `language`, `prompt` and `responseFormat` are not sent (the AI SDK spec has no such fields); the result has `text`, plus `segments`, `language` and `duration` when the provider returns them. An `http(s)` URL as `audio` is downloaded with the global `fetch`, not the provider's `fetch`. |
| `aiSdkSpeech` | `instructions`, `language` | Sent as the AI SDK `instructions` and `language` call options. The result's `format` and `contentType` come from the provider's `content-type` header, else from the audio bytes (MP3, WAV, Ogg, FLAC, AAC), else the `format` you asked for, else `unknown`. |
| `aiSdkImage` | `aspectRatio`, `seed`, `mask` | Sent as the AI SDK call options. `mask` is an AI SDK image file (`{ type: 'file', mediaType, data }` or `{ type: 'url', url }`). Image parts in the prompt become input `files`. Input images and masks need a spec v3/v4 model; v2 models throw. When the model does not report `maxImagesPerCall`, one image is requested per call (the AI SDK's own default) until `numberOfImages` is reached. |

Every function takes an optional second argument `{ name }`, the adapter name TanStack AI shows in devtools and usage. It defaults to the provider id before the first dot (`deepseek.chat` becomes `deepseek`).

### Abort

| Activity | How to cancel | Passed to the AI SDK model |
|---|---|---|
| `chat()` | `abortController` (or the `request` signal) | yes: `abortSignal`, and the stream is cancelled |
| `generateTranscription()`, `generateSpeech()`, `generateImage()`, `rerank()` | `abortSignal` | yes |
| `embed()` | none: TanStack AI's `embed()` takes no signal | no |

## Migrating from the Vercel AI SDK

TanStack's own [migration guide](https://tanstack.com/ai/latest/docs/migration/migration-from-vercel-ai) swaps your provider packages for TanStack adapters. With the bridge you can skip that step, and keep providers that have no TanStack adapter:

| Vercel AI SDK | TanStack AI with the bridge |
|---|---|
| `streamText({ model: deepseek('deepseek-chat'), ... })` | `chat({ adapter: aiSdkText(deepseek('deepseek-chat')), ... })` |
| `generateText(...)` | `chat({ ..., stream: false })` |
| `generateObject({ schema })` | `chat({ ..., outputSchema })` |
| `embedMany({ model: openai.embedding(...) })` | `embed({ adapter: aiSdkEmbedding(openai.embedding(...)) })` |
| `transcribe`, `generateSpeech`, `generateImage`, `rerank` | `generateTranscription`, `generateSpeech`, `generateImage`, `rerank` with the matching `aiSdk*` adapter |
| `system: '...'` | `systemPrompts: ['...']` |
| `temperature`, `maxOutputTokens`, `providerOptions` | `modelOptions: { temperature, maxOutputTokens, providerOptions }` |
| `tool({ inputSchema, execute })` | `toolDefinition({ inputSchema }).server(execute)` |
| `useChat` from `@ai-sdk/react` | `useChat` from `@tanstack/ai-react` |
| `result.toUIMessageStreamResponse()` | `toServerSentEventsResponse(stream)` |

A practical order: move the server route and client first with the bridge, ship, then replace a bridged provider with a native TanStack adapter later if one exists and you need its typed per-model options.

## What is tested

Everything below ran on 2026-10-23 with `@tanstack/ai` 1.0.0. **No live provider API was called and no API key was used**: the real provider packages talked HTTP to [aimock](https://github.com/CopilotKit/aimock) 1.46, a local server that speaks each provider's wire format. That covers the request and stream formats, not every model's behaviour.

| Provider package | Spec | Chat stream | Tool loop | Structured output | Other |
|---|---|---|---|---|---|
| `@ai-sdk/deepseek` 3.0 | v4 | ✓ | ✓ | ✓ | reasoning ✓ |
| `@ai-sdk/anthropic` 4.0 | v4 | ✓ | ✓ | ✓ | reasoning ✓ |
| `@ai-sdk/openai` 4.0 (Responses and Chat Completions) | v4 | ✓ | ✓ | ✓ | embeddings, image, speech, transcription ✓ |
| `@ai-sdk/togetherai` 3.0 | v4 | ✓ | ✓ | ✓ | |
| `@ai-sdk/cerebras` 3.0 | v4 | ✓ | ✓ | ✓ | |
| `@ai-sdk/fireworks` 3.0 | v4 | ✓ | ✓ | ✓ | |
| `ollama-ai-provider-v2` 4.1 | v4 | ✓ | ✓ | ✓ | |
| `@ai-sdk/cohere` 4.0 | v4 | | | | rerank ✓ |
| `@ai-sdk/openai-compatible` 3.x / 2.x / 1.x (AI SDK 7 / 6 / 5) | v4 / v3 / v2 | ✓ | ✓ | ✓ | |

- **Unit tests** run every adapter against AI SDK's own `MockLanguageModelV3/V4`, `MockEmbeddingModelV4`, `MockTranscriptionModelV4`, `MockSpeechModelV4`, `MockImageModelV4` and `MockRerankingModelV4` (from `ai/test`) and hand-written spec v2 models, through the real `chat()`, `embed()`, `generateTranscription()`, `generateSpeech()`, `generateImage()` and `rerank()`: streaming, tool calls with and without input deltas, `toolChoice`, reasoning levels, errors, abort, structured output, batching by `maxEmbeddingsPerCall` and `maxImagesPerCall`, and v2/v3/v4 file parts.
- **In a real browser**: a TanStack Start 1.169 app with `@tanstack/ai-react` `useChat`, a `/api/chat` server route as in the example above, and the packed npm tarball installed. Seen working: streamed replies through `@ai-sdk/deepseek` and `@ai-sdk/anthropic`, a server tool call and its result followed by the final answer, reasoning shown before the answer, a second turn on the same thread, the Stop button ending a stream mid-reply, structured output through both providers, and embeddings through `@ai-sdk/openai`.
- **Not tested**: live provider APIs, other AI SDK providers, Vue/Solid/Svelte clients (the bridge runs on the server, so the client framework should not matter), and Cohere chat/embeddings and Ollama embeddings (aimock's responses for those fail the providers' own validation).

## Limits

- **Provider-executed tools** (an AI SDK provider's own web search, code execution and the like) are not forwarded; function tools are.
- **Reasoning signatures** are not sent back, so providers that need signed thinking blocks in later turns (Anthropic extended thinking with tools) receive the reasoning as plain text or drop it.
- `chat({ wrapFetch })` is not applied; pass a custom `fetch` to the provider factory (`createDeepSeek({ fetch })`).
- Provider file handles (`{ type: 'file' }` sources) are rejected; send images and documents as data or URLs.
- Transcription `language`, `prompt` and `responseFormat` are not sent; see the options table.
- Embeddings cannot be aborted (TanStack AI's `embed()` has no signal).
- **TanStack AI internals:** like TanStack's own adapters, the bridge imports helpers (`transformMessagesForReplay`, `tanstackMetadata`, `toRunErrorPayload`) from `@tanstack/ai/adapter-internals`, the subpath TanStack's [community adapter guide](https://tanstack.com/ai/latest/docs/community-adapters/guide) points adapters to. It is not covered by the same stability promise as the main entry. Tested with `@tanstack/ai` 1.0.0; the peer range is `^1.0.0`. If a 1.x release breaks it, please open an issue.
- AI SDK reranking models report no token usage, so `rerank()` usage is zero.
- Video, audio generation and realtime models are not bridged yet.

## Support

- 🐛 **Bug or feature request**: [open an issue](https://github.com/amjadiqbal/tanstack-ai-sdk-bridge/issues)
- 🔒 **Security issue**: please report privately via GitHub's security tab

## Need this built into your app, or something custom?

[Get in touch](https://amjad.com.pk/contact?utm_source=github&utm_medium=readme&utm_campaign=tanstack-ai-sdk-bridge).

[![Hire me on Upwork](https://img.shields.io/badge/Hire%20me-Upwork-6FDA44?style=flat-square&logo=upwork&logoColor=white)](https://www.upwork.com/freelancers/amjadkhatri)

## More packages

Part of a family of open-source packages. See [all of them](https://github.com/amjadiqbal?tab=repositories).

| | |
|---|---|
| [query-key-kit](https://github.com/amjadiqbal/query-key-kit) | Typed query-key hierarchy and invalidation helpers for TanStack Query v5 |
| [start-seo-kit](https://github.com/amjadiqbal/start-seo-kit) | SEO for TanStack Start: meta tags, sitemaps, JSON-LD |
| [tanstack-table-url-state](https://github.com/amjadiqbal/tanstack-table-url-state) | URL state and CSV/XLSX export for TanStack Table |

## License

MIT. See [LICENSE.md](LICENSE.md). Not affiliated with TanStack or Vercel; "AI SDK" and provider names are used only to say what this package works with.
