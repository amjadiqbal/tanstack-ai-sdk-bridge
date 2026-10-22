# Changelog

All notable changes to `@amjadiqbal/tanstack-ai-sdk-bridge` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-10-23

### Fixed

- `aiSdkSpeech`: the result's `format` and `contentType` now come from what the provider returned (its `content-type` header, else the audio bytes), then the requested format, else `unknown`. Before, it reported `mp3` whenever no format was requested.

### Added

- `aiSdkImage`: `modelOptions.mask` is sent to AI SDK v3/v4 image models (it was never sent before).

### Documentation

- README states exactly which activities can be aborted (not `embed()`), what `outputSchema` does in the bridge (one non-streaming call without tools, JSON parsing, error cases; `chat()` validates), how `dimensions` behaves on v2/v3 embedding models, which transcription options are not sent, how speech reports its format, the image options and defaults, why `@ai-sdk/provider` is a dependency, and the `@tanstack/ai/adapter-internals` import.
- Removed the untested `deepgram` keyword.

## [0.1.0] - 2026-10-23

### Added

- `aiSdkText()`: AI SDK language models as TanStack AI text adapters, with streaming text, tool calls, reasoning, structured output, token usage and abort.
- `aiSdkEmbedding()`, `aiSdkTranscription()`, `aiSdkSpeech()`, `aiSdkImage()` and `aiSdkRerank()` for the other AI SDK model kinds.
- Support for AI SDK provider spec v2, v3 and v4 (AI SDK 5, 6 and 7 providers).
