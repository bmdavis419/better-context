import { browser } from '$app/environment';
import { createContext, onMount } from 'svelte';

export type Theme = 'light' | 'dark';

export const readStoredTheme = (): Theme | null => {
	if (!browser) return null;
	const v = window.localStorage.getItem('theme');
	if (v === 'light' || v === 'dark') return v;
	return null;
};

export const readPreferredTheme = (): Theme => {
	if (!browser) return 'dark';
	const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
	return prefersDark ? 'dark' : 'light';
};

export const getInitialTheme = (): Theme => readStoredTheme() ?? readPreferredTheme();

export const setTheme = (theme: Theme): void => {
	if (!browser) return;
	document.documentElement.classList.toggle('dark', theme === 'dark');
	if (!browser) return;
	window.localStorage.setItem('theme', theme);
};

class ThemeStore {
	theme = $state<Theme>('dark');

	set = (theme: Theme) => {
		this.theme = theme;
		setTheme(theme);
	};

	init = () => {
		this.set(getInitialTheme());
	};

	toggle = () => {
		this.set(this.theme === 'dark' ? 'light' : 'dark');
	};

	constructor() {
		onMount(() => this.init());
	}
}

const [internalGet, internalSet] = createContext<ThemeStore>();

export const getThemeStore = () => {
	const store = internalGet();
	if (!store) {
		throw new Error('ThemeStore not found, did you call setThemeStore() in a parent component?');
	}
	return store;
};

export const setThemeStore = () => {
	const newStore = new ThemeStore();
	return internalSet(newStore);
};
