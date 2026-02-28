import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const CLI_DIR = fileURLToPath(new URL('..', import.meta.url));
const textFromProcessOutput = (value: Uint8Array | string | undefined) =>
	typeof value === 'string' ? value : value ? new TextDecoder().decode(value) : '';

const runCli = (argv: string[], timeout = 10_000) => {
	const result = Bun.spawnSync({
		cmd: ['bun', 'run', 'src/index.ts', ...argv],
		cwd: CLI_DIR,
		stdout: 'pipe',
		stderr: 'pipe',
		timeout
	});

	return {
		exitCode: result.exitCode,
		output: `${textFromProcessOutput(result.stdout)}${textFromProcessOutput(result.stderr)}`
	};
};

describe('cli dispatch', () => {
	test('keeps subcommand help contextual for btca add', () => {
		const result = runCli(['add', '--help']);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('Usage: btca add');
	});

	test('keeps nested subcommand help contextual for btca config model', () => {
		const result = runCli(['config', 'model', '--help']);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('Usage: btca config model');
	});

	test('rejects unknown top-level commands with a suggestion', () => {
		const result = runCli(['remoev'], 250);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("error: unknown command 'remoev'");
		expect(result.output).toContain("Did you mean 'remove'?");
	});

	test('rejects unknown top-level command with additional operands', () => {
		const result = runCli(['nonexistent', 'my-resource'], 250);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("error: unknown command 'nonexistent'");
		expect(result.output).not.toContain('error: invalid command invocation');
	});

	test('continues interactive behavior for no top-level command', () => {
		const result = runCli([], 250);
		expect(result.exitCode).toBeNull();
		expect(result.output).not.toContain('error: unknown command');
	});
});
