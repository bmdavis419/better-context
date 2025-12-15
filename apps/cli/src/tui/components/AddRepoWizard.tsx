import type { Colors } from '../theme.ts';
import type { Repo } from '../types.ts';

export type WizardStep = 'name' | 'url' | 'branch' | 'notes' | 'confirm';

interface AddRepoWizardProps {
	step: WizardStep;
	values: {
		name: string;
		url: string;
		branch: string;
		notes: string;
	};
	currentInput: string;
	onInput: (value: string) => void;
	onSubmit: () => void;
	colors: Colors;
}

const STEP_INFO: Record<WizardStep, { title: string; hint: string; placeholder: string }> = {
	name: {
		title: 'Step 1/4: Repository Name',
		hint: 'Enter a unique name for this repo (e.g., "react", "svelte-docs")',
		placeholder: 'repo-name'
	},
	url: {
		title: 'Step 2/4: Repository URL',
		hint: 'Enter the GitHub repository URL',
		placeholder: 'https://github.com/owner/repo'
	},
	branch: {
		title: 'Step 3/4: Branch',
		hint: 'Enter the branch to clone (press Enter for "main")',
		placeholder: 'main'
	},
	notes: {
		title: 'Step 4/4: Special Notes (Optional)',
		hint: 'Any special notes for the AI? Press Enter to skip',
		placeholder: 'e.g., "This is the docs website, not the library"'
	},
	confirm: {
		title: 'Confirm',
		hint: 'Press Enter to add repo, Esc to cancel',
		placeholder: ''
	}
};

export function AddRepoWizard({
	step,
	values,
	currentInput,
	onInput,
	onSubmit,
	colors
}: AddRepoWizardProps) {
	const info = STEP_INFO[step];

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
			<text fg={colors.info} content={` Add Repo - ${info.title}`} />
			<text fg={colors.textSubtle} content={` ${info.hint}`} />
			<text content="" style={{ height: 1 }} />

			{step === 'confirm' ? (
				<box style={{ flexDirection: 'column', paddingLeft: 1 }}>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Name:   " style={{ width: 10 }} />
						<text fg={colors.text} content={values.name} />
					</box>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="URL:    " style={{ width: 10 }} />
						<text fg={colors.text} content={values.url} />
					</box>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Branch: " style={{ width: 10 }} />
						<text fg={colors.text} content={values.branch || 'main'} />
					</box>
					{values.notes && (
						<box style={{ flexDirection: 'row' }}>
							<text fg={colors.textMuted} content="Notes:  " style={{ width: 10 }} />
							<text fg={colors.text} content={values.notes} />
						</box>
					)}
					<text content="" style={{ height: 1 }} />
					<text fg={colors.success} content=" Press Enter to confirm, Esc to cancel" />
				</box>
			) : (
				<box style={{}}>
					<input
						placeholder={info.placeholder}
						placeholderColor={colors.textSubtle}
						textColor={colors.text}
						value={currentInput}
						onInput={onInput}
						onSubmit={onSubmit}
						focused
						style={{ width: '100%' }}
					/>
				</box>
			)}
		</box>
	);
}
