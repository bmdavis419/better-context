import { McpServer } from 'tmcp';
import { HttpTransport } from '@tmcp/transport-http';
import { ZodJsonSchemaAdapter } from '@tmcp/adapter-zod';
import { ConvexHttpClient } from 'convex/browser';
import { z } from 'zod';
import { env } from '$env/dynamic/public';
import { api } from '../../../convex/_generated/api';
import type { RequestHandler } from './$types';

interface AuthContext extends Record<string, unknown> {
	apiKey: string;
}

const getConvexClient = () => new ConvexHttpClient(env.PUBLIC_CONVEX_URL!);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mcpServer = new McpServer<any, AuthContext>(
	{
		name: 'better-context',
		version: '1.0.0',
		description: 'Better Context MCP Server - Documentation and codebase context'
	},
	{
		adapter: new ZodJsonSchemaAdapter(),
		capabilities: {
			tools: { listChanged: false }
		}
	}
);

mcpServer.tool(
	{
		name: 'listResources',
		description:
			'List all available documentation resources. Call this first to see what resources you can query.'
	},
	async () => {
		const ctx = mcpServer.ctx.custom;
		if (!ctx) {
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Not authenticated' }) }],
				isError: true
			};
		}

		const convex = getConvexClient();
		const result = await convex.action(api.mcp.listResources, {
			apiKey: ctx.apiKey
		});

		if (!result.ok) {
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }],
				isError: true
			};
		}

		return {
			content: [{ type: 'text' as const, text: JSON.stringify(result.resources, null, 2) }]
		};
	}
);

const askSchema = z.object({
	question: z.string().describe('The question to ask about the resources'),
	resources: z
		.array(z.string())
		.min(1)
		.describe('Array of resource names to query (from listResources). At least one required.'),
	project: z.string().optional().describe('Project name (optional, defaults to "default")')
});

const addResourceSchema = z.object({
	url: z.string().describe('GitHub repository URL (https://github.com/owner/repo)'),
	name: z.string().describe('Resource name for reference'),
	branch: z.string().optional().describe('Git branch (default: main)'),
	searchPath: z.string().optional().describe('Subdirectory to focus on'),
	searchPaths: z.array(z.string()).optional().describe('Multiple subdirectories to focus on'),
	notes: z.string().optional().describe('Special notes for the agent'),
	project: z.string().optional().describe('Project name (optional, defaults to "default")')
});

const syncSchema = z.object({
	config: z.string().describe('Full text of local btca.remote.config.jsonc'),
	force: z.boolean().optional().describe('Force push local config, overwriting cloud on conflicts')
});

mcpServer.tool(
	{
		name: 'ask',
		description:
			'Ask a question about specific documentation resources. You must call listResources first to get available resource names.',
		schema: askSchema
	},
	async ({ question, resources, project }) => {
		const ctx = mcpServer.ctx.custom;
		if (!ctx) {
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Not authenticated' }) }],
				isError: true
			};
		}

		const convex = getConvexClient();
		const result = await convex.action(api.mcp.ask, {
			apiKey: ctx.apiKey,
			question,
			resources,
			project
		});

		if (!result.ok) {
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }],
				isError: true
			};
		}

		return {
			content: [{ type: 'text' as const, text: result.text }]
		};
	}
);

mcpServer.tool(
	{
		name: 'addResource',
		description:
			'Add a new git resource to your instance. The resource will be cloned and made available for querying.',
		schema: addResourceSchema
	},
	async ({ url, name, branch, searchPath, searchPaths, notes, project }) => {
		const ctx = mcpServer.ctx.custom;
		if (!ctx) {
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Not authenticated' }) }],
				isError: true
			};
		}

		const convex = getConvexClient();
		const result = await convex.action(api.mcp.addResource, {
			apiKey: ctx.apiKey,
			url,
			name,
			branch: branch ?? 'main',
			searchPath,
			searchPaths,
			notes,
			project
		});

		if (!result.ok) {
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }],
				isError: true
			};
		}

		return {
			content: [{ type: 'text' as const, text: JSON.stringify(result.resource, null, 2) }]
		};
	}
);

mcpServer.tool(
	{
		name: 'sync',
		description:
			'Sync a local btca.remote.config.jsonc with the cloud. Creates/updates resources to match the local config.',
		schema: syncSchema
	},
	async ({ config, force }) => {
		const ctx = mcpServer.ctx.custom;
		if (!ctx) {
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Not authenticated' }) }],
				isError: true
			};
		}

		const convex = getConvexClient();
		const result = await convex.action(api.mcp.sync, {
			apiKey: ctx.apiKey,
			config,
			force: force ?? false
		});

		return {
			content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
			isError: !result.ok
		};
	}
);

const transport = new HttpTransport<AuthContext>(mcpServer, { path: '/api/mcp' });

function extractApiKey(request: Request): string | null {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader?.startsWith('Bearer ')) {
		return null;
	}
	return authHeader.slice(7) || null;
}

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = extractApiKey(request);
	if (!apiKey) {
		return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Pass the API key to the MCP context - validation happens in the Convex actions
	const response = await transport.respond(request, { apiKey });
	return response ?? new Response('Not Found', { status: 404 });
};

export const GET: RequestHandler = async ({ request }) => {
	const apiKey = extractApiKey(request);
	if (!apiKey) {
		return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const response = await transport.respond(request, { apiKey });
	return response ?? new Response('Not Found', { status: 404 });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const apiKey = extractApiKey(request);
	if (!apiKey) {
		return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const response = await transport.respond(request, { apiKey });
	return response ?? new Response('Not Found', { status: 404 });
};
