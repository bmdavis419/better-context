import { $ } from 'bun';
import { FileSystem } from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import packageJson from '../package.json';
import solidPlugin from '@opentui/solid/bun-plugin';

const VERSION = packageJson.version;

const targets = [
	'bun-darwin-arm64',
	'bun-darwin-x64',
	'bun-linux-x64',
	'bun-linux-arm64',
	'bun-windows-x64'
] as const;

const outputNames: Record<(typeof targets)[number], string> = {
	'bun-darwin-arm64': 'btca-darwin-arm64',
	'bun-darwin-x64': 'btca-darwin-x64',
	'bun-linux-x64': 'btca-linux-x64',
	'bun-linux-arm64': 'btca-linux-arm64',
	'bun-windows-x64': 'btca-windows-x64.exe'
};

const main = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;

	// Install opentui for all platforms
	const opentuiCoreVersion = packageJson.devDependencies['@opentui/core'];
	const opentuiSolidVersion = packageJson.devDependencies['@opentui/solid'];

	console.log('Installing opentui for all platforms...');
	yield* Effect.promise(
		() => $`bun install --os="*" --cpu="*" @opentui/core@${opentuiCoreVersion}`
	);
	yield* Effect.promise(
		() => $`bun install --os="*" --cpu="*" @opentui/solid@${opentuiSolidVersion}`
	);
	console.log('Done installing opentui for all platforms');

	yield* fs.makeDirectory('dist', { recursive: true });

	for (const target of targets) {
		const outfile = `dist/${outputNames[target]}`;
		console.log(`Building ${target} -> ${outfile} (v${VERSION})`);
		const result = yield* Effect.promise(() =>
			Bun.build({
				entrypoints: ['src/index.ts'],
				target: 'bun',
				plugins: [solidPlugin],
				define: {
					__VERSION__: JSON.stringify(VERSION)
				},
				compile: {
					target,
					outfile,
					// Disable bunfig.toml autoloading - the solidPlugin already transforms JSX at build time
					// and we don't want the binary to pick up bunfig.toml from the cwd
					autoloadBunfig: false
				}
			})
		);
		if (!result.success) {
			console.error(`Build failed for ${target}:`, result.logs);
			process.exit(1);
		}
	}

	console.log('Done building all targets');
});

main.pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
