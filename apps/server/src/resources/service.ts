import { Config } from '../config/index.ts';

import { ResourceError, resourceNameToKey } from './helpers.ts';
import { loadGitResource } from './impls/git.ts';
import { loadWebsiteResource } from './impls/website.ts';
import {
	isGitResource,
	isWebsiteResource,
	type ResourceDefinition,
	type GitResource,
	type LocalResource,
	type WebsiteResource
} from './schema.ts';
import type {
	BtcaFsResource,
	BtcaGitResourceArgs,
	BtcaLocalResourceArgs,
	BtcaWebsiteResourceArgs
} from './types.ts';

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
		quiet
	});

	const definitionToLocalArgs = (definition: LocalResource): BtcaLocalResourceArgs => ({
		type: 'local',
		name: definition.name,
		path: definition.path,
		specialAgentInstructions: definition.specialNotes ?? ''
	});

	const definitionToWebsiteArgs = (
		definition: WebsiteResource,
		resourcesDirectory: string,
		quiet: boolean
	): BtcaWebsiteResourceArgs => ({
		type: 'website',
		name: definition.name,
		url: definition.url,
		maxPages: definition.maxPages,
		maxDepth: definition.maxDepth,
		ttlHours: definition.ttlHours,
		resourcesDirectoryPath: resourcesDirectory,
		specialAgentInstructions: definition.specialNotes ?? '',
		quiet
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
				}
				if (isWebsiteResource(definition)) {
					return loadWebsiteResource(
						definitionToWebsiteArgs(definition, config.resourcesDirectory, quiet)
					);
				}
				return loadLocalResource(definitionToLocalArgs(definition));
			}
		};
	};
}
