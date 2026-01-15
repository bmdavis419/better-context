import { Config } from '../config/index.ts';

import { ResourceError, resourceNameToKey } from './helpers.ts';
import { loadGitResource } from './impls/git.ts';
import {
	isGitResource,
	type ResourceDefinition,
	type GitResource,
	type LocalResource
} from './schema.ts';
import type { BtcaFsResource, BtcaGitResourceArgs, BtcaLocalResourceArgs } from './types.ts';

export namespace Resources {
	export type Service = {
		load: (
			name: string,
			options?: {
				quiet?: boolean;
			}
		) => Promise<BtcaFsResource>;
	};

	const normalizeSearchPaths = (definition: GitResource): string[] => {
		const paths = [
			...(definition.searchPaths ?? []),
			...(definition.searchPath ? [definition.searchPath] : [])
		];
		return paths.filter((path) => path.trim().length > 0);
	};

	const definitionToGitArgs = (
		definition: GitResource,
		resourcesDirectory: string,
		quiet: boolean
	): BtcaGitResourceArgs => ({
		type: 'git',
		name: definition.name,
		url: definition.url,
		branch: definition.branch,
		repoSubPaths: normalizeSearchPaths(definition),
		resourcesDirectoryPath: resourcesDirectory,
		specialAgentInstructions: definition.specialNotes ?? '',
		quiet,
		cloneStrategy: definition.cloneStrategy
	});

	const definitionToLocalArgs = (definition: LocalResource): BtcaLocalResourceArgs => ({
		type: 'local',
		name: definition.name,
		path: definition.path,
		specialAgentInstructions: definition.specialNotes ?? ''
	});

	const loadLocalResource = (args: BtcaLocalResourceArgs): BtcaFsResource => ({
		_tag: 'fs-based',
		name: args.name,
		fsName: resourceNameToKey(args.name),
		type: 'local',
		repoSubPaths: [],
		specialAgentInstructions: args.specialAgentInstructions,
		getAbsoluteDirectoryPath: async () => args.path
	});

	export const create = (config: Config.Service): Service => {
		const getDefinition = (name: string): ResourceDefinition => {
			const definition = config.getResource(name);
			if (!definition)
				throw new ResourceError({ message: `Resource \"${name}\" not found in config` });
			return definition;
		};

		return {
			load: async (name, options) => {
				const quiet = options?.quiet ?? false;
				const definition = getDefinition(name);

				if (isGitResource(definition)) {
					return loadGitResource(definitionToGitArgs(definition, config.resourcesDirectory, quiet));
				} else {
					return loadLocalResource(definitionToLocalArgs(definition));
				}
			}
		};
	};
}
