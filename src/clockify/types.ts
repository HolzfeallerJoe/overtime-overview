export interface TimeInterval {
  start: string;          // ISO-8601 UTC, second precision
  end: string | null;     // null while the timer is still running
  duration: string | null; // ISO-8601 duration, MINUTE precision - do not trust for maths
}

export interface TimeEntry {
  id: string;
  description: string;
  tagIds: string[];
  userId: string;
  billable: boolean;
  taskId: string | null;
  projectId: string | null;
  workspaceId: string;
  timeInterval: TimeInterval;
  type: 'REGULAR' | 'BREAK' | string;
  isLocked: boolean;
}

export interface ClockifyUser {
  id: string;
  email: string;
  name: string;
  activeWorkspace: string;
  defaultWorkspace: string;
  settings: { timeZone: string; weekStart: string; [k: string]: unknown };
}

export interface WorkspaceSettings {
  workCapacity: string;            // e.g. "PT7H"
  workingDays: string[];           // e.g. ["MONDAY", ...]
  overtimeCalculationPeriod: string;
  trackTimeDownToSecond: boolean;
  lockTimeEntries: string | null;
  round: { round: string; minutes: string };
  [k: string]: unknown;
}

export interface Workspace {
  id: string;
  name: string;
  workspaceSettings: WorkspaceSettings;
}

export interface Project { id: string; name: string; clientName?: string; archived: boolean; }
export interface Task { id: string; name: string; projectId: string; status: string; }

export class ClockifyApiError extends Error {
  constructor(readonly status: number, readonly body: unknown, message: string) {
    super(message);
    this.name = 'ClockifyApiError';
  }
}
