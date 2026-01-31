const requiredFiles = [
	'btca-darwin-arm64',
	'btca-darwin-x64',
	'btca-linux-x64',
	'btca-linux-arm64',
	'btca-windows-x64.exe'
];

const distDir = new URL('../dist/', import.meta.url);
const missing = [] as string[];

for (const file of requiredFiles) {
	const fileUrl = new URL(file, distDir);
	const exists = await Bun.file(fileUrl).exists();
	if (!exists) {
		missing.push(file);
	}
}

if (missing.length) {
	console.error('[btca] Missing required dist artifacts:');
	for (const file of missing) {
		console.error(`- ${file}`);
	}
	process.exit(1);
}

console.log('[btca] All required dist artifacts are present.');
