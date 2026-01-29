import { homedir } from 'node:os';
import { join } from 'node:path';
import { Result } from 'better-result';
import type { InputState } from './types.ts';

const HISTORY_FILE = join(homedir(), '.local', 'share', 'btca', 'input-history.json');
const MAX_HISTORY_SIZE = 100;

interface HistoryData {
	entries: InputState[];
}

/**
 * Get plain text representation of InputState for comparison
 */
function getPlainText(state: InputState): string {
	return state.map((s) => s.content).join('');
}

/**
 * Load history from disk
 */
async function loadHistory(): Promise<InputState[]> {
	const file = Bun.file(HISTORY_FILE);
	const existsResult = await Result.tryPromise(() => file.exists());
	if (existsResult.isErr() || !existsResult.value) {
		return [];
	}

	const dataResult = await Result.tryPromise(async () => (await file.json()) as HistoryData);
	if (dataResult.isErr()) {
		return [];
	}

	const data = dataResult.value;
	// Migrate old string-based format if needed
	if (Array.isArray(data.entries) && data.entries.length > 0) {
		if (typeof data.entries[0] === 'string') {
			// Old format - convert strings to InputState
			return (data.entries as unknown as string[]).map((str) => [{ type: 'text', content: str }]);
		}
	}
	return data.entries ?? [];
}

/**
 * Save history to disk
 */
async function saveHistory(entries: InputState[]): Promise<void> {
	const result = await Result.tryPromise(async () => {
		// Ensure directory exists (mkdir -p is idempotent)
		const dir = join(homedir(), '.local', 'share', 'btca');
		await Bun.$`mkdir -p ${dir}`.quiet();

		const data: HistoryData = { entries };
		await Bun.write(HISTORY_FILE, JSON.stringify(data, null, 2));
	});
	if (result.isErr()) return;
}

/**
 * Input history manager for TUI
 * Provides up/down arrow navigation through previous inputs
 * Preserves full InputState including pasted content blocks
 */
export class InputHistory {
	private entries: InputState[] = [];
	private currentIndex = -1;
	private pendingInput: InputState = []; // Stores current input when navigating history
	private loaded = false;

	/**
	 * Initialize by loading history from disk
	 */
	async init(): Promise<void> {
		if (this.loaded) return;
		this.entries = await loadHistory();
		this.loaded = true;
	}

	/**
	 * Add a new entry to history (called on submit)
	 */
	async add(input: InputState): Promise<void> {
		const plainText = getPlainText(input).trim();
		if (!plainText) return;

		// Don't add duplicates of the most recent entry
		if (this.entries.length > 0) {
			const lastEntry = this.entries[this.entries.length - 1];
			if (lastEntry && getPlainText(lastEntry) === plainText) {
				this.reset();
				return;
			}
		}

		// Remove any existing occurrence to avoid duplicates
		const existingIndex = this.entries.findIndex((e) => getPlainText(e) === plainText);
		if (existingIndex !== -1) {
			this.entries.splice(existingIndex, 1);
		}

		this.entries.push(input);

		// Trim to max size
		if (this.entries.length > MAX_HISTORY_SIZE) {
			this.entries = this.entries.slice(-MAX_HISTORY_SIZE);
		}

		await saveHistory(this.entries);
		this.reset();
	}

	/**
	 * Navigate to previous entry (up arrow)
	 * Returns the entry to display, or null if no more history
	 */
	navigateUp(currentInput: InputState): InputState | null {
		if (this.entries.length === 0) return null;

		// First time navigating - save current input
		if (this.currentIndex === -1) {
			this.pendingInput = currentInput;
			this.currentIndex = this.entries.length - 1;
			return this.entries[this.currentIndex] ?? null;
		}

		// Navigate to older entry
		if (this.currentIndex > 0) {
			this.currentIndex--;
			return this.entries[this.currentIndex] ?? null;
		}

		// Already at oldest entry
		return null;
	}

	/**
	 * Navigate to next entry (down arrow)
	 * Returns the entry to display, or null if back to current input
	 */
	navigateDown(): InputState | null {
		if (this.currentIndex === -1) return null;

		this.currentIndex++;

		// Back to pending input
		if (this.currentIndex >= this.entries.length) {
			const pending = this.pendingInput;
			this.reset();
			return pending;
		}

		return this.entries[this.currentIndex] ?? null;
	}

	/**
	 * Reset navigation state (called when input changes or on submit)
	 */
	reset(): void {
		this.currentIndex = -1;
		this.pendingInput = [];
	}

	/**
	 * Check if currently navigating history
	 */
	isNavigating(): boolean {
		return this.currentIndex !== -1;
	}
}

// Singleton instance for the TUI
export const inputHistory = new InputHistory();
