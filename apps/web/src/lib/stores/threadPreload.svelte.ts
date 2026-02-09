import type { Doc, Id } from '../../convex/_generated/dataModel';

export type PreloadedThreadWithMessages =
	| ((Doc<'threads'> & {
			messages: Array<Doc<'messages'>>;
			resources: string[];
			threadResources: string[];
			activeStream: {
				sessionId: string;
				messageId: Id<'messages'>;
				startedAt: number;
			} | null;
	  }) & { projectId?: Id<'projects'> | undefined })
	| null;

type CacheEntry = {
	data: PreloadedThreadWithMessages;
	loadedAt: number;
};

const CACHE_TTL_MS = 2 * 60 * 1000;
const preloadCache = new Map<string, CacheEntry>();

const normalizeThreadId = (threadId: string) => threadId;

const isFresh = (entry: CacheEntry) => Date.now() - entry.loadedAt < CACHE_TTL_MS;
const getEntry = (threadId: string) => preloadCache.get(normalizeThreadId(threadId));
const getFreshData = (threadId: string) => {
	const entry = getEntry(threadId);
	if (!entry) return null;
	if (!isFresh(entry)) {
		preloadCache.delete(normalizeThreadId(threadId));
		return null;
	}
	return entry.data;
};

export const threadPreloadStore = {
	get(threadId: string) {
		return getFreshData(threadId);
	},
	set(threadId: string, data: PreloadedThreadWithMessages) {
		preloadCache.set(normalizeThreadId(threadId), {
			data,
			loadedAt: Date.now()
		});
	},
	has(threadId: string) {
		return getFreshData(threadId) !== null;
	},
	markConsumed(threadId: string) {
		preloadCache.delete(normalizeThreadId(threadId));
	}
};
