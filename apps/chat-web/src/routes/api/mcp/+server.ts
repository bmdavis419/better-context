import { HttpTransport } from '@tmcp/transport-http';
import { ZodJsonSchemaAdapter } from '@tmcp/adapter-zod';
import { ConvexHttpClient } from 'convex/browser';
import { McpServer } from 'tmcp';
import { tool } from 'tmcp/utils';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { AutumnService } from '$lib/server/autumn';
import {
	ensureSandboxReadyForRecord,
	type ResourceConfig,
	type SandboxStatus
} from '$lib/server/sandbox-service';
import {
	estimateSandboxUsageHours,
	estimateTokensFromChars,
	estimateTokensFromText
} from '$lib/server/usage';
import { SUPPORT_URL } from '$lib/billing/plans';
import { parseSSEStream } from '$lib/utils/stream';

const ToolInputSchema = z.object({
	question: z.string().min(1),
	resources: z.array(z.string()).optional()
});

type McpContext = {
	auth: Awaited<ReturnType<typeof resolveAuth>>;
};

function getConvexClient(): ConvexHttpClient {
	return new ConvexHttpClient(PUBLIC_CONVEX_URL);
}

function raise(status: number, message: string): never {
	const err = new Error(message) as Error & { status?: number };
	err.status = status;
	throw err;
}

function getApiKey(request: Request): string | null {
	const auth = request.headers.get('authorization') ?? request.headers.get('Authorization');
	if (!auth) return null;
	if (!auth.toLowerCase().startsWith('bearer ')) return null;
	return auth.slice(7).trim();
}

function getErrorMessage(error: unknown, fallback = 'Unexpected error') {
	return error instanceof Error ? error.message : fallback;
}

async function resolveAuth(request: Request) {
	const apiKey = getApiKey(request);
	if (!apiKey) {
		raise(401, 'Missing Authorization: Bearer <key> header');
	}
	const convex = getConvexClient();
	const validation = await convex.query(api.apiKeys.validate, { apiKey });
	if (!validation.valid) {
		raise(401, validation.error ?? 'Invalid API key');
	}
	await convex.mutation(api.apiKeys.touchLastUsed, {
		keyId: validation.keyId as Id<'apiKeys'>
	});
	const instance = await convex.query(api.users.get, { id: validation.userId });
	if (!instance) {
		raise(404, 'User not found');
	}
	return { apiKey, instance, userId: validation.userId };
}

async function ensurePaidAndUsage(args: {
	instance: {
		clerkId: string;
		lastActiveAt?: number | null;
	};
	convexUserId: Id<'instances'>;
	question: string;
	hasResources: boolean;
}) {
	const autumn = AutumnService.get();
	const customer = await autumn.getOrCreateCustomer({
		clerkId: args.instance.clerkId,
		email: null,
		name: null
	});
	const activeProduct = autumn.getActiveProduct(customer.products);
	if (!activeProduct) {
		raise(402, 'Subscription required. Visit /pricing to subscribe.');
	}

	const now = Date.now();
	const inputTokens = estimateTokensFromText(args.question);
	const sandboxUsageHours = args.hasResources
		? estimateSandboxUsageHours({
				lastActiveAt: args.instance.lastActiveAt,
				now
			})
		: 0;

	const usageCheck = await autumn.ensureUsageAvailable({
		customerId: customer.id ?? args.instance.clerkId,
		requiredTokensIn: inputTokens > 0 ? inputTokens : undefined,
		requiredTokensOut: 1,
		requiredSandboxHours: sandboxUsageHours > 0 ? sandboxUsageHours : undefined
	});

	if (!usageCheck.ok) {
		raise(402, `Monthly usage limit reached. Contact ${SUPPORT_URL} to raise limits.`);
	}

	const convex = getConvexClient();
	if (args.hasResources) {
		await convex.mutation(api.users.updateSandboxActivity, {
			userId: args.convexUserId,
			sandboxId: ''
		});
	}
	await convex.mutation(api.users.touchMcpUsage, {
		userId: args.convexUserId
	});

	return {
		autumn,
		customerId: customer.id ?? args.instance.clerkId,
		inputTokens,
		sandboxUsageHours
	};
}

async function buildResourceConfigs(args: {
	userId: Id<'instances'>;
	resourceNames: string[];
}): Promise<{ resourceConfigs: ResourceConfig[]; resourceNames: string[] }> {
	const convex = getConvexClient();
	const availableResources = await convex.query(api.resources.listAvailable, {
		userId: args.userId
	});
	const allResources = [...availableResources.global, ...availableResources.custom];

	const namesToUse =
		args.resourceNames.length > 0 ? args.resourceNames : allResources.map((r) => r.name);
	const resourceConfigs: ResourceConfig[] = [];
	const validNames: string[] = [];
	for (const name of namesToUse) {
		const resource = allResources.find((r) => r.name === name);
		if (resource) {
			resourceConfigs.push({
				name: resource.name,
				type: 'git',
				url: resource.url,
				branch: resource.branch,
				searchPath: resource.searchPath,
				specialNotes: resource.specialNotes
			});
			validNames.push(resource.name);
		}
	}
	return { resourceConfigs, resourceNames: validNames };
}

async function prepareQuestionContext(args: {
	auth: Awaited<ReturnType<typeof resolveAuth>>;
	question: string;
	resources: string[];
}) {
	const convexUserId = args.auth.userId as Id<'instances'>;

	const convex = getConvexClient();
	const instanceRecord = await convex.query(api.users.get, { id: convexUserId });
	if (!instanceRecord) {
		raise(404, 'User not found');
	}

	const resourceBuild = await buildResourceConfigs({
		userId: convexUserId,
		resourceNames: args.resources
	});
	const resourceNames = resourceBuild.resourceNames;
	const resourceConfigs = resourceBuild.resourceConfigs;
	if (resourceNames.length === 0) {
		raise(400, 'No valid resources selected');
	}

	const usageContext = await ensurePaidAndUsage({
		instance: args.auth.instance,
		convexUserId,
		question: args.question,
		hasResources: resourceNames.length > 0
	});

	const sendStatus = (status: SandboxStatus) => {
		console.log('[mcp] sandbox status:', status);
	};

	const serverUrl = await ensureSandboxReadyForRecord({
		sandboxId: instanceRecord.sandboxId,
		resources: resourceConfigs,
		onStatus: sendStatus,
		onPersist: async (sandboxId) => {
			await convex.mutation(api.users.setMcpSandboxId, {
				userId: convexUserId,
				sandboxId
			});
		}
	});

	return {
		usageContext,
		serverUrl,
		resourceNames
	};
}

async function fetchStreamedAnswer(args: {
	serverUrl: string;
	question: string;
	resourceNames: string[];
}) {
	const response = await fetch(`${args.serverUrl}/question/stream`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			question: args.question,
			resources: args.resourceNames.length > 0 ? args.resourceNames : undefined,
			quiet: true
		})
	});

	if (!response.ok || !response.body) {
		const errorText = await response.text();
		raise(response.status, errorText || 'btca server error');
	}

	let outputChars = 0;
	let reasoningChars = 0;
	let answer = '';

	for await (const event of parseSSEStream(response)) {
		if (event.type === 'text.delta' && event.delta) {
			outputChars += event.delta.length;
			answer += event.delta;
		} else if (event.type === 'reasoning.delta' && event.delta) {
			reasoningChars += event.delta.length;
		}
	}

	return {
		answer,
		outputTokens: estimateTokensFromChars(outputChars + reasoningChars)
	};
}

async function trackUsage(args: {
	usageContext: Awaited<ReturnType<typeof ensurePaidAndUsage>>;
	outputTokens: number;
}) {
	try {
		await args.usageContext.autumn.trackUsage({
			customerId: args.usageContext.customerId,
			tokensIn: args.usageContext.inputTokens,
			tokensOut: args.outputTokens,
			sandboxHours: args.usageContext.sandboxUsageHours
		});
	} catch (trackError) {
		console.error('[mcp] usage tracking failed:', trackError);
	}
}

const adapter = new ZodJsonSchemaAdapter();
const server = new McpServer(
	{
		name: 'btca-chat-mcp',
		version: '0.1.0',
		description: 'BTCA chat MCP server'
	},
	{
		adapter,
		capabilities: {
			tools: { listChanged: false }
		}
	}
).withContext<McpContext>();

server.tool(
	{
		name: 'question',
		description:
			'Ask btca a question about your configured documentation resources. Streams the full answer as text. Use this when you need information about frameworks, libraries, or tools that the user has configured.',
		schema: ToolInputSchema
	},
	async ({ question, resources }) => {
		const auth = server.ctx.custom?.auth;
		if (!auth) {
			return tool.error('Unauthorized');
		}

		try {
			const context = await prepareQuestionContext({
				auth,
				question,
				resources: resources ?? []
			});

			const { answer, outputTokens } = await fetchStreamedAnswer({
				serverUrl: context.serverUrl,
				question,
				resourceNames: context.resourceNames
			});

			await trackUsage({
				usageContext: context.usageContext,
				outputTokens
			});

			return tool.text(answer);
		} catch (error) {
			return tool.error(getErrorMessage(error, 'Request failed'));
		}
	}
);

const transport = new HttpTransport(server, { path: '/api/mcp' });

const handleRequest: RequestHandler = async ({ request }) => {
	if (request.method === 'OPTIONS') {
		const response = await transport.respond(request);
		return response ?? new Response('Not Found', { status: 404 });
	}

	let auth: Awaited<ReturnType<typeof resolveAuth>>;
	try {
		auth = await resolveAuth(request);
	} catch (error) {
		const status =
			error instanceof Error && 'status' in error ? ((error as any).status ?? 401) : 401;
		const message = getErrorMessage(error, 'Unauthorized');
		return new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const response = await transport.respond(request, { auth });
	if (response) return response;
	return new Response('Not Found', { status: 404 });
};

export const GET = handleRequest;
export const POST = handleRequest;
export const DELETE = handleRequest;
export const OPTIONS = handleRequest;
