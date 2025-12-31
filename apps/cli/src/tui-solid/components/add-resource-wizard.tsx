import { createSignal, createEffect, Show, type Component, type Setter } from 'solid-js';
import { colors } from '../theme.ts';
import { useKeyboard, usePaste } from '@opentui/solid';
import { useConfigContext } from '../context/config-context.tsx';
import { useMessagesContext } from '../context/messages-context.tsx';
import { services } from '../services.ts';
import type { Repo } from '../types.ts';
import type { WizardStep } from './input-section.tsx';

type AddRepoWizardStep = 'name' | 'url' | 'branch' | 'notes' | 'confirm';

const STEP_INFO: Record<AddRepoWizardStep, { title: string; hint: string; placeholder: string }> = {
	name: {
		title: 'Step 1/4: Resource Name',
		hint: 'Enter a unique name for this resource (e.g., "react", "svelteDocs")',
		placeholder: 'resourceName'
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

interface AddResourceWizardProps {
	onClose: () => void;
	onStepChange: Setter<WizardStep>;
}

export const AddResourceWizard: Component<AddResourceWizardProps> = (props) => {
	const config = useConfigContext();
	const messages = useMessagesContext();

	// All wizard state is LOCAL
	const [step, setStep] = createSignal<AddRepoWizardStep>('name');
	const [values, setValues] = createSignal({ name: '', url: '', branch: '', notes: '' });
	const [wizardInput, setWizardInput] = createSignal('');

	const info = () => STEP_INFO[step()];

	// Notify parent of step changes for status bar
	createEffect(() => {
		props.onStepChange(step());
	});

	useKeyboard((key) => {
		if (key.name === 'c' && key.ctrl) {
			if (wizardInput().length === 0) {
				props.onClose();
			} else {
				setWizardInput('');
			}
		}
	});

	usePaste(({ text }) => {
		setWizardInput(text);
	});

	const handleSubmit = async () => {
		const currentStep = step();
		const value = wizardInput().trim();

		if (currentStep === 'name') {
			if (!value) return;
			setValues({ ...values(), name: value });
			setStep('url');
			setWizardInput('');
		} else if (currentStep === 'url') {
			if (!value) return;
			setValues({ ...values(), url: value });
			setStep('branch');
			setWizardInput('main');
		} else if (currentStep === 'branch') {
			setValues({ ...values(), branch: value || 'main' });
			setStep('notes');
			setWizardInput('');
		} else if (currentStep === 'notes') {
			setValues({ ...values(), notes: value });
			setStep('confirm');
		} else if (currentStep === 'confirm') {
			const vals = values();
			const newRepo: Repo = {
				name: vals.name,
				url: vals.url,
				branch: vals.branch || 'main',
				...(vals.notes && { specialNotes: vals.notes })
			};

			try {
				await services.addRepo(newRepo);
				config.addRepo(newRepo);
				messages.addSystemMessage(`Added repo: ${newRepo.name}`);
			} catch (error) {
				messages.addSystemMessage(`Error: ${error}`);
			} finally {
				props.onClose();
			}
		}
	};

	useKeyboard((key) => {
		if (key.name === 'escape') {
			props.onClose();
		} else if (key.name === 'return' && step() === 'confirm') {
			handleSubmit();
		}
	});

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
			<text fg={colors.info} content={` Add Repo - ${info().title}`} />
			<text fg={colors.textSubtle} content={` ${info().hint}`} />
			<text content="" style={{ height: 1 }} />

			<Show
				when={step() === 'confirm'}
				fallback={
					<box style={{}}>
						<input
							placeholder={info().placeholder}
							placeholderColor={colors.textSubtle}
							textColor={colors.text}
							value={wizardInput()}
							onInput={setWizardInput}
							onSubmit={handleSubmit}
							focused
							style={{ width: '100%' }}
						/>
					</box>
				}
			>
				<box style={{ flexDirection: 'column', paddingLeft: 1 }}>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Name:   " style={{ width: 10 }} />
						<text fg={colors.text} content={values().name} />
					</box>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="URL:    " style={{ width: 10 }} />
						<text fg={colors.text} content={values().url} />
					</box>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Branch: " style={{ width: 10 }} />
						<text fg={colors.text} content={values().branch || 'main'} />
					</box>
					<Show when={values().notes}>
						<box style={{ flexDirection: 'row' }}>
							<text fg={colors.textMuted} content="Notes:  " style={{ width: 10 }} />
							<text fg={colors.text} content={values().notes} />
						</box>
					</Show>
					<text content="" style={{ height: 1 }} />
					<text fg={colors.success} content=" Press Enter to confirm, Esc to cancel" />
				</box>
			</Show>
		</box>
	);
};
