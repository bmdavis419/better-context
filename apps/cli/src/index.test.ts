import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEffectCli } from './effect/cli-app.ts';

const CLI_DIR = fileURLToPath(new URL('..', import.meta.url));
const textFromProcessOutput = (value: Uint8Array | string | undefined) =>
	typeof value === 'string' ? value : value ? new TextDecoder().decode(value) : '';

const runCliAtCwd = (
	argv: string[],
	cwd: string,
	timeout = 10_000,
	env?: Record<string, string>
) => {
	const result = Bun.spawnSync({
		cmd: ['bun', 'run', path.join(CLI_DIR, 'src/index.ts'), ...argv],
		cwd,
		stdout: 'pipe',
		stderr: 'pipe',
		timeout,
		env: env ? { ...process.env, ...env } : process.env
	});

	return {
		exitCode: result.exitCode,
		output: `${textFromProcessOutput(result.stdout)}${textFromProcessOutput(result.stderr)}`
	};
};

const runCli = (argv: string[], timeout = 10_000, env?: Record<string, string>) =>
	runCliAtCwd(argv, CLI_DIR, timeout, env);

const withTempHome = async <T>(run: (tempHome: string) => Promise<T>): Promise<T> => {
	const tempHome = mkdtempSync(path.join(tmpdir(), 'btca-cli-test-'));
	const originalHome = process.env.HOME;
	process.env.HOME = tempHome;
	try {
		return await run(tempHome);
	} finally {
		process.env.HOME = originalHome;
		rmSync(tempHome, { recursive: true, force: true });
	}
};

const withTempDir = async <T>(run: (tempDir: string) => Promise<T>): Promise<T> => {
	const tempDir = mkdtempSync(path.join(tmpdir(), 'btca-cli-cwd-'));
	try {
		return await run(tempDir);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
};

const createStubServer = (handlers?: Partial<Record<string, (request: Request) => Response>>) => {
	const requestPaths: string[] = [];
	const defaultHandlers: Record<string, (request: Request) => Response> = {
		'/': () => Response.json({ ok: true }),
		'/resources': () =>
			Response.json({ error: 'stub resources error', tag: 'RequestError' }, { status: 500 }),
		'/config': () =>
			Response.json({ error: 'stub config error', tag: 'RequestError' }, { status: 500 }),
		'/providers': () =>
			Response.json({ error: 'stub providers error', tag: 'RequestError' }, { status: 500 })
	};
	const server = Bun.serve({
		port: 0,
		fetch: (request) => {
			const url = new URL(request.url);
			requestPaths.push(url.pathname);
			const handler = handlers?.[url.pathname] ?? defaultHandlers[url.pathname];
			if (handler) return handler(request);
			return Response.json({ error: 'stub not found', tag: 'RouteNotFound' }, { status: 404 });
		}
	});
	return {
		server,
		url: `http://127.0.0.1:${server.port}`,
		requestPaths
	};
};

describe('cli dispatch', () => {
	test('keeps subcommand help contextual for btca add', () => {
		const result = runCli(['add', '--help']);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('USAGE\n  btca add');
	});

	test('rejects unknown top-level commands with a suggestion', () => {
		const result = runCli(['remoev'], 750);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("error: unknown command 'remoev'");
		expect(result.output).toContain("Did you mean 'remove'?");
	});

	test('rejects unknown top-level command with additional operands', () => {
		const result = runCli(['nonexistent', 'my-resource'], 750);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("error: unknown command 'nonexistent'");
		expect(result.output).not.toContain('error: invalid command invocation');
	});

	test('continues interactive behavior for no top-level command', () => {
		const result = runCli([], 250);
		expect(result.exitCode).toBeNull();
		expect(result.output).not.toContain('error: unknown command');
	});

	test('returns non-zero for missing required ask flags', () => {
		const result = runCli(['ask']);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain('Missing required flag: --question');
	});

	test('returns non-zero for invalid telemetry subcommands', () => {
		const result = runCli(['telemetry', 'foo']);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain('Unknown subcommand "foo" for "btca telemetry"');
	});

	test('preserves helpful error when init config already exists', async () => {
		await withTempDir(async (tempDir) => {
			const configPath = path.join(tempDir, 'btca.config.jsonc');
			await Bun.write(configPath, '{}');

			const result = runCliAtCwd(['init'], tempDir);
			expect(result.exitCode).toBe(1);
			expect(result.output).toContain('btca.config.jsonc already exists at ');
			expect(result.output).toContain('btca.config.jsonc. Use --force to overwrite.');
			expect(result.output).not.toContain('An error occurred in Effect.tryPromise');
		});
	});

	test('forwards subcommand --server to resources command', async () => {
		const stub = createStubServer();
		try {
			const exitCode = await withTempHome(() =>
				runEffectCli(['bun', 'src/index.ts', 'resources', '--server', stub.url], 'test')
			);
			expect(exitCode).toBe(1);
			expect(stub.requestPaths).toContain('/');
			expect(stub.requestPaths).toContain('/resources');
		} finally {
			stub.server.stop();
		}
	});

	test('forwards root --server to status command', async () => {
		const stub = createStubServer();
		try {
			const exitCode = await withTempHome(() =>
				runEffectCli(['bun', 'src/index.ts', '--server', stub.url, 'status'], 'test')
			);
			expect(exitCode).toBe(1);
			expect(stub.requestPaths).toContain('/');
			expect(stub.requestPaths).toContain('/config');
		} finally {
			stub.server.stop();
		}
	});

	test('preserves backend error messages for resources command', async () => {
		const stub = createStubServer();
		const originalError = console.error;
		const output: string[] = [];
		console.error = (...args) => {
			output.push(args.map((arg) => String(arg)).join(' '));
		};
		try {
			const exitCode = await withTempHome(() =>
				runEffectCli(['bun', 'src/index.ts', 'resources', '--server', stub.url], 'test')
			);
			expect(exitCode).toBe(1);
			expect(output.join('\n')).toContain('stub resources error');
			expect(output.join('\n')).not.toContain('An error occurred in Effect.tryPromise');
		} finally {
			console.error = originalError;
			stub.server.stop();
		}
	});

	test('preserves backend error messages for add command', async () => {
		const stub = createStubServer({
			'/config/resources': () =>
				Response.json(
					{
						error: 'Resource "svelte" already exists',
						tag: 'ConfigError',
						hint: 'Choose a different resource name.'
					},
					{ status: 400 }
				)
		});
		const originalError = console.error;
		const output: string[] = [];
		console.error = (...args) => {
			output.push(args.map((arg) => String(arg)).join(' '));
		};
		try {
			const exitCode = await withTempHome(() =>
				runEffectCli(
					[
						'bun',
						'src/index.ts',
						'add',
						'.',
						'--name',
						'svelte',
						'--type',
						'local',
						'--server',
						stub.url
					],
					'test'
				)
			);
			expect(exitCode).toBe(1);
			expect(stub.requestPaths).toContain('/config/resources');
			expect(output.join('\n')).toContain('Resource "svelte" already exists');
			expect(output.join('\n')).toContain('Hint: Choose a different resource name.');
			expect(output.join('\n')).not.toContain('An error occurred in Effect.tryPromise');
		} finally {
			console.error = originalError;
			stub.server.stop();
		}
	});
});
