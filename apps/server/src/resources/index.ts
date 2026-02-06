export { ResourceError } from './helpers.ts';
export { Resources } from './service.ts';
export {
	GitResourceSchema,
	LocalResourceSchema,
	WebsiteResourceSchema,
	ResourceDefinitionSchema,
	isGitResource,
	isLocalResource,
	isWebsiteResource,
	type GitResource,
	type LocalResource,
	type WebsiteResource,
	type ResourceDefinition
} from './schema.ts';
export {
	FS_RESOURCE_SYSTEM_NOTE,
	type BtcaFsResource,
	type BtcaGitResourceArgs,
	type BtcaLocalResourceArgs,
	type BtcaWebsiteResourceArgs
} from './types.ts';
