import { spawn } from 'bun';
import { release } from 'os';

async function isWSL(): Promise<boolean> {
	try {
		const osRelease = release().toLowerCase();
		if (osRelease.includes('microsoft') || osRelease.includes('wsl')) {
			return true;
		}

		const procVersion = Bun.file('/proc/version');
		if (await procVersion.exists()) {
			const content = await procVersion.text();
			return content.toLowerCase().includes('microsoft');
		}
		return false;
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
	} else if (platform === 'win32' || (await isWSL())) {
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
