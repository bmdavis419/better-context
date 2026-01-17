import { SANDBOX_IDLE_MINUTES } from './sandbox-service.ts';

const CHARS_PER_TOKEN = 4;

export function estimateTokensFromText(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return Math.max(1, Math.ceil(trimmed.length / CHARS_PER_TOKEN));
}

export function estimateTokensFromChars(chars: number): number {
	if (!Number.isFinite(chars) || chars <= 0) return 0;
	return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}

export function estimateSandboxUsageHours(params: {
	lastActiveAt?: number | null;
	now: number;
}): number {
	const maxWindowMs = SANDBOX_IDLE_MINUTES * 60 * 1000;
	if (!params.lastActiveAt) {
		return maxWindowMs / (60 * 60 * 1000);
	}
	const deltaMs = Math.max(0, params.now - params.lastActiveAt);
	const cappedMs = Math.min(deltaMs, maxWindowMs);
	return cappedMs / (60 * 60 * 1000);
}

export function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}
