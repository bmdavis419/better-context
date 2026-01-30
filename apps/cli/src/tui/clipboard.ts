import { spawn } from 'bun';

function isWSL(): boolean {
	try {
		const release = require('os').release().toLowerCase();
		return release.includes('microsoft') || release.includes('wsl');
	} catch {
		return false;
	}
}

export async function copyToClipboard(text: string): Promise<void> {
	const platform = process.platform;

	if (platform === 'darwin') {
		const proc = spawn(['pbcopy'], { stdin: 'pipe' });
		proc.stdin.write(text);
		proc.stdin.end();
		await proc.exited;
	} else if (platform === 'win32' || isWSL()) {
		const proc = spawn(['clip.exe'], { stdin: 'pipe' });
		proc.stdin.write(text);
		proc.stdin.end();
		await proc.exited;
	} else if (platform === 'linux') {
		// Try xclip first, fall back to xsel
		try {
			const proc = spawn(['xclip', '-selection', 'clipboard'], { stdin: 'pipe' });
			proc.stdin.write(text);
			proc.stdin.end();
			await proc.exited;
		} catch {
			const proc = spawn(['xsel', '--clipboard', '--input'], { stdin: 'pipe' });
			proc.stdin.write(text);
			proc.stdin.end();
			await proc.exited;
		}
	}
}
