import packageJson from '../package.json';
import solidPlugin from '@opentui/solid/bun-plugin';

const VERSION = packageJson.version;

console.log(`Building btca v${VERSION}`);

const result = await Bun.build({
	entrypoints: ['src/index.ts'],
	outdir: 'dist',
	target: 'bun',
	define: {
		__VERSION__: JSON.stringify(VERSION)
	},
	plugins: [solidPlugin]
});

if (!result.success) {
	console.error('Build failed:', result.logs);
	process.exit(1);
}

const indexPath = 'dist/index.js';
const content = await Bun.file(indexPath).text();
await Bun.write(indexPath, `#!/usr/bin/env bun\n${content}`);

console.log('Done');
