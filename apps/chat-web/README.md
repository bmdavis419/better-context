# btca Chat Web

Web-based chat interface for btca, using Daytona sandboxes for compute.

## Overview

This SvelteKit application provides a web-based chat interface for btca (the Better Context App). Each chat session runs in its own Daytona sandbox, providing isolated compute environments for btca queries.

## Features

- **Chat Interface**: Similar to the TUI in `apps/cli/src/tui/`
- **Daytona Sandboxes**: Each session gets its own sandbox created on-the-fly
- **Session Management**: Create, reuse, switch between, and destroy sessions
- **Streaming Responses**: Real-time streaming of btca responses
- **Markdown Rendering**: Rich text display for AI responses
- **Resource Mentions**: Use @mentions to specify which codebases to query (e.g., @svelte, @tailwind)
- **Dark/Light Theme**: Toggle between themes
- **Mobile Responsive**: Works on desktop and mobile devices

## Prerequisites

1. **Daytona Account**: Sign up at [daytona.io](https://app.daytona.io)
2. **Daytona API Key**: Get your API key from the Daytona dashboard
3. **OpenCode API Key**: Required for btca's AI provider
4. **btca Snapshot**: The `btca-sandbox` snapshot must exist in Daytona (created using `apps/sandbox/src/snapshot.ts`)

## Setup

1. **Install dependencies**:

   ```bash
   bun install
   ```

2. **Configure environment variables**:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your API keys:

   ```
   DAYTONA_API_KEY=your_daytona_api_key
   OPENCODE_API_KEY=your_opencode_api_key
   ```

3. **Create the btca snapshot** (if not already created):
   ```bash
   bun run sandbox:snapshot
   ```

## Development

```bash
bun dev
```

The app will start at `http://localhost:5173`.

## Production Build

```bash
bun run build
bun start
```

## Usage

1. **Create a Session**: Click the "+" button to create a new session. This will spin up a Daytona sandbox with btca installed.

2. **Select Resources**: Use @mentions to specify which documentation/codebases to query:
   - `@svelte` - Svelte documentation
   - `@svelteKit` - SvelteKit documentation
   - `@tailwind` - Tailwind CSS documentation

3. **Ask Questions**: Type your question after the @mention:

   ```
   @svelte How do I create a reactive variable?
   ```

4. **Switch Sessions**: Click on different sessions in the sidebar to switch between conversations.

5. **Destroy Sessions**: Click the trash icon to destroy a session and its sandbox.

## Architecture

```
apps/chat-web/
├── src/
│   ├── lib/
│   │   ├── components/      # Reusable Svelte components
│   │   ├── server/          # Server-side code (session management)
│   │   ├── stores/          # Svelte stores (theme, etc.)
│   │   ├── types/           # TypeScript types
│   │   └── utils/           # Utility functions
│   └── routes/
│       ├── api/
│       │   └── sessions/    # Session API endpoints
│       ├── +layout.svelte   # Root layout
│       └── +page.svelte     # Main chat page
├── static/                   # Static assets
├── .env.example             # Environment variable template
├── package.json
├── svelte.config.js
├── tsconfig.json
└── vite.config.ts
```

### Session Lifecycle

1. **Create**: User clicks "New Session" → Daytona sandbox created → btca server started
2. **Chat**: Messages sent to btca server in sandbox → Streaming responses returned
3. **Resume**: Sessions persist in memory → Can switch between active sessions
4. **Destroy**: User clicks "Destroy" → Sandbox deleted → Session marked as destroyed

### API Endpoints

- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create a new session
- `GET /api/sessions/:id` - Get session details
- `DELETE /api/sessions/:id` - Destroy a session
- `POST /api/sessions/:id` - Perform actions (clear chat)
- `POST /api/sessions/:id/chat` - Send a message (streaming)
- `GET /api/sessions/:id/resources` - Get available resources

## Configuration

### Default Resources

The default btca configuration includes:

- **svelte**: Svelte 5 documentation
- **svelteKit**: SvelteKit documentation
- **tailwind**: Tailwind CSS documentation

These can be customized by modifying `DEFAULT_BTCA_CONFIG` in `src/lib/server/session-manager.ts`.

### Model Configuration

By default, the app uses:

- **Provider**: opencode
- **Model**: claude-haiku-4-5

## Limitations

- **In-Memory Storage**: Sessions are stored in memory (lost on server restart)
- **No Authentication**: Single-user experience (like the CLI)
- **Sandbox Costs**: Each session creates a Daytona sandbox (check your Daytona usage)

## Contributing

This is part of the btca monorepo. See the main README for contribution guidelines.

## License

MIT
