import { spawn } from 'bun';

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

export const getOsc52Sequence = (text: string) => {
	const encoded = Buffer.from(text, 'utf8').toString('base64');
	return `\u001b]52;c;${encoded}\u0007`;
};

export const tryOsc52Copy = (
	text: string,
	options: {
		isTTY?: boolean;
		term?: string;
		write?: (value: string) => unknown;
	} = {}
) => {
	const isTTY = options.isTTY ?? process.stdout.isTTY;
	const term = options.term ?? process.env.TERM;
	const write = options.write ?? ((value: string) => process.stdout.write(value));

	if (!isTTY) return false;
	if (term === 'dumb') return false;

	try {
		// OSC52 allows terminals to copy text to the system clipboard without external binaries.
		write(getOsc52Sequence(text));
		return true;
	} catch {
		return false;
	}
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
		const runClipboard = async (command: string[]) => {
			try {
				const proc = spawn(command, { stdin: 'pipe' });
				proc.stdin.write(text);
				proc.stdin.end();
				await proc.exited;
				return true;
			} catch {
				return false;
			}
		};

		if (await isWsl()) {
			const clipResult = await runClipboard(['clip.exe']);
			if (clipResult) return;
			const clipPathResult = await runClipboard(['/mnt/c/Windows/System32/clip.exe']);
			if (clipPathResult) return;
		}

		if (isWayland()) {
			const wlCopyResult = await runClipboard(['wl-copy']);
			if (wlCopyResult) return;
		}

		// Try xclip first, fall back to xsel
		const xclipResult = await runClipboard(['xclip', '-selection', 'clipboard']);
		if (xclipResult) return;

		const xselResult = await runClipboard(['xsel', '--clipboard', '--input']);
		if (xselResult) return;

		const osc52Result = tryOsc52Copy(text);
		if (!osc52Result) {
			throw new Error(
				'Failed to copy to clipboard: no compatible clipboard command succeeded and terminal OSC52 fallback is unavailable.'
			);
		}
	}
}
