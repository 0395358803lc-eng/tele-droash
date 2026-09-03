import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListTelegramJobsQueryKey,
  useDeleteTelegramJob,
  useGetTelegramJob,
  useListTelegramJobs,
  useUpdateTelegramJob,
} from "@workspace/api-client-react";
import type {
  TelegramJobResult,
  TelegramJobWithResults,
} from "@workspace/api-client-react";
import type { Job, JobWithResults, Result, Settings } from "@/lib/types";

const SETTINGS_KEY = "telegram-checker:settings-v1";

const emptySettings: Settings = {
  phoneRegion: "VN",
  maxAttempts: 3,
  minRequestInterval: 1.2,
  autoResume: true,
};

function mapResult(result: TelegramJobResult): Result {
  return {
    phone: result.phone,
    status: result.status,
    username: result.username ?? null,
    displayName: result.displayName ?? null,
    telegramId: result.telegramId ?? null,
    lastOnline: result.lastOnline ?? null,
    errorMessage: result.errorMessage ?? null,
    retryAfterSeconds: result.retryAfterSeconds ?? null,
    checkedAt: result.checkedAt,
  };
}

function mapJob(job: TelegramJobWithResults): JobWithResults {
  return { ...job, results: job.results.map(mapResult) };
}

function mapSummary(job: Job): JobWithResults {
  return { ...job, results: [] };
}

function getApiErrorMessage(error: unknown) {
  const data = (error as { data?: { message?: string } } | undefined)?.data;
  return (
    data?.message ??
    (error instanceof Error ? error.message : "Không thể cập nhật tác vụ.")
  );
}

export function useSandbox() {
  const queryClient = useQueryClient();
  const jobsQuery = useListTelegramJobs({
    query: {
      queryKey: getListTelegramJobsQueryKey(),
      refetchOnWindowFocus: true,
      staleTime: 1000,
      refetchInterval: 2000,
    },
  });
  const deleteMutation = useDeleteTelegramJob();
  const updateMutation = useUpdateTelegramJob();
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SETTINGS_KEY);
      if (saved) setSettings({ ...emptySettings, ...JSON.parse(saved) });
    } catch {
      setSettings(emptySettings);
    } finally {
      setSettingsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (settingsHydrated)
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings, settingsHydrated]);

  const jobs = useMemo(
    () => (jobsQuery.data?.jobs ?? []).map(mapSummary),
    [jobsQuery.data],
  );

  const deleteJob = useCallback(
    async (id: string) => {
      await deleteMutation.mutateAsync({ jobId: id });
      await queryClient.invalidateQueries({
        queryKey: getListTelegramJobsQueryKey(),
      });
    },
    [deleteMutation, queryClient],
  );

  const updateJob = useCallback(
    async (id: string, updates: Partial<Job>) => {
      if (updates.status !== "running" && updates.status !== "paused") return;
      await updateMutation.mutateAsync({
        jobId: id,
        data: { status: updates.status },
      });
      await queryClient.invalidateQueries({
        queryKey: getListTelegramJobsQueryKey(),
      });
    },
    [queryClient, updateMutation],
  );

  const toggleJob = useCallback(
    async (id: string) => {
      const current = jobs.find((job) => job.id === id);
      if (!current) return;
      await updateJob(id, {
        status: current.status === "running" || current.status === "rate_limited" ? "paused" : "running",
      });
    },
    [jobs, updateJob],
  );

  const resetSandbox = useCallback(() => setSettings(emptySettings), []);
  const updateSettings = useCallback(
    (updates: Partial<Settings>) =>
      setSettings((current) => ({ ...current, ...updates })),
    [],
  );
  const selectedJob = useMemo(() => jobs[0], [jobs]);

  return {
    jobs,
    settings,
    hydrated: !jobsQuery.isLoading && settingsHydrated,
    selectedJob,
    updateJob,
    toggleJob,
    deleteJob,
    resetSandbox,
    updateSettings,
    refreshJobs: () =>
      queryClient.invalidateQueries({
        queryKey: getListTelegramJobsQueryKey(),
      }),
    error: jobsQuery.error ? getApiErrorMessage(jobsQuery.error) : null,
  };
}

export function usePersistentJob(jobId?: string) {
  const query = useGetTelegramJob(jobId ?? "", {
    query: {
      queryKey: ["/api/jobs", jobId ?? ""] as const,
      enabled: Boolean(jobId),
      refetchOnWindowFocus: true,
      refetchInterval: 2000,
    },
  });
  return {
    ...query,
    data: query.data ? mapJob(query.data) : undefined,
  };
}

export function exportJson(
  job: JobWithResults,
  filename = "telegram-check-job.json",
) {
  downloadFile(JSON.stringify(job, null, 2), filename, "application/json");
}

export function exportCsv(
  job: JobWithResults,
  filename = "telegram-check-results.csv",
) {
  const header = [
    "phone",
    "status",
    "username",
    "displayName",
    "telegramId",
    "lastOnline",
    "checkedAt",
  ];
  const rows = job.results.map((row: Result) =>
    header
      .map(
        (key) =>
          `"${String(row[key as keyof Result] ?? "").replaceAll('"', '""')}"`,
      )
      .join(","),
  );
  downloadFile(
    [header.join(","), ...rows].join("\n"),
    filename,
    "text/csv;charset=utf-8",
  );
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
