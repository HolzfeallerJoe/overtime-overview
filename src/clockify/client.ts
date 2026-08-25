import {
  ClockifyApiError, type ClockifyUser, type Project, type Task,
  type TimeEntry, type Workspace,
} from './types.js';

const API = 'https://api.clockify.me/api/v1';

export interface ClockifyConfig {
  apiKey: string;
  workspaceId?: string;
  userId?: string;
}

/**
 * Minimal Clockify client for the endpoints a regular (non-admin) workspace
 * member is allowed to call. The Reports API (reports.api.clockify.me) is
 * deliberately not wrapped: it answers 403 for non-admin members.
 */
export class ClockifyClient {
  constructor(private readonly cfg: ClockifyConfig) {
    if (!cfg.apiKey) throw new Error('CLOCKIFY_API_KEY is missing');
  }

  private async get<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));

    const res = await fetch(url, { headers: { 'x-api-key': this.cfg.apiKey } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body as { message?: string } | null)?.message ?? res.statusText;
      throw new ClockifyApiError(res.status, body, `Clockify ${res.status} on ${path}: ${msg}`);
    }
    return body as T;
  }

  private get workspaceId(): string {
    if (!this.cfg.workspaceId) throw new Error('CLOCKIFY_WORKSPACE_ID is missing');
    return this.cfg.workspaceId;
  }

  private get userId(): string {
    if (!this.cfg.userId) throw new Error('CLOCKIFY_USER_ID is missing');
    return this.cfg.userId;
  }

  getCurrentUser(): Promise<ClockifyUser> {
    return this.get<ClockifyUser>('/user');
  }

  async getWorkspace(): Promise<Workspace> {
    const all = await this.get<Workspace[]>('/workspaces');
    const ws = all.find((w) => w.id === this.workspaceId);
    if (!ws) throw new Error(`Workspace ${this.workspaceId} not visible to this API key`);
    return ws;
  }

  getProjects(): Promise<Project[]> {
    return this.get<Project[]>(`/workspaces/${this.workspaceId}/projects`, {
      'page-size': 5000, archived: 'false',
    });
  }

  getTasks(projectId: string): Promise<Task[]> {
    return this.get<Task[]>(
      `/workspaces/${this.workspaceId}/projects/${projectId}/tasks`, { 'page-size': 5000 },
    );
  }

  /**
   * All time entries overlapping [start, end), following pagination.
   * `start`/`end` are ISO-8601 UTC instants.
   */
  async getTimeEntries(start: string, end: string): Promise<TimeEntry[]> {
    const pageSize = 1000;
    const out: TimeEntry[] = [];

    for (let page = 1; ; page++) {
      const batch = await this.get<TimeEntry[]>(
        `/workspaces/${this.workspaceId}/user/${this.userId}/time-entries`,
        { start, end, 'page-size': pageSize, page },
      );
      out.push(...batch);
      if (batch.length < pageSize) break;
      if (page > 200) throw new Error('Pagination runaway - aborting after 200 pages');
    }

    // Clockify returns newest-first; chronological is friendlier downstream.
    return out.sort((a, b) => a.timeInterval.start.localeCompare(b.timeInterval.start));
  }
}
