export const AnalyticsEvents = {
	USER_SIGNED_UP: 'user_signed_up',
	INSTANCE_CREATED: 'instance_created',

	CHECKOUT_STARTED: 'checkout_started',
	SUBSCRIPTION_CREATED: 'subscription_created',
	SUBSCRIPTION_UPDATED: 'subscription_updated',
	SUBSCRIPTION_CANCELED: 'subscription_canceled',
	BILLING_PORTAL_OPENED: 'billing_portal_opened',
	USAGE_LIMIT_REACHED: 'usage_limit_reached',

	STREAM_STARTED: 'stream_started',
	STREAM_COMPLETED: 'stream_completed',
	STREAM_FAILED: 'stream_failed',

	SANDBOX_PROVISIONING_STARTED: 'sandbox_provisioning_started',
	SANDBOX_PROVISIONED: 'sandbox_provisioned',
	SANDBOX_PROVISIONING_FAILED: 'sandbox_provisioning_failed',
	SANDBOX_WAKE_STARTED: 'sandbox_wake_started',
	SANDBOX_WOKE: 'sandbox_woke',
	SANDBOX_STOPPED: 'sandbox_stopped',
	SANDBOX_UPDATED: 'sandbox_updated',
	SANDBOX_DESTROYED: 'sandbox_destroyed',
	SANDBOX_RESET: 'sandbox_reset',

	THREAD_CREATED: 'thread_created',
	THREAD_DELETED: 'thread_deleted',
	THREAD_CLEARED: 'thread_cleared',

	RESOURCE_ADDED: 'resource_added',
	RESOURCE_REMOVED: 'resource_removed',

	API_KEY_CREATED: 'api_key_created',
	API_KEY_REVOKED: 'api_key_revoked',
	API_KEY_USED: 'api_key_used',

	INSTANCE_ERROR: 'instance_error',
	WEBHOOK_VERIFICATION_FAILED: 'webhook_verification_failed',
	SUBSCRIPTION_REQUIRED_SHOWN: 'subscription_required_shown',

	MCP_LIST_RESOURCES: 'mcp_list_resources',
	MCP_ASK: 'mcp_ask',
	MCP_ASK_FAILED: 'mcp_ask_failed'
} as const;
