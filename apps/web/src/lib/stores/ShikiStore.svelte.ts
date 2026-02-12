import { Result } from 'better-result';
import { createContext, onMount } from 'svelte';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import bash from '@shikijs/langs/bash';
import json from '@shikijs/langs/json';
import toml from '@shikijs/langs/toml';
import darkPlus from '@shikijs/themes/dark-plus';
import lightPlus from '@shikijs/themes/light-plus';
import { WebValidationError } from '../result/errors';

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighterInstance: HighlighterCore | null = null;
let generation = 0;

const getCoreHighlighter = () => {
	if (!highlighterPromise) {
		generation += 1;
		const current = generation;
		highlighterPromise = createHighlighterCore({
			langs: [bash, json, toml],
			themes: [darkPlus, lightPlus],
			engine: createJavaScriptRegexEngine()
		}).then((highlighter) => {
			if (current !== generation) {
				highlighter.dispose();
				return highlighter;
			}
			highlighterInstance = highlighter;
			return highlighter;
		});
	}

	return highlighterPromise;
};

class ShikiStore {
	highlighter = $state<HighlighterCore | null>(null);

	constructor() {
		onMount(async () => {
			this.highlighter = await getCoreHighlighter();
		});
	}
}

const [internalGet, internalSet] = createContext<ShikiStore>();

export const getShikiStore = () => {
	const missingShikiStoreError = () =>
		new WebValidationError({
			message: 'ShikiStore not found, did you call setShikiStore() in a parent component?'
		});

	const getShikiStoreResult = (): Result<ShikiStore, WebValidationError> => {
		const store = internalGet();
		if (!store) return Result.err(missingShikiStoreError());
		return Result.ok(store);
	};

	return Result.match(getShikiStoreResult(), {
		ok: (store) => store,
		err: (error) => {
			throw error;
		}
	});
};

export const setShikiStore = () => {
	const newStore = new ShikiStore();
	return internalSet(newStore);
};

export const disposeShikiStoreHighlighter = () => {
	if (!highlighterPromise && !highlighterInstance) return;
	generation += 1;
	highlighterInstance?.dispose();
	highlighterInstance = null;
	highlighterPromise = null;
};
