import {
	createSignal,
	createEffect,
	createMemo,
	Show,
	type Component,
	type Setter
} from 'solid-js';
import { useKeyboard, usePaste } from '@opentui/solid';
import { Result } from 'better-result';

import { colors } from '../theme.ts';
import { useMessagesContext } from '../context/messages-context.tsx';
import { useConfigContext } from '../context/config-context.tsx';
import { services } from '../services.ts';
import { formatError } from '../lib/format-error.ts';
import type { WizardStep, Repo } from '../types.ts';

type ResourceType = 'git' | 'local';

// All possible wizard steps
type AddResourceWizardStep =
	| 'type' // First step: choose resource type
	| 'name'
	| 'url'
	| 'branch'
	| 'searchPath'
	| 'path'
	| 'notes'
	| 'confirm';

interface StepInfo {
	title: string;
	hint: string;
	placeholder: string;
	required: boolean;
}

// Git resource steps (after type selection)
const GIT_STEPS: AddResourceWizardStep[] = [
	'name',
	'url',
	'branch',
	'searchPath',
	'notes',
	'confirm'
];

// Local resource steps (after type selection)
const LOCAL_STEPS: AddResourceWizardStep[] = ['name', 'path', 'notes', 'confirm'];

const getStepInfo = (step: AddResourceWizardStep, resourceType: ResourceType): StepInfo => {
	const gitStepCount = GIT_STEPS.length - 1; // exclude confirm
	const localStepCount = LOCAL_STEPS.length - 1; // exclude confirm

	const getStepNumber = (s: AddResourceWizardStep): number => {
		if (s === 'type') return 1;
		const steps = resourceType === 'git' ? GIT_STEPS : LOCAL_STEPS;
		return steps.indexOf(s) + 2; // +2 because type is step 1
	};

	const totalSteps = resourceType === 'git' ? gitStepCount + 1 : localStepCount + 1;

	switch (step) {
		case 'type':
			return {
				title: 'Step 1: Resource Type',
				hint: 'Enter "git" for a GitHub repository or "local" for a local directory',
				placeholder: 'git or local',
				required: true
			};
		case 'name':
			return {
				title: `Step ${getStepNumber('name')}/${totalSteps}: Resource Name`,
				hint: 'Enter a unique name for this resource (e.g., "react", "svelteDocs")',
				placeholder: 'resourceName',
				required: true
			};
		case 'url':
			return {
				title: `Step ${getStepNumber('url')}/${totalSteps}: Repository URL`,
				hint: 'Enter the GitHub repository URL',
				placeholder: 'https://github.com/owner/repo',
				required: true
			};
		case 'branch':
			return {
				title: `Step ${getStepNumber('branch')}/${totalSteps}: Branch`,
				hint: 'Enter the branch to clone (press Enter for "main")',
				placeholder: 'main',
				required: false
			};
		case 'searchPath':
			return {
				title: `Step ${getStepNumber('searchPath')}/${totalSteps}: Search Path (Optional)`,
				hint: 'Subdirectory to focus on. Press Enter to skip',
				placeholder: 'e.g., docs or src/components',
				required: false
			};
		case 'path':
			return {
				title: `Step ${getStepNumber('path')}/${totalSteps}: Local Path`,
				hint: 'Enter the absolute path to the local directory',
				placeholder: '/path/to/directory',
				required: true
			};
		case 'notes':
			return {
				title: `Step ${getStepNumber('notes')}/${totalSteps}: Special Notes (Optional)`,
				hint: 'Any special notes for the AI? Press Enter to skip',
				placeholder: 'e.g., "This is the docs website, not the library"',
				required: false
			};
		case 'confirm':
			return {
				title: 'Confirm',
				hint: 'Press Enter to see config snippet, Esc to cancel',
				placeholder: '',
				required: false
			};
	}
};

interface AddResourceWizardProps {
	onClose: () => void;
	onStepChange: Setter<WizardStep>;
}

interface WizardValues {
	type: ResourceType | '';
	name: string;
	url: string;
	branch: string;
	searchPath: string;
	path: string;
	notes: string;
}

export const AddResourceWizard: Component<AddResourceWizardProps> = (props) => {
	const messages = useMessagesContext();
	const config = useConfigContext();

	// All wizard state is LOCAL
	const [step, setStep] = createSignal<AddResourceWizardStep>('type');
	const [values, setValues] = createSignal<WizardValues>({
		type: '',
		name: '',
		url: '',
		branch: '',
		searchPath: '',
		path: '',
		notes: ''
	});
	const [wizardInput, setWizardInput] = createSignal('');
	const [error, setError] = createSignal<string | null>(null);

	const resourceType = createMemo(() => (values().type || 'git') as ResourceType);
	const info = createMemo(() => getStepInfo(step(), resourceType()));

	// Notify parent of step changes for status bar
	createEffect(() => {
		props.onStepChange(step() as WizardStep);
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

	const getNextStep = (currentStep: AddResourceWizardStep): AddResourceWizardStep | null => {
		if (currentStep === 'type') {
			return 'name';
		}

		const steps = values().type === 'git' ? GIT_STEPS : LOCAL_STEPS;
		const currentIndex = steps.indexOf(currentStep);
		if (currentIndex === -1 || currentIndex >= steps.length - 1) return null;
		return steps[currentIndex + 1]!;
	};

	const handleSubmit = () => {
		const currentStep = step();
		const value = wizardInput().trim();
		const stepInfo = info();

		// Validate required fields
		if (stepInfo.required && !value) {
			setError(`This field is required`);
			return;
		}
		setError(null);

		if (currentStep === 'type') {
			const lowerValue = value.toLowerCase();
			if (lowerValue !== 'git' && lowerValue !== 'local') {
				setError('Please enter "git" or "local"');
				return;
			}
			setValues({ ...values(), type: lowerValue as ResourceType });
			setStep('name');
			setWizardInput('');
		} else if (currentStep === 'name') {
			setValues({ ...values(), name: value });
			const next = getNextStep(currentStep);
			if (next) {
				setStep(next);
				// Pre-fill branch with 'main' for git resources
				if (next === 'branch') {
					setWizardInput('main');
				} else {
					setWizardInput('');
				}
			}
		} else if (currentStep === 'url') {
			setValues({ ...values(), url: value });
			const next = getNextStep(currentStep);
			if (next) {
				setStep(next);
				setWizardInput(next === 'branch' ? 'main' : '');
			}
		} else if (currentStep === 'branch') {
			setValues({ ...values(), branch: value || 'main' });
			const next = getNextStep(currentStep);
			if (next) {
				setStep(next);
				setWizardInput('');
			}
		} else if (currentStep === 'searchPath') {
			setValues({ ...values(), searchPath: value });
			const next = getNextStep(currentStep);
			if (next) {
				setStep(next);
				setWizardInput('');
			}
		} else if (currentStep === 'path') {
			setValues({ ...values(), path: value });
			const next = getNextStep(currentStep);
			if (next) {
				setStep(next);
				setWizardInput('');
			}
		} else if (currentStep === 'notes') {
			setValues({ ...values(), notes: value });
			setStep('confirm');
		} else if (currentStep === 'confirm') {
			// This will be handled by the confirm keyboard handler
		}
	};

	const handleConfirm = async () => {
		const vals = values();

		const result = await Result.tryPromise(async () => {
			if (vals.type === 'git') {
				const resource = {
					type: 'git' as const,
					name: vals.name,
					url: vals.url,
					branch: vals.branch || 'main',
					...(vals.searchPath && { searchPath: vals.searchPath }),
					...(vals.notes && { specialNotes: vals.notes })
				};
				await services.addResource(resource);
				const repo: Repo = {
					name: resource.name,
					url: resource.url,
					branch: resource.branch,
					specialNotes: resource.specialNotes,
					searchPath: resource.searchPath
				};
				config.addRepo(repo);
				messages.addSystemMessage(`Added git resource: ${resource.name}`);
			} else {
				const resource = {
					type: 'local' as const,
					name: vals.name,
					path: vals.path,
					...(vals.notes && { specialNotes: vals.notes })
				};
				await services.addResource(resource);
				// Local resources aren't shown as repos in the current UI but the server has them
				messages.addSystemMessage(`Added local resource: ${resource.name}`);
			}
		});
		if (result.isErr()) {
			messages.addSystemMessage(`Error: ${formatError(result.error)}`);
		}
		props.onClose();
	};

	useKeyboard((key) => {
		if (key.name === 'escape') {
			props.onClose();
		} else if (key.name === 'return' && step() === 'confirm') {
			handleConfirm();
		}
	});

	const renderConfirmation = () => {
		const vals = values();
		const isGit = vals.type === 'git';

		return (
			<box style={{ flexDirection: 'column', paddingLeft: 1 }}>
				<box style={{ flexDirection: 'row' }}>
					<text fg={colors.textMuted} content="Type:   " style={{ width: 12 }} />
					<text fg={colors.accent} content={vals.type} />
				</box>
				<box style={{ flexDirection: 'row' }}>
					<text fg={colors.textMuted} content="Name:   " style={{ width: 12 }} />
					<text fg={colors.text} content={vals.name} />
				</box>
				<Show when={isGit}>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="URL:    " style={{ width: 12 }} />
						<text fg={colors.text} content={vals.url} />
					</box>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Branch: " style={{ width: 12 }} />
						<text fg={colors.text} content={vals.branch || 'main'} />
					</box>
					<Show when={vals.searchPath}>
						<box style={{ flexDirection: 'row' }}>
							<text fg={colors.textMuted} content="SearchPath:" style={{ width: 12 }} />
							<text fg={colors.text} content={vals.searchPath} />
						</box>
					</Show>
				</Show>
				<Show when={!isGit}>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Path:   " style={{ width: 12 }} />
						<text fg={colors.text} content={vals.path} />
					</box>
				</Show>
				<Show when={vals.notes}>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Notes:  " style={{ width: 12 }} />
						<text fg={colors.text} content={vals.notes} />
					</box>
				</Show>
				<text content="" style={{ height: 1 }} />
				<text fg={colors.success} content=" Press Enter to get config snippet, Esc to cancel" />
			</box>
		);
	};

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
			<text fg={colors.info} content={` Add Resource - ${info().title}`} />
			<text fg={colors.textSubtle} content={` ${info().hint}`} />
			<Show when={error()}>
				<text fg={colors.error} content={` ${error()}`} />
			</Show>
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
							onInput={(v) => {
								setWizardInput(v);
								setError(null);
							}}
							onSubmit={handleSubmit}
							focused
							style={{ width: '100%' }}
						/>
					</box>
				}
			>
				{renderConfirmation()}
			</Show>
		</box>
	);
};
