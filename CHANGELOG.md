# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-06-29


### Features

- Added three zero-config, no-API-key AI providers — Codex, Gemini, and OpenCode — each using the tool's own CLI sign-in, alongside the existing `claude` CLI backend.
- Added a configurable fallback provider (`--fallback-provider`, `--fallback-endpoint`, `--fallback-model`) that's tried when the primary provider errors out.
- Empty release notes are now treated as suspect: when the AI returns `_No user-facing changes._` for a range that actually had commits, gitgist falls back to the deterministic Conventional-Commit changelog instead of trusting it silently.

### Bug Fixes

- Fixed the `claude` CLI provider passing gitgist's instructions as user input, which caused it to echo `_No user-facing changes._` instead of generating notes; the system prompt now rides the CLI's own system layer.
- A fallback provider no longer inherits a `--model`/`--endpoint` that doesn't apply to it — those are only carried over when the fallback targets the same provider as the primary.

### Documentation

- The README now advertises the fallback/resilience behavior and includes a `--template` demo showing commits shaped to a fixed house-style layout.

## [1.0.0] - 2026-06-19


### Bug Fixes
- Fixed the `apple` provider rejecting commit ranges given as full SHAs (e.g. `<sha>^ <sha>`); the on-device language guardrail no longer trips on SHA-heavy prompts.

### Changes
- The `apple` provider now uses the published `apple-fm` package, which ships its own signed and notarized Foundation Models binary ??? the provider works out of the box with no Swift toolchain or bundled helper.

## [Unreleased]

### Added

- `--language <name|auto>`: a language hint for the `apple` provider. Apple's on-device model runs a language-identification guardrail that can reject prompts dominated by non-prose tokens (e.g. a full-SHA range like `<sha>^..<sha>`) with `unsupportedLanguageOrLocale`. gitgist now prefixes the prompt with a short `Treat the following as <language>:` lead-in, defaulting to the detected system language. Pass a language name/code to override (e.g. `--language French`), or `--language auto` to omit the hint entirely.

### Changed

- The on-device `apple` provider now uses the [`apple-fm`](https://www.npmjs.com/package/apple-fm) package instead of a vendored Swift helper. gitgist no longer builds, signs, or bundles its own Foundation Models helper — `apple-fm` ships a Developer-ID-signed, notarized binary, so the provider still works out of the box with no toolchain. Point at a custom helper build with `APPLE_FM_BIN` (the previous `GITGIST_APPLE_FM_BIN` is gone).

## [0.1.0] - 2026-06-18


### Features

- New `npm run compare` tool runs the same changes through every available AI backend (Claude, local OpenAI-compatible, Apple Foundation Models, and the deterministic `--no-ai` grouping) and prints the results side by side, so you can compare how each provider summarizes the same history.

### Documentation

- Added a "Choosing a provider" guide to the README, with a quality/cost/privacy comparison table and a "pick by what you care about most" summary to help you choose between providers.
- Refreshed the README's "See it" section with an animated demo for drafting commit messages from staged changes (`gitgist --staged --commit-message`), so the demos now flow as a progression: AI release notes, commit messages, then offline grouping.
- Better-organized release notes: each change now appears in exactly one section, with breaking changes always grouped on their own.
