import { spawn } from 'bun';
import { Result } from 'better-result';

const isWsl = async () => {
	if (process.platform !== 'linux') return false;
	if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP || process.env.WSLENV) return true;

	try {
		const procVersion = Bun.file('/proc/version');
		if (!(await procVersion.exists())) return false;
		const content = await procVersion.text();
		return content.toLowerCase().includes('microsoft');
	} catch {
		return false;
	}
};

const isWayland = () => {
	return !!process.env.WAYLAND_DISPLAY;
};

export async function copyToClipboard(text: string) {
	const platform = process.platform;

	if (platform === 'darwin') {
		const proc = spawn(['pbcopy'], { stdin: 'pipe' });
		proc.stdin.write(text);
		proc.stdin.end();
		await proc.exited;
	} else if (platform === 'win32') {
		const proc = spawn(['clip.exe'], { stdin: 'pipe' });
		proc.stdin.write(text);
		proc.stdin.end();
		await proc.exited;
	} else if (platform === 'linux') {
		const runClipboard = (command: string[]) =>
			Result.tryPromise(async () => {
				const proc = spawn(command, { stdin: 'pipe' });
				proc.stdin.write(text);
				proc.stdin.end();
				await proc.exited;
			});

		if (await isWsl()) {
			const clipResult = await runClipboard(['clip.exe']);
			if (!clipResult.isErr()) return;
			const clipPathResult = await runClipboard(['/mnt/c/Windows/System32/clip.exe']);
			if (!clipPathResult.isErr()) return;
		}

		if (isWayland()) {
			const wlCopyResult = await runClipboard(['wl-copy']);
			if (!wlCopyResult.isErr()) return;
		}

		// Try xclip first, fall back to xsel
		const xclipResult = await runClipboard(['xclip', '-selection', 'clipboard']);
		if (xclipResult.isErr()) {
			const xselResult = await runClipboard(['xsel', '--clipboard', '--input']);
			if (xselResult.isErr()) {
				throw xselResult.error;
			}
		}
	}
}
