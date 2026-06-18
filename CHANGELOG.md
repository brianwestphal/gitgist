# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-18


### Features

- New `npm run compare` tool runs the same changes through every available AI backend (Claude, local OpenAI-compatible, Apple Foundation Models, and the deterministic `--no-ai` grouping) and prints the results side by side, so you can compare how each provider summarizes the same history.

### Documentation

- Added a "Choosing a provider" guide to the README, with a quality/cost/privacy comparison table and a "pick by what you care about most" summary to help you choose between providers.
- Refreshed the README's "See it" section with an animated demo for drafting commit messages from staged changes (`gitgist --staged --commit-message`), so the demos now flow as a progression: AI release notes, commit messages, then offline grouping.
- Better-organized release notes: each change now appears in exactly one section, with breaking changes always grouped on their own.
