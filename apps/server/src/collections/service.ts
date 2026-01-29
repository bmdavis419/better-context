import path from 'node:path';

import { Result } from 'better-result';

import { Config } from '../config/index.ts';
import { Transaction } from '../context/transaction.ts';
import { CommonHints, getErrorHint, getErrorMessage } from '../errors.ts';
import { Metrics } from '../metrics/index.ts';
import { Resources } from '../resources/service.ts';
import { isGitResource } from '../resources/schema.ts';
import { FS_RESOURCE_SYSTEM_NOTE, type BtcaFsResource } from '../resources/types.ts';
import { CollectionError, getCollectionKey, type CollectionResult } from './types.ts';
import { VirtualFs } from '../vfs/virtual-fs.ts';
import {
	clearVirtualCollectionMetadata,
	setVirtualCollectionMetadata,
	type VirtualResourceMetadata
} from './virtual-metadata.ts';

export namespace Collections {
	export type Service = {
		load: (args: {
			resourceNames: readonly string[];
			quiet?: boolean;
		}) => Promise<CollectionResult>;
	};

	const createCollectionInstructionBlock = (resource: BtcaFsResource): string => {
		const focusLines = resource.repoSubPaths.map(
			(subPath) => `Focus: ./${resource.fsName}/${subPath}`
		);
		const lines = [
			`## Resource: ${resource.name}`,
			FS_RESOURCE_SYSTEM_NOTE,
			`Path: ./${resource.fsName}`,
			...focusLines,
			resource.specialAgentInstructions ? `Notes: ${resource.specialAgentInstructions}` : ''
		].filter(Boolean);

		return lines.join('\n');
	};

	const ignoreErrors = async (action: () => Promise<unknown>) => {
		const result = await Result.tryPromise(action);
		result.match({
			ok: () => undefined,
			err: () => undefined
		});
	};

	const initVirtualRoot = (collectionPath: string, vfsId: string) =>
		Result.tryPromise({
			try: () => VirtualFs.mkdir(collectionPath, { recursive: true }, vfsId),
			catch: (cause) =>
				new CollectionError({
					message: `Failed to initialize virtual collection root: "${collectionPath}"`,
					hint: 'Check that the virtual filesystem is available.',
					cause
				})
		});

	const loadResource = (resources: Resources.Service, name: string, quiet: boolean) =>
		Result.tryPromise({
			try: () => resources.load(name, { quiet }),
			catch: (cause) => {
				const underlyingHint = getErrorHint(cause);
				const underlyingMessage = getErrorMessage(cause);
				return new CollectionError({
					message: `Failed to load resource "${name}": ${underlyingMessage}`,
					hint:
						underlyingHint ??
						`${CommonHints.CLEAR_CACHE} Check that the resource "${name}" is correctly configured.`,
					cause
				});
			}
		});

	const resolveResourcePath = (resource: BtcaFsResource) =>
		Result.tryPromise({
			try: () => resource.getAbsoluteDirectoryPath(),
			catch: (cause) =>
				new CollectionError({
					message: `Failed to get path for resource "${resource.name}"`,
					hint: CommonHints.CLEAR_CACHE,
					cause
				})
		});

	const virtualizeResource = (args: {
		resource: BtcaFsResource;
		resourcePath: string;
		virtualResourcePath: string;
		vfsId: string;
	}) =>
		Result.tryPromise({
			try: () =>
				VirtualFs.importDirectoryFromDisk({
					sourcePath: args.resourcePath,
					destinationPath: args.virtualResourcePath,
					vfsId: args.vfsId,
					ignore: (relativePath) => {
						const normalized = relativePath.split(path.sep).join('/');
						return (
							normalized === '.git' ||
							normalized.startsWith('.git/') ||
							normalized.includes('/.git/')
						);
					}
				}),
			catch: (cause) =>
				new CollectionError({
					message: `Failed to virtualize resource "${args.resource.name}"`,
					hint: CommonHints.CLEAR_CACHE,
					cause
				})
		});

	const getGitHeadHash = async (resourcePath: string) => {
		const result = await Result.tryPromise(async () => {
			const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
				cwd: resourcePath,
				stdout: 'pipe',
				stderr: 'pipe'
			});
			const stdout = await new Response(proc.stdout).text();
			const exitCode = await proc.exited;
			if (exitCode !== 0) return undefined;
			const trimmed = stdout.trim();
			return trimmed.length > 0 ? trimmed : undefined;
		});

		return result.match({
			ok: (value) => value,
			err: () => undefined
		});
	};

	const buildVirtualMetadata = async (args: {
		resource: BtcaFsResource;
		resourcePath: string;
		loadedAt: string;
		definition?: ReturnType<Config.Service['getResource']>;
	}) => {
		if (!args.definition) return null;
		const base = {
			name: args.resource.name,
			fsName: args.resource.fsName,
			type: args.resource.type,
			path: args.resourcePath,
			repoSubPaths: args.resource.repoSubPaths,
			loadedAt: args.loadedAt
		};
		if (!isGitResource(args.definition)) return base;
		const commit = await getGitHeadHash(args.resourcePath);
		return {
			...base,
			url: args.definition.url,
			branch: args.definition.branch,
			commit
		};
	};

	export const create = (args: {
		config: Config.Service;
		resources: Resources.Service;
	}): Service => {
		return {
			load: ({ resourceNames, quiet = false }) =>
				Transaction.run('collections.load', async () => {
					const uniqueNames = Array.from(new Set(resourceNames));
					if (uniqueNames.length === 0)
						throw new CollectionError({
							message: 'Cannot create collection with no resources',
							hint: `${CommonHints.LIST_RESOURCES} ${CommonHints.ADD_RESOURCE}`
						});

					Metrics.info('collections.load', { resources: uniqueNames, quiet });

					const sortedNames = [...uniqueNames].sort((a, b) => a.localeCompare(b));
					const key = getCollectionKey(sortedNames);
					const collectionPath = '/';
					const vfsId = VirtualFs.create();
					const cleanupVirtual = () => {
						VirtualFs.dispose(vfsId);
						clearVirtualCollectionMetadata(vfsId);
					};

					const result = await Result.gen(async function* () {
						yield* Result.await(initVirtualRoot(collectionPath, vfsId));

						const loadedResources: BtcaFsResource[] = [];
						for (const name of sortedNames) {
							const resource = yield* Result.await(loadResource(args.resources, name, quiet));
							loadedResources.push(resource);
						}

						const metadataResources: VirtualResourceMetadata[] = [];
						const loadedAt = new Date().toISOString();
						for (const resource of loadedResources) {
							const resourcePath = yield* Result.await(resolveResourcePath(resource));
							const virtualResourcePath = path.posix.join('/', resource.fsName);

							await ignoreErrors(() =>
								VirtualFs.rm(virtualResourcePath, { recursive: true, force: true }, vfsId)
							);

							yield* Result.await(
								virtualizeResource({
									resource,
									resourcePath,
									virtualResourcePath,
									vfsId
								})
							);

							const definition = args.config.getResource(resource.name);
							const metadata = await buildVirtualMetadata({
								resource,
								resourcePath,
								loadedAt,
								definition
							});
							if (metadata) metadataResources.push(metadata);
						}

						setVirtualCollectionMetadata({
							vfsId,
							collectionKey: key,
							createdAt: loadedAt,
							resources: metadataResources
						});

						const instructionBlocks = loadedResources.map(createCollectionInstructionBlock);

						return Result.ok({
							path: collectionPath,
							agentInstructions: instructionBlocks.join('\n\n'),
							vfsId
						});
					});

					return result.match({
						ok: (value) => value,
						err: (error) => {
							cleanupVirtual();
							throw error;
						}
					});
				})
		};
	};
}
