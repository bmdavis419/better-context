export type UsageMetric = {
	remainingPct: number;
	usedPct: number;
	isDepleted: boolean;
};

export type BillingSummary = {
	plan: 'pro' | 'free' | 'none';
	status: 'active' | 'trialing' | 'canceled' | 'none';
	currentPeriodEnd?: number;
	canceledAt?: number;
	customer?: {
		name?: string | null;
		email?: string | null;
	};
	paymentMethod?: {
		type: string;
		card?: {
			brand: string;
			last4: string;
			exp_month: number;
			exp_year: number;
		};
	} | null;
	usage: {
		aiBudget: UsageMetric;
	};
	freeMessages?: {
		used: number;
		total: number;
		remaining: number;
	};
};
