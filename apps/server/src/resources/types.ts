export const FS_RESOURCE_SYSTEM_NOTE =
	'This is a btca resource - a searchable knowledge source the agent can reference.';

export type BtcaFsResource = {
	readonly _tag: 'fs-based';
	readonly name: string;
	readonly fsName: string;
	readonly type: 'git' | 'local';
	readonly repoSubPaths: readonly string[];
	readonly specialAgentInstructions: string;
	readonly getAbsoluteDirectoryPath: () => Promise<string>;
};

export type BtcaGitResourceArgs = {
	readonly type: 'git';
	readonly name: string;
	readonly url: string;
	readonly branch: string;
	readonly repoSubPaths: readonly string[];
	readonly resourcesDirectoryPath: string;
	readonly specialAgentInstructions: string;
	readonly quiet: boolean;
	readonly cloneStrategy?: 'git' | 'gitpick';
};

export type BtcaLocalResourceArgs = {
	readonly type: 'local';
	readonly name: string;
	readonly path: string;
	readonly specialAgentInstructions: string;
};
