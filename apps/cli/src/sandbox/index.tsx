import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './App.tsx';

async function main() {
	const renderer = await createCliRenderer({
		exitOnCtrlC: true
	});

	createRoot(renderer).render(<App />);
}

main().catch(console.error);
