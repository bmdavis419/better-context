# btca

<a href="https://www.npmjs.com/package/btca"><img alt="npm" src="https://img.shields.io/npm/v/btca?style=flat-square" /></a>

https://btca.dev

Ask your AI agent questions about libraries and frameworks by searching the actual source code, not outdated docs.

## Install

```bash
bun add -g btca opencode-ai
btca config model --provider opencode --model claude-haiku-4-5
```

## Usage

```bash
# Ask a question
btca ask --resource svelte --question "How does the $state rune work?"

# Launch the TUI
btca
```

## Project Setup

Paste this into your AI coding agent to set up btca for your project:

```
Set up btca for this project: scan package.json for major dependencies (frameworks, libraries, tools), suggest adding each as a btca resource with sensible defaults, then create a btca.config.jsonc file in the project root and update AGENTS.md with usage instructions. Ask me to confirm each resource before adding.
```

See the full [Getting Started guide](https://btca.dev/getting-started) for more details.
