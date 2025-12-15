import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './App.tsx';

export async function launchTui() {
	const renderer = await createCliRenderer({
		exitOnCtrlC: true
	});

	createRoot(renderer).render(<App />);
}
