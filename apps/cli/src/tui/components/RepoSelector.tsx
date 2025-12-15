import type { Repo } from '../types.ts';
import type { Colors } from '../theme.ts';

interface RepoSelectorProps {
	repos: Repo[];
	selectedIndex: number;
	currentRepo: number;
	searchQuery: string;
	colors: Colors;
}

export function RepoSelector({
	repos,
	selectedIndex,
	currentRepo,
	searchQuery,
	colors
}: RepoSelectorProps) {
	return (
		<box
			style={{
				position: 'absolute',
				bottom: 4,
				left: 0,
				width: '100%',
				zIndex: 100,
				backgroundColor: colors.bgSubtle,
				border: true,
				borderColor: colors.info,
				flexDirection: 'column',
				padding: 1
			}}
		>
			<text fg={colors.info} content=" Switch Repo" />
			<text fg={colors.textSubtle} content=" Type to search, arrow keys to navigate, Enter to select" />
			{searchQuery && (
				<box style={{ flexDirection: 'row', marginTop: 1 }}>
					<text fg={colors.textMuted} content=" Search: " />
					<text fg={colors.accent} content={searchQuery} />
				</box>
			)}
			<text content="" style={{ height: 1 }} />
			{repos.length === 0 ? (
				<text fg={colors.textSubtle} content="   No matching repos" />
			) : (
				repos.map((repo, i) => {
					const isSelected = i === selectedIndex;
					// Note: currentRepo is an index into the ORIGINAL repos array, not filtered
					// We can't directly compare, so we skip this indicator when filtering
					return (
						<box
							key={repo.name}
							style={{
								flexDirection: 'row'
							}}
						>
							<text
								fg={isSelected ? colors.accent : colors.text}
								content={isSelected ? ` ▸ ${repo.name}` : `   ${repo.name}`}
							/>
						</box>
					);
				})
			)}
		</box>
	);
}
