export type JobStatus = 'running' | 'paused' | 'queued' | 'rate_limited' | 'completed' | 'failed' | 'cancelled';
export type ResultStatus = 'found' | 'not_discoverable' | 'invalid' | 'error' | 'rate_limited';

export interface Job {
  id: string;
  accountId: string;
  name: string;
  status: JobStatus;
  total: number;
  processed: number;
  found: number;
  notDiscoverable: number;
  errors: number;
  createdAt: string;
  updatedAt: string;
}

export interface Result {
  phone: string;
  status: ResultStatus;
  username: string | null;
  displayName: string | null;
  telegramId: string | null;
  lastOnline: string | null;
  errorMessage: string | null;
  retryAfterSeconds: number | null;
  checkedAt: string;
}

export interface Settings {
  phoneRegion: string;
  maxAttempts: number;
  minRequestInterval: number;
  autoResume: boolean;
}

export interface JobWithResults extends Job {
  results: Result[];
}