interface Colors {
	bg: string;
	bgSubtle: string;
	bgMuted: string;
	text: string;
	textMuted: string;
	textSubtle: string;
	border: string;
	accent: string;
	info: string;
}

interface RepoSelectorProps {
	repos: string[];
	selectedIndex: number;
	currentRepo: number;
	colors: Colors;
}

export function RepoSelector({ repos, selectedIndex, currentRepo, colors }: RepoSelectorProps) {
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
			<text fg={colors.textSubtle} content=" Use arrow keys to select, Enter to confirm" />
			<text content="" style={{ height: 1 }} />
			{repos.map((repo, i) => {
				const isSelected = i === selectedIndex;
				const isCurrent = i === currentRepo;
				return (
					<box
						key={repo}
						style={{
							flexDirection: 'row'
						}}
					>
						<text
							fg={isSelected ? colors.accent : colors.text}
							content={isSelected ? ` ▸ ${repo}` : `   ${repo}`}
						/>
						{isCurrent && <text fg={colors.textSubtle} content=" (current)" />}
					</box>
				);
			})}
		</box>
	);
}
