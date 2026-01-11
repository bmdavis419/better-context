import {
	createContext,
	createSignal,
	useContext,
	onMount,
	type Accessor,
	type Component,
	type ParentProps
} from 'solid-js';
import type { Repo } from '../types.ts';
import { services } from '../services.ts';

type ConfigState = {
	selectedModel: Accessor<string>;
	selectedProvider: Accessor<string>;
	selectedVariant: Accessor<string>;
	setModel: (model: string) => void;
	setProvider: (provider: string) => void;
	setVariant: (variant: string) => void;

	repos: Accessor<Repo[]>;
	addRepo: (repo: Repo) => void;
	removeRepo: (name: string) => void;
};

const ConfigContext = createContext<ConfigState>();

export const useConfigContext = () => {
	const context = useContext(ConfigContext);
	if (!context) throw new Error('useConfigContext must be used within ConfigProvider');
	return context;
};

export const ConfigProvider: Component<ParentProps> = (props) => {
	const [selectedModel, setSelectedModel] = createSignal('');
	const [selectedProvider, setSelectedProvider] = createSignal('');
	const [selectedVariant, setSelectedVariant] = createSignal('');
	const [repos, setRepos] = createSignal<Repo[]>([]);

	onMount(() => {
		services.getRepos().then(setRepos).catch(console.error);
		services
			.getModel()
			.then((config) => {
				setSelectedProvider(config.provider);
				setSelectedModel(config.model);
				setSelectedVariant(config.variant ?? '');
			})
			.catch(console.error);
	});

	const state: ConfigState = {
		selectedModel,
		selectedProvider,
		selectedVariant,
		setModel: setSelectedModel,
		setProvider: setSelectedProvider,
		setVariant: setSelectedVariant,
		repos,
		addRepo: (repo) => setRepos((prev) => [...prev, repo]),
		removeRepo: (name) => setRepos((prev) => prev.filter((r) => r.name !== name))
	};

	return <ConfigContext.Provider value={state}>{props.children}</ConfigContext.Provider>;
};
