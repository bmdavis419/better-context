const authConfig = {
	providers: [
		{
			domain: process.env.CLERK_FRONTEND_API_URL,
			applicationID: 'convex'
		}
	]
};

export default authConfig;
