import {
	Action,
	ActionPanel,
	Detail,
	Form,
	open,
	openExtensionPreferences,
	showToast,
	Toast,
	useNavigation
} from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { useState } from 'react';
import { askQuestion, fetchResources, ApiError } from './api';
import { parseSSEStream } from './stream';

export default function AskCommand() {
	const [question, setQuestion] = useState('');
	const { push } = useNavigation();

	// Fetch resources on mount (for future autocomplete hints)
	const { data: resourcesData, isLoading: isLoadingResources } = usePromise(async () => {
		try {
			return await fetchResources();
		} catch (error) {
			if (error instanceof ApiError) {
				handleApiError(error);
			}
			return null;
		}
	}, []);

	const handleSubmit = async (values: { question: string }) => {
		if (!values.question.trim()) {
			showToast({
				style: Toast.Style.Failure,
				title: 'Question required',
				message: 'Please enter a question'
			});
			return;
		}

		push(<ResponseView question={values.question} />);
	};

	const resourceNames = resourcesData?.resources.map((r) => r.name) ?? [];
	const resourceHint =
		resourceNames.length > 0
			? `Available: ${resourceNames
					.slice(0, 5)
					.map((n) => `@${n}`)
					.join(', ')}${resourceNames.length > 5 ? '...' : ''}`
			: '';

	return (
		<Form
			isLoading={isLoadingResources}
			actions={
				<ActionPanel>
					<Action.SubmitForm title="Ask Question" onSubmit={handleSubmit} />
					<Action
						title="Open Extension Preferences"
						onAction={openExtensionPreferences}
						shortcut={{ modifiers: ['cmd'], key: ',' }}
					/>
				</ActionPanel>
			}
		>
			<Form.TextArea
				id="question"
				title="Question"
				placeholder="How do I implement streaming in @svelte?"
				info={`Use @resource to include context. ${resourceHint}`}
				value={question}
				onChange={setQuestion}
				enableMarkdown={false}
			/>
			<Form.Description
				title="Tip"
				text="Tag resources with @ syntax: @svelte, @svelteKit, @tailwind, etc."
			/>
		</Form>
	);
}

function ResponseView({ question }: { question: string }) {
	const [markdown, setMarkdown] = useState('');
	const [isComplete, setIsComplete] = useState(false);

	const { isLoading } = usePromise(async () => {
		try {
			const response = await askQuestion(question);

			for await (const event of parseSSEStream(response)) {
				if (event.type === 'text') {
					setMarkdown((prev) => prev + event.delta);
				} else if (event.type === 'done') {
					setMarkdown(event.text);
					setIsComplete(true);
				} else if (event.type === 'error') {
					throw new Error(event.message);
				}
			}
		} catch (error) {
			if (error instanceof ApiError) {
				handleApiError(error);
			}
			throw error;
		}
	}, []);

	const displayMarkdown = markdown || (isLoading ? '*Thinking...*' : '');

	return (
		<Detail
			isLoading={isLoading && !markdown}
			markdown={displayMarkdown}
			metadata={
				isComplete ? (
					<Detail.Metadata>
						<Detail.Metadata.Label title="Status" text="Complete" />
					</Detail.Metadata>
				) : undefined
			}
			actions={
				<ActionPanel>
					<Action.CopyToClipboard
						title="Copy Response"
						content={markdown}
						shortcut={{ modifiers: ['cmd'], key: 'c' }}
					/>
					<Action.Paste
						title="Paste Response"
						content={markdown}
						shortcut={{ modifiers: ['cmd', 'shift'], key: 'v' }}
					/>
				</ActionPanel>
			}
		/>
	);
}

function handleApiError(error: ApiError) {
	if (error.status === 401) {
		showToast({
			style: Toast.Style.Failure,
			title: 'Invalid API Key',
			message: 'Check your API key in extension preferences',
			primaryAction: {
				title: 'Open Preferences',
				onAction: () => openExtensionPreferences()
			}
		});
	} else if (error.status === 402) {
		showToast({
			style: Toast.Style.Failure,
			title: 'Subscription Required',
			message: error.message,
			primaryAction: error.upgradeUrl
				? {
						title: 'Upgrade',
						onAction: () => {
							open(error.upgradeUrl!);
						}
					}
				: undefined
		});
	} else if (error.status === 503) {
		showToast({
			style: Toast.Style.Failure,
			title: 'Service Unavailable',
			message: error.message
		});
	} else {
		showToast({
			style: Toast.Style.Failure,
			title: 'Error',
			message: error.message
		});
	}
}
