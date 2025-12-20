#!/usr/bin/env bun

if (typeof Bun === 'undefined') {
	console.error('[btca] This CLI requires Bun. Install it: https://bun.sh');
	console.error('       Then run: bun install -g btca');
	process.exit(1);
}

import path from 'node:path';

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

if (!binFile.exists()) {
	console.error(
		`[btca] Prebuilt binary not found for ${PLATFORM_ARCH}. ` +
			'Try reinstalling, or open an issue if the problem persists.'
	);
	process.exit(1);
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

process.exit(result.status ?? 1);
