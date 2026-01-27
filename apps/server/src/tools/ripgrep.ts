/**
 * Ripgrep Binary Management
 * Handles downloading and caching the ripgrep binary
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export namespace Ripgrep {
	const VERSION = '14.1.1';

	// Platform configurations
	const PLATFORM_CONFIG: Record<
		string,
		{ platform: string; extension: 'tar.gz' | 'zip'; binaryName: string }
	> = {
		'darwin-arm64': {
			platform: 'aarch64-apple-darwin',
			extension: 'tar.gz',
			binaryName: 'rg'
		},
		'darwin-x64': {
			platform: 'x86_64-apple-darwin',
			extension: 'tar.gz',
			binaryName: 'rg'
		},
		'linux-arm64': {
			platform: 'aarch64-unknown-linux-gnu',
			extension: 'tar.gz',
			binaryName: 'rg'
		},
		'linux-x64': {
			platform: 'x86_64-unknown-linux-musl',
			extension: 'tar.gz',
			binaryName: 'rg'
		},
		'win32-x64': {
			platform: 'x86_64-pc-windows-msvc',
			extension: 'zip',
			binaryName: 'rg.exe'
		}
	};

	/**
	 * Get the btca data directory
	 */
	function getDataPath(): string {
		const platform = os.platform();

		if (platform === 'win32') {
			const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
			return path.join(appdata, 'btca');
		}

		// Linux and macOS use XDG_DATA_HOME or ~/.local/share
		const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
		return path.join(xdgData, 'btca');
	}

	/**
	 * Get the bin directory for storing binaries
	 */
	function getBinPath(): string {
		return path.join(getDataPath(), 'bin');
	}

	/**
	 * Get the expected ripgrep binary path
	 */
	function getRipgrepPath(): string {
		const platform = os.platform();
		const binaryName = platform === 'win32' ? 'rg.exe' : 'rg';
		return path.join(getBinPath(), binaryName);
	}

	/**
	 * Check if ripgrep is already installed in PATH
	 */
	async function findInPath(): Promise<string | null> {
		const rgPath = Bun.which('rg');
		return rgPath || null;
	}

	/**
	 * Check if our cached ripgrep binary exists
	 */
	async function findCached(): Promise<string | null> {
		const rgPath = getRipgrepPath();
		const file = Bun.file(rgPath);
		if (await file.exists()) {
			return rgPath;
		}
		return null;
	}

	/**
	 * Get the platform configuration
	 */
	function getPlatformConfig(): (typeof PLATFORM_CONFIG)[string] | null {
		const platform = os.platform();
		const arch = os.arch();
		const key = `${platform}-${arch}`;
		return PLATFORM_CONFIG[key] || null;
	}

	/**
	 * Download ripgrep from GitHub releases
	 */
	async function download(): Promise<string> {
		const config = getPlatformConfig();
		if (!config) {
			throw new Error(`Unsupported platform: ${os.platform()}-${os.arch()}`);
		}

		const binDir = getBinPath();
		const rgPath = getRipgrepPath();

		// Ensure bin directory exists
		await fs.mkdir(binDir, { recursive: true });

		// Build download URL
		const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`;
		const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`;

		console.log(`Downloading ripgrep from ${url}...`);

		// Download the archive
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download ripgrep: ${response.status} ${response.statusText}`);
		}

		const buffer = await response.arrayBuffer();
		const archivePath = path.join(binDir, filename);

		// Write archive to disk
		await Bun.write(archivePath, buffer);

		// Extract based on file type
		if (config.extension === 'tar.gz') {
			// Extract tar.gz
			const proc = Bun.spawn(['tar', '-xzf', archivePath, '--strip-components=1', '-C', binDir], {
				cwd: binDir,
				stdout: 'pipe',
				stderr: 'pipe'
			});
			await proc.exited;

			if (proc.exitCode !== 0) {
				throw new Error(`Failed to extract ripgrep: exit code ${proc.exitCode}`);
			}
		} else {
			// Extract zip (Windows)
			// Use unzip if available, otherwise use Bun's built-in zip handling
			const proc = Bun.spawn(['unzip', '-o', archivePath, '-d', binDir], {
				cwd: binDir,
				stdout: 'pipe',
				stderr: 'pipe'
			});
			await proc.exited;

			if (proc.exitCode !== 0) {
				throw new Error(`Failed to extract ripgrep: exit code ${proc.exitCode}`);
			}
		}

		// Clean up archive
		await fs.unlink(archivePath).catch(() => {});

		// Make binary executable (Unix only)
		if (os.platform() !== 'win32') {
			await fs.chmod(rgPath, 0o755);
		}

		console.log(`Ripgrep installed to ${rgPath}`);

		return rgPath;
	}

	/**
	 * Get the path to the ripgrep binary
	 * Downloads it if not found in PATH or cache
	 */
	export async function filepath(): Promise<string> {
		// First check PATH
		const inPath = await findInPath();
		if (inPath) {
			return inPath;
		}

		// Then check cache
		const cached = await findCached();
		if (cached) {
			return cached;
		}

		// Download if not found
		return download();
	}

	/**
	 * Run ripgrep with the given arguments
	 */
	export async function run(
		args: string[],
		options: { cwd?: string } = {}
	): Promise<{
		stdout: string;
		stderr: string;
		exitCode: number;
	}> {
		const rgPath = await filepath();

		const proc = Bun.spawn([rgPath, ...args], {
			cwd: options.cwd || process.cwd(),
			stdout: 'pipe',
			stderr: 'pipe'
		});

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited
		]);

		return { stdout, stderr, exitCode };
	}

	/**
	 * Generator that yields file paths matching a glob pattern
	 */
	export async function* files(options: {
		cwd: string;
		glob?: string[];
		hidden?: boolean;
	}): AsyncGenerator<string> {
		const rgPath = await filepath();

		const args = ['--files', '--follow', '--no-messages'];

		if (options.hidden) {
			args.push('--hidden');
		}

		if (options.glob) {
			for (const pattern of options.glob) {
				args.push('--glob', pattern);
			}
		}

		const proc = Bun.spawn([rgPath, ...args], {
			cwd: options.cwd,
			stdout: 'pipe',
			stderr: 'pipe'
		});

		const stdout = await new Response(proc.stdout).text();
		await proc.exited;

		for (const line of stdout.trim().split('\n')) {
			if (line) {
				yield line;
			}
		}
	}

	/**
	 * Search for a pattern in files
	 */
	export async function search(options: {
		cwd: string;
		pattern: string;
		glob?: string;
		hidden?: boolean;
		maxResults?: number;
	}): Promise<
		Array<{
			path: string;
			lineNumber: number;
			lineText: string;
		}>
	> {
		const rgPath = await filepath();

		const args = [
			'-n', // line numbers
			'-H', // filename
			'--follow', // follow symlinks
			'--no-messages', // suppress errors
			'--field-match-separator=|' // use | as separator
		];

		if (options.hidden) {
			args.push('--hidden');
		}

		if (options.glob) {
			args.push('--glob', options.glob);
		}

		args.push('--regexp', options.pattern);

		const proc = Bun.spawn([rgPath, ...args], {
			cwd: options.cwd,
			stdout: 'pipe',
			stderr: 'pipe'
		});

		const stdout = await new Response(proc.stdout).text();
		await proc.exited;

		const results: Array<{
			path: string;
			lineNumber: number;
			lineText: string;
		}> = [];

		for (const line of stdout.trim().split('\n')) {
			if (!line) continue;

			// Parse format: filepath|lineNum|lineText
			const firstPipe = line.indexOf('|');
			if (firstPipe === -1) continue;

			const secondPipe = line.indexOf('|', firstPipe + 1);
			if (secondPipe === -1) continue;

			const filePath = line.substring(0, firstPipe);
			const lineNumStr = line.substring(firstPipe + 1, secondPipe);
			const lineText = line.substring(secondPipe + 1);

			const lineNumber = parseInt(lineNumStr, 10);
			if (isNaN(lineNumber)) continue;

			results.push({
				path: path.resolve(options.cwd, filePath),
				lineNumber,
				lineText
			});

			if (options.maxResults && results.length >= options.maxResults) {
				break;
			}
		}

		return results;
	}
}
