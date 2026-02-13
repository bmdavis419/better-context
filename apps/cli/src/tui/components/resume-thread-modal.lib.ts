export const normalizeResumeThreadLabel = (title?: string) => {
	const label = title?.trim() ? title.trim() : 'Untitled thread';
	return label.replace(/\s+/g, ' ');
};

export const getVisibleRangeStart = (input: {
	selectedIndex: number;
	maxVisibleItems: number;
	totalItems: number;
}) => {
	const maxVisibleItems = Math.max(1, input.maxVisibleItems);
	const maxStart = Math.max(input.totalItems - maxVisibleItems, 0);
	const centeredStart = input.selectedIndex - Math.floor(maxVisibleItems / 2);
	return Math.max(0, Math.min(centeredStart, maxStart));
};
