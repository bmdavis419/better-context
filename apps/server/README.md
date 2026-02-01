# btca-server

BTCA (Better Context AI) server for answering questions about your codebase using OpenCode AI.

## Installation

```bash
bun add btca-server
```

## Usage

### Starting the Server

```typescript
import { startServer } from 'btca-server';

// Start with default options (port 8080 or process.env.PORT)
const server = await startServer();
console.log(`Server running at ${server.url}`);

// Start with custom port
const server = await startServer({ port: 3000 });

// Start with quiet mode (no logging)
const server = await startServer({ port: 3000, quiet: true });

// Stop the server when needed
server.stop();
```

### Server Instance

The `startServer` function returns a `ServerInstance` object:

```typescript
interface ServerInstance {
	port: number; // Actual port the server is running on
	url: string; // Full URL (e.g., "http://localhost:8080")
	stop: () => void; // Function to stop the server
}
```

### Random Port Assignment

You can pass `port: 0` to let the OS assign a random available port:

```typescript
const server = await startServer({ port: 0 });
console.log(`Server running on port ${server.port}`);
```

## API Endpoints

Once the server is running, it exposes the following REST API endpoints:

### Health Check

```
GET /
```

Returns service status and version info.

### Configuration

```
GET /config
```

Returns current configuration (provider, model, resources).

### Resources

```
GET /resources
```

Lists all configured resources (local directories or git repositories).

```
POST /config/resources
```

Add a new resource (git or local).

```
DELETE /config/resources
```

Remove a resource by name.

```
POST /clear
```

Clear all locally cloned resources.

### Questions

```
POST /question
```

Ask a question (non-streaming response).

```
POST /question/stream
```

Ask a question with streaming SSE response.

### OpenCode Instance

```
POST /opencode
```

Get an OpenCode instance URL for a collection of resources.

### Model Configuration

```
PUT /config/model
```

Update the AI provider and model configuration.

## Configuration

The server reads configuration from `~/.btca/config.toml` or your local project's `.btca/config.toml`. You'll need to configure:

- **AI Provider**: OpenCode AI provider (e.g., "opencode", "anthropic")
- **Model**: AI model to use (e.g., "claude-3-7-sonnet-20250219")
- **Resources**: Local directories or git repositories to query

Example config.toml:

```toml
provider = "anthropic"
model = "claude-3-7-sonnet-20250219"
resourcesDirectory = "~/.btca/resources"

[[resources]]
type = "local"
name = "my-project"
path = "/path/to/my/project"

[[resources]]
type = "git"
name = "some-repo"
url = "https://github.com/user/repo"
branch = "main"
```

## Supported Providers

BTCA supports the following providers only:

- `opencode` — API key required
- `openrouter` — API key required
- `openai` — OAuth only
- `google` — API key or OAuth
- `anthropic` — API key required

Authenticate providers via OpenCode:

```bash
opencode auth --provider <provider>
```

## Authentication Notes

- OpenCode and OpenRouter can use environment variables or OpenCode auth.
- OpenAI requires OAuth (API keys are not supported).
- Anthropic requires an API key.
- Google supports API key or OAuth.

## Environment Variables

- `PORT`: Server port (default: 8080)
- `OPENCODE_API_KEY`: OpenCode API key (required when provider is `opencode`)
- `OPENROUTER_API_KEY`: OpenRouter API key (required when provider is `openrouter`)
- `OPENROUTER_BASE_URL`: Override OpenRouter base URL (optional)
- `OPENROUTER_HTTP_REFERER`: Optional OpenRouter header for rankings
- `OPENROUTER_X_TITLE`: Optional OpenRouter header for rankings

## TypeScript Types

The package exports TypeScript types for use with Hono RPC client:

```typescript
import type { AppType } from 'btca-server';
import { hc } from 'hono/client';

const client = hc<AppType>('http://localhost:8080');
```

## Stream Types

For working with SSE streaming responses:

```typescript
import type { BtcaStreamEvent, BtcaStreamMetaEvent } from 'btca-server/stream/types';
```

## Requirements

- **Bun**: >= 1.1.0 (this package is designed specifically for Bun runtime)
- **OpenCode API Key**: Required when using the `opencode` provider

## License

MIT

## Repository

[https://github.com/bmdavis419/better-context](https://github.com/bmdavis419/better-context)
