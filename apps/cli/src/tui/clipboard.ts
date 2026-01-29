import { spawn } from 'bun';
import { Result } from 'better-result';

export async function copyToClipboard(text: string): Promise<void> {
	const platform = process.platform;

	if (platform === 'darwin') {
		const proc = spawn(['pbcopy'], { stdin: 'pipe' });
		proc.stdin.write(text);
		proc.stdin.end();
		await proc.exited;
	} else if (platform === 'linux') {
		// Try xclip first, fall back to xsel
		const runClipboard = (command: string[]) =>
			Result.tryPromise(async () => {
				const proc = spawn(command, { stdin: 'pipe' });
				proc.stdin.write(text);
				proc.stdin.end();
				await proc.exited;
			});

		const xclipResult = await runClipboard(['xclip', '-selection', 'clipboard']);
		if (xclipResult.isErr()) {
			const xselResult = await runClipboard(['xsel', '--clipboard', '--input']);
			if (xselResult.isErr()) {
				throw xselResult.error;
			}
		}
	} else if (platform === 'win32') {
		const proc = spawn(['clip'], { stdin: 'pipe' });
		proc.stdin.write(text);
		proc.stdin.end();
		await proc.exited;
	}
}
