import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Job, JobWithResults, Result, Settings } from '@/lib/types';

const JOBS_KEY = 'telegram-checker:jobs-v1';
const SETTINGS_KEY = 'telegram-checker:settings-v1';
const OLD_LOCALIZED_JOBS_KEY = 'telegram-checker:sandbox-jobs-vietnamese';
const OLD_LOCALIZED_SETTINGS_KEY = 'telegram-checker:sandbox-settings-vietnamese';
const LEGACY_JOBS_KEY = 'telegram-checker:sandbox-jobs';
const LEGACY_SETTINGS_KEY = 'telegram-checker:sandbox-settings';

const emptySettings: Settings = {
  connectionConfigured: false,
  phoneRegion: 'VN',
  maxAttempts: 3,
  minRequestInterval: 1.2,
  autoResume: true,
};

export function useSandbox() {
  const [jobs, setJobs] = useState<JobWithResults[]>([]);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Production must never rehydrate the old demo records. Remove both the
    // localized and legacy keys so a previous browser session cannot restore
    // sample jobs after deployment.
    window.localStorage.removeItem(OLD_LOCALIZED_JOBS_KEY);
    window.localStorage.removeItem(OLD_LOCALIZED_SETTINGS_KEY);
    window.localStorage.removeItem(LEGACY_JOBS_KEY);
    window.localStorage.removeItem(LEGACY_SETTINGS_KEY);
    setJobs([]);
    setSettings(emptySettings);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
  }, [hydrated, jobs]);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [hydrated, settings]);

  const updateJob = useCallback((id: string, updates: Partial<Job>) => {
    setJobs((current) => current.map((job) => job.id === id ? { ...job, ...updates, updatedAt: new Date().toISOString() } : job));
  }, []);

  const toggleJob = useCallback((id: string) => {
    setJobs((current) => current.map((job) => {
      if (job.id !== id) return job;
      return { ...job, status: job.status === 'running' ? 'paused' : 'running', updatedAt: new Date().toISOString() };
    }));
  }, []);

  const addJob = useCallback((name: string, phones: string[], checkedResults: Array<{ phone: string; status: Result['status']; username?: string | null; displayName?: string | null; telegramId?: string | null; lastOnline?: string | null; checkedAt: string }> = []) => {
    const now = new Date().toISOString();
    const results: Result[] = checkedResults.length ? checkedResults.map((result) => ({ phone: result.phone, status: result.status, username: result.username ?? null, displayName: result.displayName ?? null, telegramId: result.telegramId ?? null, lastOnline: result.lastOnline ?? null, checkedAt: result.checkedAt })) : phones.map((phone) => ({ phone, status: 'error' as const, username: null, displayName: null, telegramId: null, lastOnline: null, checkedAt: now }));
    const found = results.filter((result) => result.status === 'found').length;
    const notDiscoverable = results.filter((result) => result.status === 'not_discoverable').length;
    const job: JobWithResults = {
      id: `job-${Date.now()}`,
      name,
      status: 'completed',
      total: phones.length,
      processed: results.length,
      found,
      notDiscoverable,
      errors: results.length - found - notDiscoverable,
      createdAt: now,
      updatedAt: now,
      results,
    };
    setJobs((current) => [job, ...current]);
    return job;
  }, []);

  const deleteJob = useCallback((id: string) => setJobs((current) => current.filter((job) => job.id !== id)), []);
  const resetSandbox = useCallback(() => {
    setJobs([]);
    setSettings(emptySettings);
  }, []);
  const updateSettings = useCallback((updates: Partial<Settings>) => setSettings((current) => ({ ...current, ...updates })), []);
  const selectedJob = useMemo(() => jobs[0], [jobs]);

  return { jobs, settings, hydrated, selectedJob, updateJob, toggleJob, addJob, deleteJob, resetSandbox, updateSettings };
}

export function exportJson(job: JobWithResults, filename = 'telegram-check-job.json') {
  downloadFile(JSON.stringify(job, null, 2), filename, 'application/json');
}

export function exportCsv(job: JobWithResults, filename = 'telegram-check-results.csv') {
  const header = ['phone', 'status', 'username', 'displayName', 'telegramId', 'lastOnline', 'checkedAt'];
  const rows = job.results.map((row: Result) => header.map((key) => `"${String(row[key as keyof Result] ?? '').replaceAll('"', '""')}"`).join(','));
  downloadFile([header.join(','), ...rows].join('\n'), filename, 'text/csv;charset=utf-8');
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}