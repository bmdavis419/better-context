import { Config } from '../config/index.ts';

import { ResourceError } from './helpers.ts';
import { loadGitResource } from './impls/git.ts';
import type { ResourceDefinition } from './schema.ts';
import type { BtcaFsResource, BtcaGitResourceArgs } from './types.ts';

export namespace Resources {
	export type Service = {
		load: (
			name: string,
			options?: {
				quiet?: boolean;
			}
		) => Promise<BtcaFsResource>;
	};

	const definitionToGitArgs = (
		definition: ResourceDefinition,
		resourcesDirectory: string,
		quiet: boolean
	): BtcaGitResourceArgs => ({
		type: 'git',
		name: definition.name,
		url: definition.url,
		branch: definition.branch,
		repoSubPath: definition.searchPath ?? '',
		resourcesDirectoryPath: resourcesDirectory,
		specialAgentInstructions: definition.specialNotes ?? '',
		quiet
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

				switch (definition.type) {
					case 'git':
						return loadGitResource(
							definitionToGitArgs(definition, config.resourcesDirectory, quiet)
						);
					default:
						throw new ResourceError({
							message: `Unsupported resource type: ${(definition as any).type}`
						});
				}
			}
		};
	};
}
