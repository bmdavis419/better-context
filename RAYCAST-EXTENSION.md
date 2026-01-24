# RayCast Extension Implementation Plan

This document provides a detailed implementation plan for creating a RayCast extension for Better Context (btca). The extension allows users to ask questions with `@resource` tagging directly from RayCast.

Use btca as much as you need to, you can see what resources you have in btca.config.jsonc.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Part 1: Convex HTTP Endpoints](#part-1-convex-http-endpoints)
5. [Part 2: RayCast Extension Setup](#part-2-raycast-extension-setup)
6. [Part 3: RayCast Extension Implementation](#part-3-raycast-extension-implementation)
7. [Testing](#testing)
8. [Error Handling Reference](#error-handling-reference)

---

## Overview

### What We're Building

A RayCast extension with a single command that:

1. Opens a text input where users type questions with `@resource` syntax
2. Streams the AI response in real-time
3. Displays the final answer as markdown

### Key Design Decisions

| Decision           | Choice                     | Rationale                                                 |
| ------------------ | -------------------------- | --------------------------------------------------------- |
| Authentication     | API Key                    | Simpler than OAuth, user manages key                      |
| Thread Management  | None (ephemeral)           | Keep it simple, one-off questions                         |
| Resource Caching   | None                       | Fetch on open, fast enough                                |
| Data Fetching      | HTTP endpoints             | Convex stays in apps/web, no WebSocket support in RayCast |
| Resource Selection | `@resource` syntax in text | MVP approach, no dynamic dropdown                         |

### Convex URL

```
https://greedy-partridge-784.convex.site
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     RayCast Extension                        │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ Preferences │───►│  Form View   │───►│  Detail View  │  │
│  │ (API Key)   │    │ (Question)   │    │ (Response)    │  │
│  └─────────────┘    └──────────────┘    └───────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP + API Key Auth
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Convex HTTP Endpoints                      │
│  ┌──────────────────────┐    ┌────────────────────────────┐ │
│  │ GET /raycast/resources│    │ POST /raycast/ask (SSE)   │ │
│  └──────────────────────┘    └────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     btca Sandbox (Daytona)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- Node.js 18+
- Bun (for package management)
- RayCast installed on macOS
- Access to the Better Context Convex deployment

---

## Part 1: Convex HTTP Endpoints

These endpoints live in `apps/web/src/convex/http.ts`.

### 1.1 API Key Authentication Helper

Create a helper to validate API keys and return the associated instance.

**File: `apps/web/src/convex/raycastAuth.ts`**

```typescript
import { ActionCtx } from './_generated/server';
import { api } from './_generated/api';
import type { Doc } from './_generated/dataModel';

export type RaycastAuthResult = {
	instance: Doc<'instances'>;
	apiKey: Doc<'apiKeys'>;
};

export type RaycastAuthError = {
	status: number;
	message: string;
};

export async function authenticateRaycastRequest(
	ctx: ActionCtx,
	request: Request
): Promise<RaycastAuthResult | RaycastAuthError> {
	const authHeader = request.headers.get('Authorization');

	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return { status: 401, message: 'Missing or invalid Authorization header' };
	}

	const apiKeyValue = authHeader.slice(7); // Remove 'Bearer '

	if (!apiKeyValue) {
		return { status: 401, message: 'API key is required' };
	}

	// Look up the API key
	const apiKey = await ctx.runQuery(api.apiKeys.getByKey, { key: apiKeyValue });

	if (!apiKey) {
		return { status: 401, message: 'Invalid API key' };
	}

	// Check if key is active
	if (apiKey.status !== 'active') {
		return { status: 401, message: 'API key is inactive' };
	}

	// Get the associated instance
	const instance = await ctx.runQuery(api.instances.queries.get, {
		id: apiKey.instanceId
	});

	if (!instance) {
		return { status: 404, message: 'Instance not found' };
	}

	return { instance, apiKey };
}

export function isAuthError(
	result: RaycastAuthResult | RaycastAuthError
): result is RaycastAuthError {
	return 'status' in result && 'message' in result;
}
```

### 1.2 GET /raycast/resources Endpoint

Returns all available resources for the authenticated user.

**Add to `apps/web/src/convex/http.ts`:**

```typescript
import { authenticateRaycastRequest, isAuthError } from './raycastAuth';

const raycastResources = httpAction(async (ctx, request) => {
	// Authenticate
	const authResult = await authenticateRaycastRequest(ctx, request);

	if (isAuthError(authResult)) {
		return new Response(JSON.stringify({ error: authResult.message }), {
			status: authResult.status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const { instance } = authResult;

	// Fetch resources
	const resources = await ctx.runQuery(api.resources.listAvailable, {
		instanceId: instance._id
	});

	// Flatten and format for RayCast
	const allResources = [
		...resources.global.map((r) => ({
			name: r.name,
			displayName: r.displayName,
			isGlobal: true
		})),
		...resources.custom.map((r) => ({
			name: r.name,
			displayName: r.displayName,
			isGlobal: false
		}))
	];

	return new Response(JSON.stringify({ resources: allResources }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
});

// Register the route
http.route({
	path: '/raycast/resources',
	method: 'GET',
	handler: raycastResources
});
```

### 1.3 POST /raycast/ask Endpoint (SSE Streaming)

Handles questions with `@resource` syntax, streams responses.

**Add to `apps/web/src/convex/http.ts`:**

```typescript
import { z } from 'zod';

const raycastAskRequestSchema = z.object({
	question: z.string().min(1)
});

// Helper to extract @resource mentions from question
function extractResources(question: string): { cleanQuestion: string; resources: string[] } {
	const resourcePattern = /@(\w+)/g;
	const resources: string[] = [];
	let match;

	while ((match = resourcePattern.exec(question)) !== null) {
		resources.push(match[1]);
	}

	// Remove @mentions from question for cleaner display (optional)
	const cleanQuestion = question; // Keep original, resources are contextual

	return { cleanQuestion, resources: [...new Set(resources)] };
}

const raycastAsk = httpAction(async (ctx, request) => {
	// Authenticate
	const authResult = await authenticateRaycastRequest(ctx, request);

	if (isAuthError(authResult)) {
		return new Response(JSON.stringify({ error: authResult.message }), {
			status: authResult.status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const { instance } = authResult;

	// Parse request body
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid request body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const parseResult = raycastAskRequestSchema.safeParse(rawBody);
	if (!parseResult.success) {
		return new Response(JSON.stringify({ error: 'Invalid request: question is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const { question } = parseResult.data;
	const { resources } = extractResources(question);

	// Check usage/subscription
	const usageCheck = await ctx.runAction(api.usage.ensureUsageAvailable, {
		instanceId: instance._id,
		question,
		resources
	});

	if (!usageCheck?.ok) {
		const reason = (usageCheck as { reason?: string }).reason;
		if (reason === 'subscription_required') {
			return new Response(
				JSON.stringify({
					error: 'Subscription required',
					upgradeUrl: 'https://btca.dev/pricing'
				}),
				{ status: 402, headers: { 'Content-Type': 'application/json' } }
			);
		}
		if (reason === 'free_limit_reached') {
			return new Response(
				JSON.stringify({
					error: 'Free message limit reached. Upgrade to continue.',
					upgradeUrl: 'https://btca.dev/pricing'
				}),
				{ status: 402, headers: { 'Content-Type': 'application/json' } }
			);
		}
		return new Response(JSON.stringify({ error: 'Usage limit reached' }), {
			status: 402,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Ensure instance is running
	if (instance.state !== 'running' || !instance.serverUrl) {
		if (!instance.sandboxId) {
			return new Response(
				JSON.stringify({ error: 'Instance not provisioned. Please visit btca.dev to set up.' }),
				{ status: 503, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Wake the instance
		try {
			const wakeResult = await ctx.runAction(api.instances.actions.wake, {
				instanceId: instance._id
			});
			if (!wakeResult.serverUrl) {
				throw new Error('No server URL returned');
			}
			// Update instance reference
			instance.serverUrl = wakeResult.serverUrl;
			instance.state = 'running';
		} catch (error) {
			return new Response(JSON.stringify({ error: 'Failed to start instance. Try again.' }), {
				status: 503,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	// Create SSE stream
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			const sendEvent = (data: unknown) => {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
			};

			try {
				// Call btca server
				const response = await fetch(`${instance.serverUrl}/question/stream`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						question,
						resources,
						quiet: true
					})
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(errorText || `Server error: ${response.status}`);
				}

				if (!response.body) {
					throw new Error('No response body');
				}

				// Stream through the response
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() ?? '';

					let eventData = '';
					for (const line of lines) {
						if (line.startsWith('data: ')) {
							eventData = line.slice(6);
						} else if (line === '' && eventData) {
							try {
								const event = JSON.parse(eventData);

								// Forward relevant events to RayCast
								if (event.type === 'text.delta') {
									sendEvent({ type: 'text', delta: event.delta });
								} else if (event.type === 'done') {
									sendEvent({ type: 'done', text: event.text });
								} else if (event.type === 'error') {
									sendEvent({ type: 'error', message: event.message });
								}
								// Skip meta, reasoning, tool events for simplicity
							} catch {
								// Ignore parse errors
							}
							eventData = '';
						}
					}
				}

				reader.releaseLock();

				// Finalize usage
				await ctx.runAction(api.usage.finalizeUsage, {
					instanceId: instance._id,
					questionTokens: 0, // Simplified for RayCast
					outputChars: 0,
					reasoningChars: 0,
					resources,
					sandboxUsageHours: 0
				});

				controller.close();
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				sendEvent({ type: 'error', message });
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
});

// Register routes
http.route({
	path: '/raycast/ask',
	method: 'POST',
	handler: raycastAsk
});

http.route({
	path: '/raycast/ask',
	method: 'OPTIONS',
	handler: corsPreflight
});

http.route({
	path: '/raycast/resources',
	method: 'OPTIONS',
	handler: corsPreflight
});
```

---

## Part 2: RayCast Extension Setup

### 2.1 Create the Extension

Use the official RayCast CLI to scaffold the project:

```bash
# Navigate to apps directory
cd apps

# Create the extension using the official CLI
# Using 'submit-form' template as base since we need a form
npx create-raycast-extension -t submit-form -o raycast

# Navigate into the new extension
cd raycast
```

### 2.2 Update package.json

After scaffolding, update the `package.json` with the correct metadata:

```json
{
	"$schema": "https://www.raycast.com/schemas/extension.json",
	"name": "better-context",
	"title": "Better Context",
	"description": "Ask questions about documentation with AI-powered context",
	"icon": "icon.png",
	"author": "btca",
	"license": "MIT",
	"commands": [
		{
			"name": "ask",
			"title": "Ask Question",
			"description": "Ask a question with @resource tagging",
			"mode": "view"
		}
	],
	"preferences": [
		{
			"name": "apiKey",
			"type": "password",
			"required": true,
			"title": "API Key",
			"description": "Your Better Context API key. Get one at btca.dev/app/settings",
			"placeholder": "btca_..."
		}
	],
	"dependencies": {
		"@raycast/api": "^1.94.0",
		"@raycast/utils": "^1.19.1"
	},
	"devDependencies": {
		"@raycast/eslint-config": "^2.0.4",
		"@types/node": "22.13.10",
		"@types/react": "19.0.12",
		"eslint": "^9.22.0",
		"prettier": "^3.5.3",
		"typescript": "^5.8.2"
	},
	"scripts": {
		"build": "ray build",
		"dev": "ray develop",
		"fix-lint": "ray lint --fix",
		"lint": "ray lint",
		"prepublishOnly": "echo \"\\n\\nIt seems like you are trying to publish the Raycast extension to npm.\\n\\nIf you did intend to publish it to npm, remove the \\`prepublishOnly\\` script and rerun \\`npm publish\\` again.\\nIf you wanted to publish it to the Raycast Store instead, use \\`npm run publish\\` instead.\\n\\n\" && exit 1",
		"publish": "npx @raycast/api@latest publish"
	}
}
```

### 2.3 Install Dependencies with Bun

```bash
# Remove node_modules and lock file if they exist
rm -rf node_modules package-lock.json

# Install dependencies with Bun
bun install

# Add Zod 4 for response validation
bun add zod@^3.24.0
```

> Note: As of January 2025, Zod 4 is in beta. Using latest Zod 3.x which is stable. Update to Zod 4 when it's released.

### 2.4 Project Structure

After setup, ensure this structure:

```
apps/raycast/
├── assets/
│   └── icon.png              # Add your icon (512x512)
├── src/
│   ├── ask.tsx               # Main command (rename from index.tsx)
│   ├── api.ts                # HTTP client
│   ├── stream.ts             # SSE parser
│   └── types.ts              # Type definitions
├── package.json
├── tsconfig.json
├── eslint.config.mjs
└── bun.lockb
```

---

## Part 3: RayCast Extension Implementation

### 3.1 Types (`src/types.ts`)

```typescript
import { z } from 'zod';

// API Response types
export const ResourceSchema = z.object({
	name: z.string(),
	displayName: z.string(),
	isGlobal: z.boolean()
});

export const ResourcesResponseSchema = z.object({
	resources: z.array(ResourceSchema)
});

export type Resource = z.infer<typeof ResourceSchema>;
export type ResourcesResponse = z.infer<typeof ResourcesResponseSchema>;

// Stream event types
export const StreamEventSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('text'),
		delta: z.string()
	}),
	z.object({
		type: z.literal('done'),
		text: z.string()
	}),
	z.object({
		type: z.literal('error'),
		message: z.string()
	})
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;

// Error response
export const ErrorResponseSchema = z.object({
	error: z.string(),
	upgradeUrl: z.string().optional()
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
```

### 3.2 API Client (`src/api.ts`)

```typescript
import { getPreferenceValues } from '@raycast/api';
import { ResourcesResponseSchema, type ResourcesResponse } from './types';

const CONVEX_URL = 'https://greedy-partridge-784.convex.site';

interface Preferences {
	apiKey: string;
}

function getApiKey(): string {
	const preferences = getPreferenceValues<Preferences>();
	return preferences.apiKey;
}

function getHeaders(): HeadersInit {
	return {
		Authorization: `Bearer ${getApiKey()}`,
		'Content-Type': 'application/json'
	};
}

export async function fetchResources(): Promise<ResourcesResponse> {
	const response = await fetch(`${CONVEX_URL}/raycast/resources`, {
		method: 'GET',
		headers: getHeaders()
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new ApiError(
			response.status,
			error.error || 'Failed to fetch resources',
			error.upgradeUrl
		);
	}

	const data = await response.json();
	return ResourcesResponseSchema.parse(data);
}

export async function askQuestion(question: string): Promise<Response> {
	const response = await fetch(`${CONVEX_URL}/raycast/ask`, {
		method: 'POST',
		headers: getHeaders(),
		body: JSON.stringify({ question })
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new ApiError(response.status, error.error || 'Request failed', error.upgradeUrl);
	}

	return response;
}

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public upgradeUrl?: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}
```

### 3.3 SSE Stream Parser (`src/stream.ts`)

```typescript
import { StreamEventSchema, type StreamEvent } from './types';

export async function* parseSSEStream(response: Response): AsyncGenerator<StreamEvent> {
	if (!response.body) {
		throw new Error('Response body is null');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			let eventData = '';

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					eventData = line.slice(6);
				} else if (line === '' && eventData) {
					try {
						const parsed = JSON.parse(eventData);
						const validated = StreamEventSchema.parse(parsed);
						yield validated;
					} catch (error) {
						console.error('Failed to parse SSE event:', error);
					}
					eventData = '';
				}
			}
		}

		// Process remaining buffer
		if (buffer.trim()) {
			const lines = buffer.split('\n');
			let eventData = '';

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					eventData = line.slice(6);
				}
			}

			if (eventData) {
				try {
					const parsed = JSON.parse(eventData);
					const validated = StreamEventSchema.parse(parsed);
					yield validated;
				} catch {
					// Ignore incomplete final event
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
```

### 3.4 Main Command (`src/ask.tsx`)

```typescript
import {
  Action,
  ActionPanel,
  Detail,
  Form,
  getPreferenceValues,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation
} from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { useState } from 'react';
import { askQuestion, fetchResources, ApiError } from './api';
import { parseSSEStream } from './stream';
import type { Resource } from './types';

interface Preferences {
  apiKey: string;
}

export default function AskCommand() {
  const [question, setQuestion] = useState('');
  const { push } = useNavigation();

  // Fetch resources on mount (for future autocomplete hints)
  const { data: resourcesData, isLoading: isLoadingResources } = usePromise(
    async () => {
      try {
        return await fetchResources();
      } catch (error) {
        if (error instanceof ApiError) {
          handleApiError(error);
        }
        return null;
      }
    },
    []
  );

  const handleSubmit = async (values: { question: string }) => {
    if (!values.question.trim()) {
      showToast({
        style: Toast.Style.Failure,
        title: 'Question required',
        message: 'Please enter a question'
      });
      return;
    }

    push(<ResponseView question={values.question} />);
  };

  const resourceNames = resourcesData?.resources.map(r => r.name) ?? [];
  const resourceHint = resourceNames.length > 0
    ? `Available: ${resourceNames.slice(0, 5).map(n => `@${n}`).join(', ')}${resourceNames.length > 5 ? '...' : ''}`
    : '';

  return (
    <Form
      isLoading={isLoadingResources}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Ask Question" onSubmit={handleSubmit} />
          <Action
            title="Open Extension Preferences"
            onAction={openExtensionPreferences}
            shortcut={{ modifiers: ['cmd'], key: ',' }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="question"
        title="Question"
        placeholder="How do I implement streaming in @svelte?"
        info={`Use @resource to include context. ${resourceHint}`}
        value={question}
        onChange={setQuestion}
        enableMarkdown={false}
      />
      <Form.Description
        title="Tip"
        text="Tag resources with @ syntax: @svelte, @svelteKit, @tailwind, etc."
      />
    </Form>
  );
}

function ResponseView({ question }: { question: string }) {
  const [markdown, setMarkdown] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  const { isLoading, error } = usePromise(
    async () => {
      try {
        const response = await askQuestion(question);

        for await (const event of parseSSEStream(response)) {
          if (event.type === 'text') {
            setMarkdown(prev => prev + event.delta);
          } else if (event.type === 'done') {
            setMarkdown(event.text);
            setIsComplete(true);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      } catch (error) {
        if (error instanceof ApiError) {
          handleApiError(error);
        }
        throw error;
      }
    },
    []
  );

  const displayMarkdown = markdown || (isLoading ? '*Thinking...*' : '');

  return (
    <Detail
      isLoading={isLoading && !markdown}
      markdown={displayMarkdown}
      metadata={
        isComplete ? (
          <Detail.Metadata>
            <Detail.Metadata.Label title="Status" text="Complete" />
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel>
          <Action.CopyToClipboard
            title="Copy Response"
            content={markdown}
            shortcut={{ modifiers: ['cmd'], key: 'c' }}
          />
          <Action.Paste
            title="Paste Response"
            content={markdown}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'v' }}
          />
        </ActionPanel>
      }
    />
  );
}

function handleApiError(error: ApiError) {
  if (error.status === 401) {
    showToast({
      style: Toast.Style.Failure,
      title: 'Invalid API Key',
      message: 'Check your API key in extension preferences',
      primaryAction: {
        title: 'Open Preferences',
        onAction: () => openExtensionPreferences()
      }
    });
  } else if (error.status === 402) {
    showToast({
      style: Toast.Style.Failure,
      title: 'Subscription Required',
      message: error.message,
      primaryAction: error.upgradeUrl ? {
        title: 'Upgrade',
        onAction: () => {
          // Open upgrade URL
          import('@raycast/api').then(({ open }) => {
            open(error.upgradeUrl!);
          });
        }
      } : undefined
    });
  } else if (error.status === 503) {
    showToast({
      style: Toast.Style.Failure,
      title: 'Service Unavailable',
      message: error.message
    });
  } else {
    showToast({
      style: Toast.Style.Failure,
      title: 'Error',
      message: error.message
    });
  }
}
```

### 3.5 Update tsconfig.json

Ensure the TypeScript config supports the project:

```json
{
	"$schema": "https://json.schemastore.org/tsconfig",
	"display": "Node 20",
	"include": ["src/**/*"],
	"compilerOptions": {
		"lib": ["ES2022"],
		"module": "CommonJS",
		"target": "ES2022",
		"strict": true,
		"isolatedModules": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"forceConsistentCasingInFileNames": true,
		"jsx": "react-jsx",
		"moduleResolution": "node",
		"resolveJsonModule": true
	}
}
```

---

## Testing

### Local Development

```bash
cd apps/raycast

# Start development mode
bun run dev
```

This will:

1. Build the extension
2. Register it with RayCast
3. Enable hot reloading

### Test Scenarios

1. **No API Key**: Should prompt to open preferences
2. **Invalid API Key**: Should show "Invalid API key" toast
3. **No Subscription**: Should show upgrade prompt with link
4. **Valid Request**: Should stream response
5. **Network Error**: Should show error toast

### Manual Testing Checklist

- [ ] Extension appears in RayCast search
- [ ] API key preference works
- [ ] Resources fetch on open
- [ ] Question submission works
- [ ] SSE streaming displays correctly
- [ ] Copy/paste actions work
- [ ] Error states handled gracefully

---

## Error Handling Reference

| HTTP Status | Error                    | User Message                      | Action                |
| ----------- | ------------------------ | --------------------------------- | --------------------- |
| 401         | Invalid/missing API key  | "Invalid API key"                 | Open preferences      |
| 402         | Subscription required    | "Subscription required"           | Open btca.dev/pricing |
| 402         | Free limit reached       | "Free limit reached"              | Open btca.dev/pricing |
| 503         | Instance not provisioned | "Please visit btca.dev to set up" | Open btca.dev         |
| 503         | Instance wake failed     | "Failed to start. Try again."     | Retry                 |
| 5xx         | Server error             | "Something went wrong"            | Retry                 |

---

## Future Enhancements (Out of Scope for MVP)

1. **Resource Autocomplete**: Show dropdown as user types `@`
2. **Conversation History**: Optional thread persistence
3. **Multiple Commands**: Separate commands for different use cases
4. **Keyboard Shortcuts**: Quick actions for common tasks
5. **Caching**: Cache resources for faster startup

---

## Quick Reference

### Commands

```bash
# Development
cd apps/raycast && bun run dev

# Build
bun run build

# Lint
bun run lint

# Fix lint issues
bun run fix-lint
```

### API Endpoints

| Endpoint             | Method | Auth    | Description              |
| -------------------- | ------ | ------- | ------------------------ |
| `/raycast/resources` | GET    | API Key | List available resources |
| `/raycast/ask`       | POST   | API Key | Stream AI response       |

### Environment

- **Convex URL**: `https://greedy-partridge-784.convex.site`
- **Web App**: `https://btca.dev`
- **Pricing Page**: `https://btca.dev/pricing`
