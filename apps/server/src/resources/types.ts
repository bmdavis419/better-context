export const FS_RESOURCE_SYSTEM_NOTE =
	'This is a btca resource - a searchable knowledge source the agent can reference.';

export type BtcaFsResource = {
	readonly _tag: 'fs-based';
	readonly name: string;
	readonly type: 'git';
	readonly repoSubPath: string;
	readonly specialAgentInstructions: string;
	readonly getAbsoluteDirectoryPath: () => Promise<string>;
};

export type BtcaGitResourceArgs = {
	readonly type: 'git';
	readonly name: string;
	readonly url: string;
	readonly branch: string;
	readonly repoSubPath: string;
	readonly resourcesDirectoryPath: string;
	readonly specialAgentInstructions: string;
	readonly quiet: boolean;
};
