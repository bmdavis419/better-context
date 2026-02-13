# @btca/cli

CLI tool for asking questions about technologies using the btca server.

## Installation

### From npm (Recommended)

```bash
bun add -g @btca/cli
```

### From source

```bash
git clone https://github.com/davis7dotsh/better-context.git
cd better-context
bun install
bun run --filter=@btca/cli build
```

## Usage

### Interactive TUI (Default)

Launch the interactive terminal UI:

```bash
btca
```

Use `@mentions` to reference resources:

- Type `@svelte How do I create a store?` to ask about Svelte
- Use multiple mentions: `@react @typescript How do I type props?`

### One-shot Question

Ask a single question and exit:

```bash
btca ask --resource svelte --question "How do I create a reactive store?"
```

Options:

- `-r, --resource <name...>` - Resource names or HTTPS Git URLs (can specify multiple)
- `-q, --question <text>` - Question to ask (required)
- `--no-thinking` - Hide reasoning output
- `--no-tools` - Hide tool-call traces
- `--sub-agent` - Emit clean output (no reasoning or tool traces)

Examples:

```bash
# Single resource
btca ask --resource svelte --question "How do signals work?"

# One-shot GitHub repository (anonymous)
btca ask --resource https://github.com/sveltejs/svelte.dev -q "How do I setup a new sveltekit project?"

# Multiple resources
btca ask --resource react --resource typescript --question "How do I type useState?"

# Using @mentions in question
btca ask --question "@svelte @tailwind How do I style components?"
```

Notes:

- `-r` accepts configured resource names and HTTPS Git URLs.
- URL resources are not added to config and are cached on disk for reuse on later asks.

### Start Server

Start the btca server and keep it running to handle HTTP requests:

```bash
# Start on default port (8080)
btca serve

# Start on custom port
btca serve --port 3000
```

The server will run until you press `Ctrl+C` to stop it.

## Configuration

btca uses a config file at `~/.config/btca/btca.config.jsonc`. Manage configuration via CLI commands.

### Set Model

```bash
btca connect --provider opencode --model claude-haiku-4-5
```

#### OpenAI-compatible providers

To use an OpenAI-compatible server (e.g., LM Studio), run:

```bash
btca connect --provider openai-compat
```

You will be prompted for:

- Base URL: the root URL of your OpenAI-compatible server.
- Provider name: the AI SDK provider identifier.
- Model ID: the model to use for requests (stored as `model` in `btca.config.jsonc`).
- API key (optional): only if your server requires authentication.

### List Resources

```bash
btca resources
```

### Add Resource

```bash
# Add a git repository
btca add --name effect --type git --url https://github.com/Effect-TS/effect --branch main

# Add with search path (focus on specific subdirectory)
btca add --name svelte --type git --url https://github.com/sveltejs/svelte.dev --branch main --search-path apps/svelte.dev

# Add a local directory
btca add --name myproject --type local --path /path/to/project
```

### Remove Resource

```bash
btca remove effect
```

### Clear Cached Resources

Clear all locally cloned git repositories:

```bash
btca clear
```

### Server Options

```bash
# Use an existing btca server
btca --server http://localhost:3000

# Specify port for auto-started server
btca --port 3001
```

## OpenCode MCP Plugin

Download the official OpenCode MCP config template and add your API key:

```bash
curl -fsSL https://btca.dev/opencode-mcp.json -o opencode.json
```

Then replace `YOUR_API_KEY` with your MCP API key from the web dashboard.

## TUI Commands

In the interactive TUI, use `/` to access commands:

- `/connect` - Configure provider and model
- `/add` - Add a new resource
- `/clear` - Clear chat history
- `/resume` - Resume a previous thread
- `/new` - Alias for `/clear`

## Keyboard Shortcuts

- `Enter` - Send message
- `Escape` - Cancel streaming response (press twice to confirm)
- `Ctrl+C` - Clear input or quit
- `Ctrl+Q` - Quit
- `Tab` - Autocomplete commands/mentions
- `Up/Down` - Navigate palettes

## Requirements

- [Bun](https://bun.sh) >= 1.1.0
- A running btca server (auto-started by default)

## License

MIT
