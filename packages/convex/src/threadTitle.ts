'use node';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalAction, type ActionCtx } from './_generated/server';

const OPENCODE_ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

function getOpencodeZen() {
	const apiKey = process.env.OPENCODE_API_KEY;
	if (!apiKey) {
		return null;
	}

	return createOpenAICompatible({
		name: 'opencode-zen',
		baseURL: OPENCODE_ZEN_BASE_URL,
		apiKey
	});
}

/**
 * Generates a concise 4-8 word title for a thread based on the first user message.
 */
export const generateTitle = internalAction({
	args: {
		firstMessage: v.string()
	},
	returns: v.string(),
	handler: async (_ctx: ActionCtx, args: { firstMessage: string }): Promise<string> => {
		const opencodeZen = getOpencodeZen();
		if (!opencodeZen) {
			return 'Untitled';
		}

		const { text } = await generateText({
			model: opencodeZen.chatModel('gpt-5-nano'),
			messages: [
				{
					role: 'system',
					content: `You are a title generator. Generate a concise 4-8 word title that captures the essence of the user's message. 
Rules:
- Output ONLY the title, nothing else
- No quotes, no punctuation at the end
- Be specific and descriptive
- Use title case`
				},
				{
					role: 'user',
					content: args.firstMessage
				}
			],
			temperature: 0.3
		});

		// Clean up the response - remove quotes and trim
		const cleanedTitle = text
			.trim()
			.replace(/^["']|["']$/g, '')
			.replace(/\.+$/, '');

		return cleanedTitle;
	}
});

/**
 * Generates a title and updates the thread with it.
 * This is called from addUserMessage when a thread doesn't have a title yet.
 */
export const generateAndUpdateTitle = internalAction({
	args: {
		threadId: v.id('threads'),
		firstMessage: v.string()
	},
	returns: v.null(),
	handler: async (
		ctx: ActionCtx,
		args: { threadId: Id<'threads'>; firstMessage: string }
	): Promise<null> => {
		const opencodeZen = getOpencodeZen();
		if (!opencodeZen) {
			await ctx.runMutation(internal.threads.updateTitleInternal, {
				threadId: args.threadId,
				title: 'Untitled'
			});
			return null;
		}

		const { text } = await generateText({
			model: opencodeZen.chatModel('gpt-5-nano'),
			messages: [
				{
					role: 'system',
					content: `You are a title generator. Generate a concise 4-8 word title that captures the essence of the user's message. 
Rules:
- Output ONLY the title, nothing else
- No quotes, no punctuation at the end
- Be specific and descriptive
- Use title case`
				},
				{
					role: 'user',
					content: args.firstMessage
				}
			],
			temperature: 0.3
		});

		// Clean up the response - remove quotes and trim
		const cleanedTitle = text
			.trim()
			.replace(/^["']|["']$/g, '')
			.replace(/\.+$/, '');

		// Update the thread with the generated title
		await ctx.runMutation(internal.threads.updateTitleInternal, {
			threadId: args.threadId,
			title: cleanedTitle
		});
		return null;
	}
});
