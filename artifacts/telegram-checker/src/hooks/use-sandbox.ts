import { useCallback, useEffect, useMemo, useState } from 'react';
import { sampleJobs, sampleSettings } from '@/lib/sandbox-data';
import type { Job, JobWithResults, Result, Settings } from '@/lib/types';

const JOBS_KEY = 'telegram-checker:sandbox-jobs-vietnamese';
const SETTINGS_KEY = 'telegram-checker:sandbox-settings-vietnamese';
const LEGACY_JOBS_KEY = 'telegram-checker:sandbox-jobs';
const LEGACY_SETTINGS_KEY = 'telegram-checker:sandbox-settings';

const legacyJobNames: Record<string, string> = {
  'Northstar / Q2 outreach': 'Northstar / Tiếp cận quý 2',
  'Archway / imported leads': 'Archway / Danh sách liên hệ đã nhập',
  'Slate / conference roster': 'Slate / Danh sách hội nghị',
  'Meridian / partner list': 'Meridian / Danh sách đối tác',
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function useSandbox() {
  const [jobs, setJobs] = useState<JobWithResults[]>([]);
  const [settings, setSettings] = useState<Settings>(sampleSettings);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const storedJobs = readStorage<JobWithResults[] | null>(JOBS_KEY, null);
    const legacyJobs = readStorage<JobWithResults[] | null>(LEGACY_JOBS_KEY, null);
    const sourceJobs = storedJobs ?? legacyJobs;
    setJobs(sourceJobs?.map((job) => ({ ...job, name: legacyJobNames[job.name] ?? job.name })) ?? sampleJobs);
    setSettings(readStorage(SETTINGS_KEY, readStorage(LEGACY_SETTINGS_KEY, sampleSettings)));
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

  const addJob = useCallback((name: string, phones: string[]) => {
    const now = new Date().toISOString();
    const job: JobWithResults = {
      id: `job-${Date.now()}`,
      name,
      status: 'queued',
      total: phones.length,
      processed: 0,
      found: 0,
      notDiscoverable: 0,
      errors: 0,
      createdAt: now,
      updatedAt: now,
      results: phones.map((phone) => ({ phone, status: 'not_discoverable', username: null, displayName: null, telegramId: null, lastOnline: null, checkedAt: now })),
    };
    setJobs((current) => [job, ...current]);
    return job;
  }, []);

  const deleteJob = useCallback((id: string) => setJobs((current) => current.filter((job) => job.id !== id)), []);
  const resetSandbox = useCallback(() => {
    setJobs(sampleJobs);
    setSettings(sampleSettings);
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