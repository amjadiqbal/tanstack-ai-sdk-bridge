<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="art/banner-dark.png">
    <img alt="AI SDK Bridge: any Vercel AI SDK provider as a TanStack AI adapter" src="art/banner-light.png" width="100%">
  </picture>
</p>

# TanStack AI SDK Bridge: use Vercel AI SDK providers with TanStack AI

Use any Vercel AI SDK provider (`@ai-sdk/*` and community providers) as a [TanStack AI](https://tanstack.com/ai) adapter. DeepSeek, Cerebras, Together AI, Fireworks, DeepInfra, Deepgram, AssemblyAI, Voyage, Replicate, Luma and every other AI SDK provider work with `chat()`, `embed()`, `generateTranscription()`, `generateSpeech()`, `generateImage()` and `rerank()`, without a dedicated TanStack adapter. It is also the shortest path for moving an AI SDK app to TanStack AI: keep your provider setup and change the rest step by step.

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
})
```

- **Text**: streaming chat, tool calls (TanStack's agent loop runs your tools), reasoning, structured output (`outputSchema`), token usage, abort.
- **Embeddings, transcription, speech, image generation, rerank**: one adapter function each.
- **AI SDK 5, 6 and 7 providers**: provider spec v2, v3 and v4 are all read.
- **No extra runtime code from AI SDK**: only the provider package you already use, plus `@ai-sdk/provider` types. No `ai` package needed.

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

chat({ adapter: aiSdkText(deepseek('deepseek-chat')), messages, tools: [getWeather] })
```

### Structured output

```ts
const product = await chat({
  adapter: aiSdkText(deepseek('deepseek-chat')),
  messages: [{ role: 'user', content: 'Invent a product.' }],
  outputSchema: z.object({ name: z.string(), price: z.number() }),
  stream: false,
})
// product: { name: string; price: number }
```

The bridge asks the model for JSON with the schema (AI SDK `responseFormat: { type: 'json', schema }`) and TanStack AI validates the result. A JSON answer wrapped in a Markdown code fence is also accepted.

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

Large inputs are split by the model's `maxEmbeddingsPerCall`. `dimensions` works with AI SDK 7 models; older ones take it through `modelOptions.providerOptions`.

### Transcription, speech, image, rerank

```ts
import { generateImage, generateSpeech, generateTranscription, rerank } from '@tanstack/ai'
import { aiSdkImage, aiSdkRerank, aiSdkSpeech, aiSdkTranscription } from '@amjadiqbal/tanstack-ai-sdk-bridge'

await generateTranscription({ adapter: aiSdkTranscription(deepgram.transcription('nova-3')), audio: file })
await generateSpeech({ adapter: aiSdkSpeech(openai.speech('gpt-4o-mini-tts')), text: 'Hello', voice: 'alloy' })
await generateImage({ adapter: aiSdkImage(replicate.image('black-forest-labs/flux-schnell')), prompt: 'a lighthouse at dusk' })
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

Every function takes an optional second argument `{ name }`, the adapter name TanStack AI shows in devtools and usage. It defaults to the provider id before the first dot (`deepseek.chat` becomes `deepseek`).

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

- Unit tests (Vitest) run every adapter against AI SDK's own `MockLanguageModelV3/V4`, `MockEmbeddingModelV4`, `MockTranscriptionModelV4`, `MockSpeechModelV4`, `MockImageModelV4` and `MockRerankingModelV4` from `ai/test`, plus hand-written spec-v2 models, through the real `chat()`, `embed()`, `generateTranscription()`, `generateSpeech()`, `generateImage()` and `rerank()` of `@tanstack/ai` 1.0.0.
- Integration tests run real provider packages over HTTP against [aimock](https://github.com/CopilotKit/aimock), a local server that speaks the providers' wire formats: TESTED-PROVIDERS.
- A TanStack Start app with `@tanstack/ai-react` `useChat` was used in a real browser with the packed tarball: BROWSER-TEST.
- **Not tested against live provider APIs** (no API keys were used). Wire-level mocks cover the request and stream formats, not every model's behaviour.

## Limits

- **Provider-executed tools** (an AI SDK provider's own web search, code execution and the like) are not forwarded; function tools are.
- **Reasoning signatures** are not sent back, so providers that need signed thinking blocks in later turns (Anthropic extended thinking with tools) receive the reasoning as plain text or drop it.
- `chat({ wrapFetch })` is not applied; pass a custom `fetch` to the provider factory (`createDeepSeek({ fetch })`).
- Provider file handles (`{ type: 'file' }` sources) are rejected; send images and documents as data or URLs.
- Transcription `language` and `prompt` have no AI SDK equivalent; pass them in `modelOptions.providerOptions`.
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
