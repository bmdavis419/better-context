import { $ } from 'bun';
import solidPlugin from '@opentui/solid/bun-plugin';
import packageJson from '../package.json';

const VERSION = packageJson.version;

const targets = [
	'bun-darwin-arm64',
	'bun-darwin-x64',
	'bun-linux-x64',
	'bun-linux-arm64',
	'bun-windows-x64'
] as const;

const parseTargets = () => {
	const raw = process.env.BTCA_TARGETS?.trim();
	if (!raw) return targets;
	const requested = raw
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	const unknown = requested.filter((entry) => !targets.includes(entry as (typeof targets)[number]));
	if (unknown.length) {
		console.error(`[btca] Unknown build targets: ${unknown.join(', ')}`);
		process.exit(1);
	}
	return targets.filter((target) => requested.includes(target));
};

const outputNames: Record<(typeof targets)[number], string> = {
	'bun-darwin-arm64': 'btca-darwin-arm64',
	'bun-darwin-x64': 'btca-darwin-x64',
	'bun-linux-x64': 'btca-linux-x64',
	'bun-linux-arm64': 'btca-linux-arm64',
	'bun-windows-x64': 'btca-windows-x64.exe'
};

async function main() {
	// Install opentui for all platforms
	const opentuiCoreVersion = packageJson.devDependencies['@opentui/core'];
	const opentuiSolidVersion = packageJson.devDependencies['@opentui/solid'];

	console.log('Installing opentui for all platforms...');
	await $`bun install --os="*" --cpu="*" @opentui/core@${opentuiCoreVersion}`;
	await $`bun install --os="*" --cpu="*" @opentui/solid@${opentuiSolidVersion}`;
	console.log('Done installing opentui for all platforms');

	await Bun.file('dist')
		.exists()
		.catch(() => false);
	await $`mkdir -p dist`;

	for (const target of parseTargets()) {
		const outfile = `dist/${outputNames[target]}`;
		console.log(`Building ${target} -> ${outfile} (v${VERSION})`);
		const result = await Bun.build({
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
		});
		if (!result.success) {
			console.error(`Build failed for ${target}:`, result.logs);
			process.exit(1);
		}
	}

	console.log('Done building all targets');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
