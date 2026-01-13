import { getContext, setContext } from 'svelte';

const THEME_KEY = Symbol('theme');

type Theme = 'light' | 'dark';

export function createThemeStore() {
	let theme = $state<Theme>('light');

	// Initialize from localStorage or system preference
	if (typeof window !== 'undefined') {
		const stored = localStorage.getItem('theme') as Theme | null;
		const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
		theme = stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light';
		updateDocument(theme);
	}

	function updateDocument(newTheme: Theme) {
		if (typeof document !== 'undefined') {
			if (newTheme === 'dark') {
				document.documentElement.classList.add('dark');
			} else {
				document.documentElement.classList.remove('dark');
			}
		}
	}

	function toggle() {
		theme = theme === 'dark' ? 'light' : 'dark';
		updateDocument(theme);
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('theme', theme);
		}
	}

	function set(newTheme: Theme) {
		theme = newTheme;
		updateDocument(theme);
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('theme', theme);
		}
	}

	return {
		get theme() {
			return theme;
		},
		toggle,
		set
	};
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
