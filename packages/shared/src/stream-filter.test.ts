import { describe, test, expect } from 'bun:test';
import {
	StreamingTagStripper,
	stripUserQuestionFromStart,
	extractCoreQuestion
} from './stream-filter.ts';

describe('StreamingTagStripper', () => {
	test('passes through clean text', () => {
		const stripper = new StreamingTagStripper();
		expect(stripper.process('Hello world')).toBe('Hello world');
		expect(stripper.flush()).toBe('');
	});

	test('strips complete tag in single delta', () => {
		const stripper = new StreamingTagStripper();
		const result = stripper.process('Before<human>inside</human>After');
		expect(result).toBe('BeforeAfter');
	});

	test('strips conversation_history tag', () => {
		const stripper = new StreamingTagStripper();
		const result = stripper.process(
			'<conversation_history>old stuff</conversation_history>Real answer'
		);
		expect(result).toBe('Real answer');
	});

	test('strips current_message tag', () => {
		const stripper = new StreamingTagStripper();
		const result = stripper.process('<current_message>What is X?</current_message>X is...');
		expect(result).toBe('X is...');
	});

	test('strips assistant tag', () => {
		const stripper = new StreamingTagStripper();
		const result = stripper.process('Before<assistant>response</assistant>After');
		expect(result).toBe('BeforeAfter');
	});

	test('strips tag split across two deltas', () => {
		const stripper = new StreamingTagStripper();
		const r1 = stripper.process('Before<hum');
		const r2 = stripper.process('an>inside</human>After');
		expect(r1 + r2).toBe('BeforeAfter');
	});

	test('strips tag split across many deltas', () => {
		const stripper = new StreamingTagStripper();
		const parts = [
			'<conv',
			'ersation_',
			'history>',
			'old stuff',
			'</conver',
			'sation_history>',
			'response'
		];
		const result = parts.map((p) => stripper.process(p)).join('') + stripper.flush();
		expect(result).toBe('response');
	});

	test('buffers partial opener at end', () => {
		const stripper = new StreamingTagStripper();
		// Ends with "<" which might be start of a tag
		expect(stripper.process('Hello<')).toBe('Hello');
		// Now we know it's not a tag to strip
		expect(stripper.process('div>')).toBe('<div>');
	});

	test('buffers partial opener "<conv"', () => {
		const stripper = new StreamingTagStripper();
		const r1 = stripper.process('Text<conv');
		expect(r1).toBe('Text');
		// Complete it as a tag we strip
		const r2 = stripper.process('ersation_history>content</conversation_history>more');
		expect(r2).toBe('more');
	});

	test('handles nested-looking content', () => {
		const stripper = new StreamingTagStripper();
		// Content that looks like it might have tags but doesn't (HTML tags)
		expect(stripper.process('Use <div> for containers')).toBe('Use <div> for containers');
	});

	test('handles code with angle brackets', () => {
		const stripper = new StreamingTagStripper();
		expect(stripper.process('if (a < b && c > d)')).toBe('if (a < b && c > d)');
	});

	test('strips nested history tags', () => {
		const stripper = new StreamingTagStripper();
		const input =
			'<conversation_history><human>Q1</human><assistant>A1</assistant></conversation_history>Real answer';
		expect(stripper.process(input)).toBe('Real answer');
	});

	test('strips multiple consecutive tags', () => {
		const stripper = new StreamingTagStripper();
		const input =
			'<conversation_history>history</conversation_history><current_message>question</current_message>Answer';
		expect(stripper.process(input)).toBe('Answer');
	});

	test('flush returns unbuffered partial when stream ends', () => {
		const stripper = new StreamingTagStripper();
		stripper.process('text<conv');
		// Stream ends without completing the tag - return partial as-is
		expect(stripper.flush()).toBe('<conv');
	});

	test('flush returns empty string when buffer is clean', () => {
		const stripper = new StreamingTagStripper();
		stripper.process('clean text');
		expect(stripper.flush()).toBe('');
	});

	test('reset clears state', () => {
		const stripper = new StreamingTagStripper();
		stripper.process('<human>partial');
		stripper.reset();
		expect(stripper.process('new text')).toBe('new text');
		expect(stripper.flush()).toBe('');
	});

	test('handles empty input', () => {
		const stripper = new StreamingTagStripper();
		expect(stripper.process('')).toBe('');
		expect(stripper.flush()).toBe('');
	});

	test('handles whitespace around tags', () => {
		const stripper = new StreamingTagStripper();
		const result = stripper.process('Before <human>inside</human> After');
		expect(result).toBe('Before  After');
	});

	test('preserves text between multiple tag strips', () => {
		const stripper = new StreamingTagStripper();
		const input = 'Start<human>a</human>Middle<assistant>b</assistant>End';
		expect(stripper.process(input)).toBe('StartMiddleEnd');
	});

	test('handles closing tag split across deltas', () => {
		const stripper = new StreamingTagStripper();
		const r1 = stripper.process('<human>content</hum');
		expect(r1).toBe('');
		const r2 = stripper.process('an>after');
		expect(r2).toBe('after');
	});
});

describe('stripUserQuestionFromStart', () => {
	test('returns response unchanged when no question', () => {
		expect(stripUserQuestionFromStart('Hello world')).toBe('Hello world');
		expect(stripUserQuestionFromStart('Hello world', undefined)).toBe('Hello world');
	});

	test('strips exact question match from start', () => {
		const response = 'What is X? X is a thing that...';
		const question = 'What is X?';
		expect(stripUserQuestionFromStart(response, question)).toBe('X is a thing that...');
	});

	test('handles leading whitespace in response', () => {
		const response = '  What is X? X is...';
		const question = 'What is X?';
		expect(stripUserQuestionFromStart(response, question)).toBe('X is...');
	});

	test('strips question with @mentions', () => {
		const response = '@svelte how do hooks work? Hooks in Svelte...';
		const question = '@svelte how do hooks work?';
		expect(stripUserQuestionFromStart(response, question)).toBe('Hooks in Svelte...');
	});

	test('strips question when AI removes @mentions', () => {
		const response = 'how do hooks work? Hooks work by...';
		const question = '@svelte how do hooks work?';
		expect(stripUserQuestionFromStart(response, question)).toBe('Hooks work by...');
	});

	test('does not strip when question not at start', () => {
		const response = 'Let me explain. What is X? X is...';
		const question = 'What is X?';
		expect(stripUserQuestionFromStart(response, question)).toBe(
			'Let me explain. What is X? X is...'
		);
	});

	test('handles empty question', () => {
		expect(stripUserQuestionFromStart('Hello', '')).toBe('Hello');
	});
});

describe('extractCoreQuestion', () => {
	test('returns undefined for undefined input', () => {
		expect(extractCoreQuestion(undefined)).toBe(undefined);
	});

	test('returns trimmed input when no wrapper', () => {
		expect(extractCoreQuestion('  What is X?  ')).toBe('What is X?');
	});

	test('extracts question from current_message wrapper', () => {
		const prompt = `<conversation_history>
<human>prev question</human>
<assistant>prev answer</assistant>
</conversation_history>

<current_message>
What is the $state rune?
</current_message>`;
		expect(extractCoreQuestion(prompt)).toBe('What is the $state rune?');
	});

	test('handles current_message without history', () => {
		const prompt = '<current_message>Simple question</current_message>';
		expect(extractCoreQuestion(prompt)).toBe('Simple question');
	});

	test('handles whitespace in current_message', () => {
		const prompt = '<current_message>   \n  Question here  \n   </current_message>';
		expect(extractCoreQuestion(prompt)).toBe('Question here');
	});
});
