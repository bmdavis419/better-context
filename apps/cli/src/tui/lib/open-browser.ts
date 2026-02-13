import { spawn } from 'bun';

export const openBrowser = async (url: string) => {
	if (process.platform === 'darwin') {
		const proc = spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
		await proc.exited;
		return;
	}
	if (process.platform === 'win32') {
		const proc = spawn(['cmd', '/c', 'start', '', url], { stdout: 'ignore', stderr: 'ignore' });
		await proc.exited;
		return;
	}
	const proc = spawn(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore' });
	await proc.exited;
};
