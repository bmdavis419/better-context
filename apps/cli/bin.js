#!/usr/bin/env bun

if (typeof Bun === 'undefined') {
	console.error('[btca] This CLI requires Bun. Install it: https://bun.sh');
	console.error('       Then run: bun install -g btca');
	process.exit(1);
}

import path from 'node:path';
import { chmod, stat } from 'node:fs/promises';

const PLATFORM_ARCH = `${process.platform}-${process.arch}`;

const TARGET_MAP = {
	'darwin-arm64': 'btca-darwin-arm64',
	'darwin-x64': 'btca-darwin-x64',
	'linux-x64': 'btca-linux-x64',
	'linux-arm64': 'btca-linux-arm64',
	'win32-x64': 'btca-windows-x64.exe'
};

const binaryName = TARGET_MAP[PLATFORM_ARCH];

if (!binaryName) {
	console.error(
		`[btca] Unsupported platform: ${PLATFORM_ARCH}. ` +
			'Please open an issue with your OS/CPU details.'
	);
	process.exit(1);
}

const __dirname = path.dirname(Bun.fileURLToPath(import.meta.url));
const binPath = path.join(__dirname, 'dist', binaryName);
const binFile = Bun.file(binPath);

if (!(await binFile.exists())) {
	const glob = new Bun.Glob('dist/*');
	const entries = [];
	for await (const entry of glob.scan({ cwd: __dirname })) {
		entries.push(entry.replace(/^dist\//, ''));
	}
	const available = entries.length
		? `Available binaries: ${entries.join(', ')}`
		: 'No binaries found in dist/.';
	console.error(`[btca] Prebuilt binary not found for ${PLATFORM_ARCH} (${binaryName}).`);
	console.error(`[btca] ${available}`);
	console.error('[btca] Try reinstalling, or open an issue if the problem persists.');
	process.exit(1);
}

if (process.platform !== 'win32') {
	try {
		const fileStats = await stat(binPath);
		if ((fileStats.mode & 0o111) === 0) {
			await chmod(binPath, fileStats.mode | 0o111);
		}
	} catch {
		try {
			await chmod(binPath, 0o755);
		} catch {
			// If chmod fails, continue and let spawn report the error.
		}
	}
}

const result = Bun.spawnSync([binPath, ...process.argv.slice(2)], {
	stdout: 'inherit',
	stderr: 'inherit',
	stdin: 'inherit'
});

if (result.error) {
	console.error(`[btca] Failed to start binary: ${result.error}`);
	process.exit(1);
}

process.exit(result.exitCode ?? 1);
