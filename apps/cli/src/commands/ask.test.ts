import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerSignalCleanup, streamErrorToBtcaError } from './ask.ts';
import { runEffectCli } from '../effect/cli-app.ts';

type SignalEvent = 'SIGINT' | 'SIGTERM' | 'exit';
type ForwardedSignal = 'SIGINT' | 'SIGTERM';

const createMockProcess = ({ throwOnKill = false } = {}) => {
	const listeners = new Map<SignalEvent, () => void>();
	const killCalls: Array<{ pid: number; signal: ForwardedSignal }> = [];
	const exitCalls: number[] = [];
	const offCalls: SignalEvent[] = [];

	const mock = {
		pid: 4242,
		once: (event: SignalEvent, listener: () => void) => {
			listeners.set(event, listener);
		},
		off: (event: SignalEvent, listener: () => void) => {
			offCalls.push(event);
			if (listeners.get(event) === listener) listeners.delete(event);
		},
		kill: (pid: number, signal: ForwardedSignal) => {
			killCalls.push({ pid, signal });
			if (throwOnKill) throw new Error('kill failed');
			return true;
		},
		exit: (code = 0) => {
			exitCalls.push(code);
		}
	};

	const emit = (event: SignalEvent) => {
		const listener = listeners.get(event);
		if (!listener) return;
		listeners.delete(event);
		listener();
	};

	return { mock, emit, listeners, killCalls, exitCalls, offCalls };
};

const withTempHome = async <T>(run: (tempHome: string) => Promise<T>): Promise<T> => {
	const tempHome = mkdtempSync(path.join(tmpdir(), 'btca-ask-test-'));
	const originalHome = process.env.HOME;
	process.env.HOME = tempHome;
	try {
		return await run(tempHome);
	} finally {
		process.env.HOME = originalHome;
		rmSync(tempHome, { recursive: true, force: true });
	}
};

const createAskStubServer = () => {
	const encoder = new TextEncoder();
	const requestPaths: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch: (request) => {
			const url = new URL(request.url);
			requestPaths.push(url.pathname);

			if (url.pathname === '/') return Response.json({ ok: true });
			if (url.pathname === '/config') {
				return Response.json({
					provider: 'opencode',
					model: 'claude-haiku-4-5',
					providerTimeoutMs: 300000,
					maxSteps: 40,
					resourcesDirectory: '/tmp/resources',
					resourceCount: 1
				});
			}
			if (url.pathname === '/resources') {
				return Response.json({
					resources: [
						{
							type: 'git',
							name: 'chipwhisperer',
							url: 'https://github.com/newaetech/chipwhisperer',
							branch: 'develop'
						}
					]
				});
			}
			if (url.pathname === '/question/stream') {
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'meta' })}\n\n`));
							controller.enqueue(
								encoder.encode(
									`data: ${JSON.stringify({
										type: 'error',
										message: 'Provider "opencode" is not authenticated.',
										tag: 'ProviderNotAuthenticatedError'
									})}\n\n`
								)
							);
							controller.close();
						}
					}),
					{
						headers: {
							'Content-Type': 'text/event-stream'
						}
					}
				);
			}

			return Response.json({ error: 'not found' }, { status: 404 });
		}
	});

	return {
		server,
		url: `http://127.0.0.1:${server.port}`,
		requestPaths
	};
};

describe('registerSignalCleanup', () => {
	test('stops server and re-signals on SIGINT', () => {
		let stopCalls = 0;
		const proc = createMockProcess();
		const teardown = registerSignalCleanup(() => {
			stopCalls += 1;
		}, proc.mock);

		proc.emit('SIGINT');

		expect(stopCalls).toBe(1);
		expect(proc.killCalls).toEqual([{ pid: 4242, signal: 'SIGINT' }]);
		expect(proc.exitCalls).toEqual([]);
		expect(proc.listeners.size).toBe(0);

		teardown();
		expect(stopCalls).toBe(1);
	});

	test('falls back to signal-style exit code when kill throws', () => {
		let stopCalls = 0;
		const proc = createMockProcess({ throwOnKill: true });
		registerSignalCleanup(() => {
			stopCalls += 1;
		}, proc.mock);

		proc.emit('SIGTERM');

		expect(stopCalls).toBe(1);
		expect(proc.killCalls).toEqual([{ pid: 4242, signal: 'SIGTERM' }]);
		expect(proc.exitCalls).toEqual([143]);
	});

	test('teardown removes listeners and cleans up once', () => {
		let stopCalls = 0;
		const proc = createMockProcess();
		const teardown = registerSignalCleanup(() => {
			stopCalls += 1;
		}, proc.mock);

		teardown();
		teardown();
		proc.emit('SIGINT');

		expect(stopCalls).toBe(1);
		expect(proc.killCalls).toEqual([]);
		expect(proc.listeners.size).toBe(0);
		expect(proc.offCalls).toEqual(['SIGINT', 'SIGTERM', 'exit', 'SIGINT', 'SIGTERM', 'exit']);
	});
});

describe('streamErrorToBtcaError', () => {
	test('preserves explicit hint from stream error event', () => {
		const error = streamErrorToBtcaError('boom', 'UnknownError', 'use this hint');
		expect(error.message).toBe('boom');
		expect(error.hint).toBe('use this hint');
		expect(error.tag).toBe('UnknownError');
	});

	test('adds auth hint for unauthenticated provider stream errors', () => {
		const error = streamErrorToBtcaError(
			'Provider "opencode" is not authenticated.',
			'ProviderNotAuthenticatedError'
		);
		expect(error.message).toBe('Provider "opencode" is not authenticated.');
		expect(error.hint).toBe('run btca connect to authenticate and pick a model.');
		expect(error.tag).toBe('ProviderNotAuthenticatedError');
	});
});

describe('ask command streaming errors', () => {
	test('surfaces provider auth errors from SSE responses', async () => {
		const stub = createAskStubServer();
		const originalLog = console.log;
		const originalError = console.error;
		const output: string[] = [];
		console.log = (...args) => {
			output.push(args.map((arg) => String(arg)).join(' '));
		};
		console.error = (...args) => {
			output.push(args.map((arg) => String(arg)).join(' '));
		};

		try {
			const exitCode = await withTempHome(() =>
				runEffectCli(
					[
						'bun',
						'src/index.ts',
						'ask',
						'--server',
						stub.url,
						'--question',
						'What is this repo?',
						'--resource',
						'chipwhisperer'
					],
					'test'
				)
			);

			expect(exitCode).toBe(1);
			expect(stub.requestPaths).toContain('/question/stream');
			expect(output.join('\n')).toContain('Provider "opencode" is not authenticated.');
			expect(output.join('\n')).toContain(
				'Hint: run btca connect to authenticate and pick a model.'
			);
			expect(output.join('\n')).not.toContain('An error occurred in Effect.tryPromise');
		} finally {
			console.log = originalLog;
			console.error = originalError;
			stub.server.stop();
		}
	});
});
