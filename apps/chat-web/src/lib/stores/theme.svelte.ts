import { getContext, setContext } from 'svelte';

const THEME_KEY = Symbol('theme');

type Theme = 'light' | 'dark';

type ApplyThemeOptions = {
	persist?: boolean;
};

class ThemeStoreState {
	private _theme = $state<Theme>('light');

	constructor() {
		if (typeof window !== 'undefined') {
			const stored = localStorage.getItem('theme') as Theme | null;
			const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
			const initialTheme =
				stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light';
			this.applyTheme(initialTheme, { persist: false });
		}
	}

	get theme() {
		return this._theme;
	}

	toggle() {
		this.applyTheme(this._theme === 'dark' ? 'light' : 'dark');
	}

	set(newTheme: Theme) {
		this.applyTheme(newTheme);
	}

	private applyTheme(newTheme: Theme, options: ApplyThemeOptions = {}) {
		this._theme = newTheme;
		if (typeof document !== 'undefined') {
			if (newTheme === 'dark') {
				document.documentElement.classList.add('dark');
			} else {
				document.documentElement.classList.remove('dark');
			}
		}

		if (options.persist !== false && typeof localStorage !== 'undefined') {
			localStorage.setItem('theme', newTheme);
		}
	}
}

export function createThemeStore() {
	return new ThemeStoreState();
}

export type ThemeStore = ReturnType<typeof createThemeStore>;

export function setThemeStore() {
	const store = createThemeStore();
	setContext(THEME_KEY, store);
	return store;
}

export function getThemeStore(): ThemeStore {
	return getContext<ThemeStore>(THEME_KEY);
}
