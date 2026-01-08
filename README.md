# Better Context (`btca`)

<a href="https://www.npmjs.com/package/btca"><img alt="npm" src="https://img.shields.io/npm/v/btca?style=flat-square" /></a>

https://btca.dev

`btca` is a CLI for asking questions about libraries/frameworks by cloning their repos locally and searching the source directly.

Dev docs are in the `apps/cli` directory.

## Install

```bash
bun add -g btca
btca --help
```

## Quick commands

Ask a question:

```bash
btca ask -t svelte -q "How do stores work in Svelte 5?"
```

Open the TUI:

```bash
btca chat -t svelte
```

Run as a server:

```bash
btca serve -p 8080
```

Then POST `/question` with:

```json
{ "tech": "svelte", "question": "how does the query remote function work in sveltekit?" }
```

Keep an OpenCode instance running:

```bash
btca open
```

## Config

On first run, `btca` creates a default config at `~/.config/btca/btca.json`. That's where the repo list + model/provider live.

### Adding resources

Default resources: svelte, effect, nextjs. Add more:

```bash
# Git repo
btca config resources add -n react -u https://github.com/facebook/react -b main

# With search path (limits where agent searches)
btca config resources add -n nextjs-docs -u https://github.com/vercel/next.js -b canary --search-path docs

# Local directory
btca config resources add -n myproject --type local --path ~/code/myproject
```

List/remove:
```bash
btca config resources list
btca config resources remove -n react
```

## stuff I want to add

- get the git repo for a package using bun:

```bash
 bun pm view react repository.url
```

- tui for working with btca (config, starting chat, server, etc.)
- mcp server
- multiple repos for a single btca instance
- fetch all the branches to pick from when you add a repo in the tui
- cleaner streamed output in the ask command
