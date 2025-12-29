import { createContext, onDestroy, onMount } from 'svelte';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import bash from '@shikijs/langs/bash';
import json from '@shikijs/langs/json';
import darkPlus from '@shikijs/themes/dark-plus';
import lightPlus from '@shikijs/themes/light-plus';

class ShikiStore {
	private highlighterPromise = createHighlighterCore({
		langs: [bash, json],
		themes: [darkPlus, lightPlus],
		engine: createJavaScriptRegexEngine()
	});

	highlighter = $state<HighlighterCore | null>(null);

	constructor() {
		onMount(async () => {
			this.highlighter = await this.highlighterPromise;
		});
		onDestroy(() => {
			this.highlighter?.dispose();
		});
	}
}

const [internalGet, internalSet] = createContext<ShikiStore>();

export const getShikiStore = () => {
	const store = internalGet();
	if (!store) {
		throw new Error('ShikiStore not found, did you call setShikiStore() in a parent component?');
	}
	return store;
};

export const setShikiStore = () => {
	const newStore = new ShikiStore();
	return internalSet(newStore);
};
