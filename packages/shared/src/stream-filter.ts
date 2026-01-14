/**
 * Streaming tag stripper for filtering conversation history markers from AI responses.
 *
 * This module handles the complex case where XML-style tags may be split across
 * multiple streaming text deltas. It buffers potential partial tags and only
 * emits content that is confirmed to not be part of a tag we're stripping.
 */

/**
 * Tags to strip from streaming responses.
 * These are conversation history markers that shouldn't appear in the UI.
 */
const TAGS_TO_STRIP = ['conversation_history', 'current_message', 'human', 'assistant'] as const;

/**
 * Streaming tag stripper that handles tags split across multiple text deltas.
 *
 * Usage:
 * ```ts
 * const stripper = new StreamingTagStripper();
 * for (const delta of deltas) {
 *   const clean = stripper.process(delta);
 *   if (clean) emit(clean);
 * }
 * const remaining = stripper.flush();
 * if (remaining) emit(remaining);
 * ```
 */
export class StreamingTagStripper {
	private buffer = '';
	private strippingTag: string | null = null;

	/**
	 * Process incoming text and return safe-to-emit content.
	 * - Content inside stripped tags is discarded
	 * - Potential partial tags are buffered until resolved
	 */
	process(incoming: string): string {
		this.buffer += incoming;
		let output = '';

		while (true) {
			const { emit, done } = this.processStep();
			output += emit;
			if (done) break;
		}

		return output;
	}

	/**
	 * Flush remaining buffer at end of stream.
	 * Any partial tags that never completed are emitted as-is.
	 */
	flush(): string {
		const remaining = this.buffer;
		this.buffer = '';
		this.strippingTag = null;
		return remaining;
	}

	/**
	 * Reset the stripper state. Useful for reusing the same instance.
	 */
	reset(): void {
		this.buffer = '';
		this.strippingTag = null;
	}

	private processStep(): { emit: string; done: boolean } {
		if (this.buffer.length === 0) {
			return { emit: '', done: true };
		}

		// STATE: Inside a tag we're stripping
		if (this.strippingTag) {
			return this.processStrippingState();
		}

		// STATE: Normal - looking for tag openers
		return this.processNormalState();
	}

	private processStrippingState(): { emit: string; done: boolean } {
		const closer = `</${this.strippingTag}>`;
		const closerIdx = this.buffer.indexOf(closer);

		if (closerIdx >= 0) {
			// Found closer - discard everything up to and including it
			this.buffer = this.buffer.slice(closerIdx + closer.length);
			this.strippingTag = null;
			return { emit: '', done: false }; // Continue processing
		}

		// Check if buffer might end with partial closer
		if (this.endsWithPartialMatch(closer)) {
			// Hold buffer - might be start of closer
			return { emit: '', done: true };
		}

		// No closer here - discard buffer content (it's inside tag)
		this.buffer = '';
		return { emit: '', done: true };
	}

	private processNormalState(): { emit: string; done: boolean } {
		// Look for complete tag openers
		for (const tag of TAGS_TO_STRIP) {
			const opener = `<${tag}>`;
			const openerIdx = this.buffer.indexOf(opener);

			if (openerIdx >= 0) {
				// Found opener - emit before, start stripping after
				const before = this.buffer.slice(0, openerIdx);
				this.buffer = this.buffer.slice(openerIdx + opener.length);
				this.strippingTag = tag;
				return { emit: before, done: false }; // Continue processing
			}
		}

		// No complete openers - check for partial at end of buffer
		const partialIdx = this.findPartialOpenerIndex();
		if (partialIdx >= 0) {
			// Emit safe content, buffer the potential partial tag
			const safe = this.buffer.slice(0, partialIdx);
			this.buffer = this.buffer.slice(partialIdx);
			return { emit: safe, done: true };
		}

		// No tags at all - emit everything
		const all = this.buffer;
		this.buffer = '';
		return { emit: all, done: true };
	}

	private endsWithPartialMatch(target: string): boolean {
		// Check if buffer ends with any prefix of target
		for (let len = 1; len < target.length && len <= this.buffer.length; len++) {
			const suffix = this.buffer.slice(-len);
			const prefix = target.slice(0, len);
			if (suffix === prefix) return true;
		}
		return false;
	}

	private findPartialOpenerIndex(): number {
		// Find where a partial tag opener might start at end of buffer
		// Check both opening tags and closing tags (in case we see "</" at end)
		for (const tag of TAGS_TO_STRIP) {
			const opener = `<${tag}>`;
			const closer = `</${tag}>`;

			// Check for partial opener
			for (let len = 1; len < opener.length; len++) {
				const prefix = opener.slice(0, len);
				const checkIdx = this.buffer.length - len;
				if (checkIdx >= 0 && this.buffer.slice(checkIdx) === prefix) {
					return checkIdx;
				}
			}

			// Check for partial closer (in case we're at boundary)
			for (let len = 1; len < closer.length; len++) {
				const prefix = closer.slice(0, len);
				const checkIdx = this.buffer.length - len;
				if (checkIdx >= 0 && this.buffer.slice(checkIdx) === prefix) {
					return checkIdx;
				}
			}
		}
		return -1;
	}
}

/**
 * Strip the user's question from the start of the AI response.
 * OpenCode sometimes echoes the question before answering.
 *
 * @param response - The AI response text
 * @param question - The user's question to strip
 * @returns The response with the echoed question removed from the start
 */
export function stripUserQuestionFromStart(response: string, question?: string): string {
	if (!question) return response;

	let cleaned = response.trimStart();
	const questionTrimmed = question.trim();

	// Direct match
	if (cleaned.startsWith(questionTrimmed)) {
		cleaned = cleaned.slice(questionTrimmed.length).trimStart();
	}

	// Try without @mentions (AI might strip those)
	const questionNoMentions = questionTrimmed.replace(/@\w+\s*/g, '').trim();
	if (questionNoMentions && cleaned.startsWith(questionNoMentions)) {
		cleaned = cleaned.slice(questionNoMentions.length).trimStart();
	}

	return cleaned;
}

/**
 * Extract the core question from a history-wrapped prompt.
 * Looks for content inside <current_message> tags.
 *
 * @param prompt - The full prompt that may contain history wrapper
 * @returns The extracted question, or the original prompt if no wrapper found
 */
export function extractCoreQuestion(prompt?: string): string | undefined {
	if (!prompt) return undefined;

	const match = prompt.match(/<current_message>\s*([\s\S]*?)\s*<\/current_message>/);
	return match?.[1]?.trim() ?? prompt.trim();
}
