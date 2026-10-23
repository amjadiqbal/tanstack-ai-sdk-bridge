# Changelog

All notable changes to `@amjadiqbal/tanstack-ai-sdk-bridge` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-10-23

### Changed

- Positioned as a migration stepping stone, following TanStack AI maintainers' feedback ([TanStack/ai#1884](https://github.com/TanStack/ai/pull/1884)): the README now starts with TanStack AI's migration guide, a table of the native adapter for each tested provider, a third-party notice, and the list of what the bridge loses versus a native adapter.
- **Peer range narrowed to `@tanstack/ai >=1.0.0 <1.1.0`** (the versions tested), because the bridge imports `@tanstack/ai/adapter-internals`, which has no stability promise. Newer TanStack AI versions are flagged at install time until a tested release widens the range.
- `aiSdkSpeech`: Ogg audio is reported as `opus` only when the stream is Opus, otherwise as `ogg`; an `audio/ogg` header maps to `ogg`, and the content type for `opus` and `ogg` is `audio/ogg`.

### Documentation

- The `application/octet-stream` fallback for speech `contentType` is documented.

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
