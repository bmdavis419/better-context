// Color palette matching apps/web (dark mode)
export const colors = {
	// Backgrounds
	bg: '#0a0a0a', // neutral-950
	bgSubtle: '#171717', // neutral-900
	bgMuted: '#262626', // neutral-800

	// Text
	text: '#fafafa', // neutral-50
	textMuted: '#a3a3a3', // neutral-400
	textSubtle: '#737373', // neutral-500
	textCommand: '#FFD700', // gold
	textPasted: '#8B5CF6', // purple-500

	// Borders
	border: '#262626', // neutral-800
	borderSubtle: '#404040', // neutral-700

	// Accent (orange)
	accent: '#f97316', // orange-500
	accentDark: '#c2410c', // orange-700

	// Semantic
	success: '#22c55e', // green-500
	info: '#3b82f6', // blue-500
	error: '#ef4444' // red-500
} as const;

export const getColor = (type: 'text' | 'command' | 'mention' | 'pasted') => {
	switch (type) {
		case 'mention':
			return colors.accent;
		case 'command':
			return colors.textCommand;
		case 'pasted':
			return colors.textPasted;
		default:
			return colors.text;
	}
};

export type Colors = typeof colors;
