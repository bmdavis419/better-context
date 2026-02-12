import { Result } from 'better-result';
import { getContext, setContext } from 'svelte';
import { useQuery, useConvexClient } from 'convex-svelte';
import { goto } from '$app/navigation';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { WebValidationError } from '../result/errors';

type Project = {
	_id: Id<'projects'>;
	name: string;
	model?: string;
	isDefault: boolean;
	createdAt: number;
};

const PROJECT_STORE_KEY = Symbol('project-store');

export class ProjectStore {
	private _query = useQuery(api.projects.list, {});
	private _client = useConvexClient();
	private _selectedProjectId = $state<Id<'projects'> | null>(null);
	private _error = $state<string | null>(null);
	private _initialized = $state(false);
	private _showCreateModal = $state(false);

	get projects(): Project[] {
		return (this._query.data as Project[] | undefined) ?? [];
	}

	get isLoading() {
		return this._query.isLoading;
	}

	get error() {
		return this._error ?? this._query.error?.message ?? null;
	}

	get showCreateModal() {
		return this._showCreateModal;
	}

	set showCreateModal(value: boolean) {
		this._showCreateModal = value;
	}

	get selectedProjectId() {
		return this._selectedProjectId;
	}

	get selectedProject(): Project | null {
		if (!this._selectedProjectId) {
			return this.projects.find((p) => p.isDefault) ?? this.projects[0] ?? null;
		}
		return this.projects.find((p) => p._id === this._selectedProjectId) ?? null;
	}

	get defaultProject(): Project | null {
		return this.projects.find((p) => p.isDefault) ?? null;
	}

	get initialized() {
		return this._initialized;
	}

	selectProject(projectId: Id<'projects'> | null, updateUrl = true) {
		this._selectedProjectId = projectId;
		if (updateUrl && typeof window !== 'undefined') {
			this.updateUrlParam(projectId);
		}
	}

	private updateUrlParam(projectId: Id<'projects'> | null) {
		const url = new URL(window.location.href);
		if (projectId) {
			url.searchParams.set('project', projectId);
		} else {
			url.searchParams.delete('project');
		}
		window.history.replaceState({}, '', url.toString());
	}

	initFromUrl(urlProjectId: string | null) {
		if (this._initialized) return;

		if (urlProjectId && this.projects.some((p) => p._id === urlProjectId)) {
			this._selectedProjectId = urlProjectId as Id<'projects'>;
		}
		this._initialized = true;
	}

	async selectProjectWithNavigation(projectId: Id<'projects'> | null) {
		this._selectedProjectId = projectId;
		if (typeof window !== 'undefined') {
			const url = new URL(window.location.href);
			if (projectId) {
				url.searchParams.set('project', projectId);
			} else {
				url.searchParams.delete('project');
			}
			await goto(url.toString(), { replaceState: true, keepFocus: true });
		}
	}

	async createProject(name: string, model?: string): Promise<Id<'projects'> | null> {
		this._error = null;
		try {
			const projectId = await this._client.mutation(api.projects.create, {
				name,
				model
			});
			return projectId;
		} catch (error) {
			this._error = error instanceof Error ? error.message : 'Failed to create project';
			return null;
		}
	}

	async updateProjectModel(projectId: Id<'projects'>, model?: string): Promise<boolean> {
		this._error = null;
		try {
			await this._client.mutation(api.projects.updateModel, {
				projectId,
				model
			});
			return true;
		} catch (error) {
			this._error = error instanceof Error ? error.message : 'Failed to update project';
			return false;
		}
	}

	async deleteProject(projectId: Id<'projects'>): Promise<boolean> {
		this._error = null;
		try {
			await this._client.mutation(api.projects.remove, { projectId });
			if (this._selectedProjectId === projectId) {
				this.selectProject(null);
			}
			return true;
		} catch (error) {
			this._error = error instanceof Error ? error.message : 'Failed to delete project';
			return false;
		}
	}
}

const missingProjectStoreError = () =>
	new WebValidationError({ message: 'Project store not found. Did you call setProjectStore?' });

const getProjectStoreResult = (): Result<ProjectStore, WebValidationError> => {
	const store = getContext<ProjectStore>(PROJECT_STORE_KEY);
	if (!store) return Result.err(missingProjectStoreError());
	return Result.ok(store);
};

export const getProjectStore = (): ProjectStore => {
	return Result.match(getProjectStoreResult(), {
		ok: (store) => store,
		err: (error) => {
			throw error;
		}
	});
};

export const setProjectStore = (): ProjectStore => {
	const store = new ProjectStore();
	setContext(PROJECT_STORE_KEY, store);
	return store;
};
