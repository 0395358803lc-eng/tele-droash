import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, KeyRound, LoaderCircle, LockKeyhole, Phone, Plus, RefreshCw, ShieldCheck, Smartphone, Trash2, UserRound, Wifi, WifiOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { completeTelegramAccountLogin, deleteTelegramAccount, refreshTelegramAccountStatus, startTelegramAccountLogin, useListTelegramAccounts } from '@workspace/api-client-react';
import type { TelegramAccount } from '@workspace/api-client-react';
import { AppShell } from '@/components/app-shell';
import { Button, EmptyState, Label, Panel, Skeleton, TextInput } from '@/components/ui-primitives';
import { useSandbox } from '@/hooks/use-sandbox';

type LoginStep = 'start' | 'code' | 'twoFactor';

function apiMessage(error: unknown) {
  const data = (error as { data?: { message?: string } } | undefined)?.data;
  return data?.message ?? (error instanceof Error ? error.message : 'Có lỗi xảy ra. Hãy thử lại.');
}

function maskPhone(phone: string) {
  return phone.length > 7 ? `${phone.slice(0, -6)}••••${phone.slice(-2)}` : phone;
}

const statusConfig: Record<TelegramAccount['status'], { label: string; className: string; icon: typeof Wifi }> = {
  connected: { label: 'Đã kết nối', className: 'bg-[hsl(162_45%_88%)] text-[hsl(170_48%_29%)]', icon: Wifi },
  awaiting_code: { label: 'Chờ mã OTP', className: 'bg-[hsl(var(--accent)/.2)] text-[hsl(29_58%_31%)]', icon: Clock3 },
  awaiting_2fa: { label: 'Chờ mật khẩu 2 bước', className: 'bg-[hsl(var(--accent)/.2)] text-[hsl(29_58%_31%)]', icon: LockKeyhole },
  disconnected: { label: 'Đã ngắt kết nối', className: 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]', icon: WifiOff },
  rate_limited: { label: 'Đang bị giới hạn', className: 'bg-[hsl(var(--accent)/.2)] text-[hsl(29_58%_31%)]', icon: Clock3 },
  failed: { label: 'Thất bại', className: 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]', icon: AlertTriangle },
  disabled: { label: 'Đã vô hiệu hóa', className: 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]', icon: WifiOff },
};

function AccountStatus({ status }: { status: TelegramAccount['status'] }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${config.className}`}><Icon size={12} /> {config.label}</span>;
}

export default function Settings() {
  const queryClient = useQueryClient();
  const accountsQuery = useListTelegramAccounts({ query: { queryKey: ['/api/telegram-accounts'], refetchInterval: 30000, refetchOnWindowFocus: true } });
  const { settings, hydrated, updateSettings } = useSandbox();
  const [step, setStep] = useState<LoginStep>('start');
  const [pendingAccount, setPendingAccount] = useState<TelegramAccount | null>(null);
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [operationDraft, setOperationDraft] = useState({
    maxAttempts: 3,
    minRequestInterval: 1.2,
    autoResume: true,
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const connectedCount = useMemo(() => accounts.filter((account) => account.status === 'connected').length, [accounts]);

  useEffect(() => {
    setOperationDraft({
      maxAttempts: settings.maxAttempts,
      minRequestInterval: settings.minRequestInterval,
      autoResume: settings.autoResume,
    });
  }, [settings.autoResume, settings.maxAttempts, settings.minRequestInterval]);

  async function beginLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await startTelegramAccountLogin({ apiId, apiHash, phoneNumber });
      setPendingAccount(response.account);
      setStep('code');
      setCode('');
      setNotice('Telegram đã gửi mã đăng nhập. Kiểm tra ứng dụng Telegram trên điện thoại.');
      await queryClient.invalidateQueries({ queryKey: ['/api/telegram-accounts'] });
    } catch (requestError) {
      setError(apiMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function finishLogin(event: React.FormEvent) {
    event.preventDefault();
    if (!pendingAccount) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const account = await completeTelegramAccountLogin(pendingAccount.id, { code, password: step === 'twoFactor' ? password : undefined });
      setPendingAccount(account);
      if (account.status === 'awaiting_2fa') {
        setStep('twoFactor');
        setNotice('Mã đúng. Tài khoản này bật xác minh hai bước, hãy nhập mật khẩu Telegram.');
      } else {
        setStep('start');
        setPendingAccount(null);
        setApiId('');
        setApiHash('');
        setPhoneNumber('');
        setCode('');
        setPassword('');
        setNotice('Đã kết nối tài khoản Telegram. Session được lưu mã hóa phía máy chủ.');
      }
      await queryClient.invalidateQueries({ queryKey: ['/api/telegram-accounts'] });
    } catch (requestError) {
      setError(apiMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function refreshAccount(account: TelegramAccount) {
    setRefreshingId(account.id);
    setError('');
    try {
      await refreshTelegramAccountStatus(account.id);
      await queryClient.invalidateQueries({ queryKey: ['/api/telegram-accounts'] });
    } catch (requestError) {
      setError(apiMessage(requestError));
    } finally {
      setRefreshingId(null);
    }
  }

  async function removeAccount(account: TelegramAccount) {
    if (!window.confirm(`Xóa tài khoản ${maskPhone(account.phoneNumber)} và session đã lưu?`)) return;
    setRefreshingId(account.id);
    setError('');
    try {
      await deleteTelegramAccount(account.id);
      await queryClient.invalidateQueries({ queryKey: ['/api/telegram-accounts'] });
      setNotice('Đã xóa hồ sơ và session Telegram khỏi máy chủ.');
    } catch (requestError) {
      setError(apiMessage(requestError));
    } finally {
      setRefreshingId(null);
    }
  }

  function saveOperationSettings(event: React.FormEvent) {
    event.preventDefault();
    updateSettings({
      connectionConfigured: connectedCount > 0,
      maxAttempts: Math.round(Math.min(10, Math.max(1, operationDraft.maxAttempts || 1))),
      minRequestInterval: Math.min(60, Math.max(0.1, operationDraft.minRequestInterval || 0.1)),
      autoResume: operationDraft.autoResume,
    });
    setNotice('Đã lưu thiết lập vận hành cho các lần chạy sau.');
  }

  if (!hydrated || accountsQuery.isLoading) return <AppShell><div className="space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-64" /><Skeleton className="h-56" /></div></AppShell>;

  return <AppShell>
    <div className="max-w-5xl space-y-6 pb-20">
      <section className="animate-rise">
        <div className="font-mono text-[10px] uppercase tracking-[.18em] text-[hsl(var(--primary))]">Kết nối vận hành</div>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-[-.04em]">Tài khoản Telegram</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Thêm nhiều tài khoản để chạy các lần kiểm tra thực tế. Mỗi tài khoản có session riêng và không thể bị hai worker sử dụng đồng thời.</p>
      </section>

      {(error || notice) && <div className={`flex items-start gap-3 rounded-md border px-4 py-3 text-xs leading-relaxed ${error ? 'border-[hsl(var(--destructive)/.35)] bg-[hsl(var(--destructive)/.07)] text-[hsl(var(--destructive))]' : 'border-[hsl(var(--primary)/.3)] bg-[hsl(var(--primary)/.07)] text-[hsl(var(--foreground))]'}`} role="status">{error ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />}<span>{error || notice}</span><button className="ml-auto font-bold opacity-70" onClick={() => { setError(''); setNotice(''); }} aria-label="Đóng thông báo">×</button></div>}

      <Panel className="overflow-hidden animate-rise animate-rise-delay-1">
        <div className="flex items-start gap-4 border-b border-[hsl(var(--border))] px-5 py-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]"><Smartphone size={17} /></div>
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-base font-semibold">{step === 'start' ? 'Thêm tài khoản Telegram' : step === 'code' ? 'Xác minh mã đăng nhập' : 'Xác minh hai bước'}</h2>{step !== 'start' && pendingAccount && <AccountStatus status={pendingAccount.status} />}</div><p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">API ID và API Hash đến từ ứng dụng Telegram của bạn trên my.telegram.org. Chúng chỉ được gửi đến server qua kết nối API; API Hash không bao giờ được hiển thị lại.</p></div>
        </div>
        {step === 'start' ? <form onSubmit={beginLogin} className="grid gap-5 px-5 py-5 sm:grid-cols-2">
          <div><Label htmlFor="telegram-api-id">API ID</Label><TextInput id="telegram-api-id" inputMode="numeric" value={apiId} onChange={(event) => setApiId(event.target.value)} placeholder="Ví dụ: 12345678" autoComplete="off" required data-testid="input-telegram-api-id" /><p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">Số API ID trong my.telegram.org/apps.</p></div>
          <div><Label htmlFor="telegram-api-hash">API Hash</Label><TextInput id="telegram-api-hash" type="password" value={apiHash} onChange={(event) => setApiHash(event.target.value)} placeholder="Dán API Hash" autoComplete="off" minLength={16} required data-testid="input-telegram-api-hash" /><p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">Không lưu trong trình duyệt sau khi rời trang.</p></div>
          <div><Label htmlFor="telegram-phone">Số điện thoại Telegram</Label><div className="relative"><Phone size={15} className="pointer-events-none absolute left-3 top-3 text-[hsl(var(--muted-foreground))]" /><TextInput id="telegram-phone" className="pl-9" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+84912345678" autoComplete="tel" required data-testid="input-telegram-phone" /></div><p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">Dùng định dạng quốc tế, gồm mã quốc gia.</p></div>
          <div className="flex items-end justify-end"><Button type="submit" disabled={busy} data-testid="button-start-telegram-login">{busy ? <><LoaderCircle size={15} className="animate-spin" /> Đang gửi mã…</> : <><Plus size={15} /> Gửi mã đăng nhập</>}</Button></div>
        </form> : <form onSubmit={finishLogin} className="space-y-5 px-5 py-5">
          <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.35)] px-4 py-3 text-xs"><span className="text-[hsl(var(--muted-foreground))]">Tài khoản đang xác minh: </span><strong className="font-mono">{pendingAccount ? maskPhone(pendingAccount.phoneNumber) : ''}</strong></div>
          <div className="max-w-md"><Label htmlFor="telegram-code">Mã Telegram</Label><TextInput id="telegram-code" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Nhập mã gồm 5 chữ số" autoComplete="one-time-code" required data-testid="input-telegram-code" /><p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">Không chia sẻ mã này với bất kỳ ai.</p></div>
          {step === 'twoFactor' && <div className="max-w-md"><Label htmlFor="telegram-password">Mật khẩu xác minh hai bước</Label><div className="relative"><KeyRound size={15} className="pointer-events-none absolute left-3 top-3 text-[hsl(var(--muted-foreground))]" /><TextInput id="telegram-password" type="password" className="pl-9" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mật khẩu Telegram" autoComplete="current-password" required data-testid="input-telegram-password" /></div></div>}
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy} data-testid="button-submit-telegram-login">{busy ? <><LoaderCircle size={15} className="animate-spin" /> Đang xác minh…</> : <><CheckCircle2 size={15} /> {step === 'twoFactor' ? 'Xác minh và kết nối' : 'Xác minh mã'}</>}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setStep('start'); setPendingAccount(null); setCode(''); setPassword(''); setError(''); }} data-testid="button-cancel-telegram-login">Hủy</Button></div>
        </form>}
        <div className="flex items-center gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-5 py-3 text-[11px] text-[hsl(var(--muted-foreground))]"><LockKeyhole size={13} className="text-[hsl(var(--primary))]" /> Session và thông tin API được mã hóa ở server bằng secret của workspace; trình duyệt chỉ nhận trạng thái đã che.</div>
      </Panel>

      <Panel className="overflow-hidden animate-rise animate-rise-delay-2">
        <div className="flex flex-col justify-between gap-3 border-b border-[hsl(var(--border))] px-5 py-5 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><h2 className="font-display text-base font-semibold">Các tài khoản đã thêm</h2><span className="rounded-full bg-[hsl(var(--primary)/.1)] px-2 py-0.5 font-mono text-[10px] font-bold text-[hsl(var(--primary))]">{connectedCount} kết nối</span></div><p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">Danh sách này không hiển thị API Hash hoặc session.</p></div><Button variant="outline" onClick={() => accountsQuery.refetch()} disabled={accountsQuery.isFetching} data-testid="button-refresh-telegram-accounts">{accountsQuery.isFetching ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />} Làm mới</Button></div>
        {accounts.length ? <div className="divide-y divide-[hsl(var(--border))]">{accounts.map((account) => <div key={account.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`telegram-account-${account.id}`}><div className="flex min-w-0 items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-primary))]"><UserRound size={16} /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold">{maskPhone(account.phoneNumber)}</span><AccountStatus status={account.status} /></div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]"><span>{account.displayName || 'Chưa có tên hiển thị'}</span>{account.username && <span className="font-mono">@{account.username}</span>}{account.lastCheckedAt && <span>Kiểm tra {new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(account.lastCheckedAt))}</span>}</div>{account.lastError && <p className="mt-2 text-[11px] text-[hsl(var(--destructive))]">{account.lastError}</p>}</div></div><div className="flex shrink-0 items-center gap-2"><Button variant="outline" onClick={() => refreshAccount(account)} disabled={refreshingId === account.id} data-testid={`button-refresh-account-${account.id}`}>{refreshingId === account.id ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />} Kiểm tra</Button><Button variant="quiet" className="text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]" onClick={() => removeAccount(account)} disabled={refreshingId === account.id} data-testid={`button-delete-account-${account.id}`}><Trash2 size={14} /> Xóa</Button></div></div>)}</div> : <EmptyState title="Chưa có tài khoản Telegram" detail="Thêm tài khoản đầu tiên ở biểu mẫu phía trên để bắt đầu thu thập dữ liệu thật." />}
      </Panel>

       <Panel className="overflow-hidden animate-rise animate-rise-delay-3">
         <div className="border-b border-[hsl(var(--border))] px-5 py-5"><div className="flex items-center gap-2"><ShieldCheck size={16} className="text-[hsl(var(--primary))]" /><h2 className="font-display text-base font-semibold">Thiết lập vận hành</h2></div><p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">Điều chỉnh cách các lần chạy engine xử lý yêu cầu. Không chứa thông tin đăng nhập Telegram.</p></div>
         <form onSubmit={saveOperationSettings}>
           <div className="grid gap-5 px-5 py-5 sm:grid-cols-3">
             <div><Label htmlFor="operation-max-attempts">Số lần thử tối đa</Label><TextInput id="operation-max-attempts" type="number" min={1} max={10} step={1} value={operationDraft.maxAttempts} onChange={(event) => setOperationDraft((current) => ({ ...current, maxAttempts: Number(event.target.value) }))} data-testid="input-operation-max-attempts" /><p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">Từ 1 đến 10 lần cho mỗi yêu cầu.</p></div>
             <div><Label htmlFor="operation-request-interval">Khoảng cách yêu cầu (giây)</Label><TextInput id="operation-request-interval" type="number" min={0.1} max={60} step={0.1} value={operationDraft.minRequestInterval} onChange={(event) => setOperationDraft((current) => ({ ...current, minRequestInterval: Number(event.target.value) }))} data-testid="input-operation-request-interval" /><p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">Từ 0,1 đến 60 giây giữa các yêu cầu.</p></div>
             <label htmlFor="operation-auto-resume" className="flex cursor-pointer items-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] p-3.5"><input id="operation-auto-resume" type="checkbox" checked={operationDraft.autoResume} onChange={(event) => setOperationDraft((current) => ({ ...current, autoResume: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" data-testid="input-operation-auto-resume" /><span><span className="block text-sm font-semibold">Tự động tiếp tục</span><span className="mt-1 block text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">Tiếp tục tác vụ sau khi có lỗi tạm thời.</span></span></label>
           </div>
           <div className="flex flex-col gap-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-[hsl(var(--muted-foreground))]">Thiết lập được lưu trên workspace này và áp dụng cho các lần chạy mới.</span><Button type="submit" variant="outline" data-testid="button-save-operation-settings">Lưu thiết lập</Button></div>
         </form>
       </Panel>

      <div className="flex items-start gap-3 rounded-md border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--accent)/.1)] px-4 py-3 text-[11px] leading-relaxed text-[hsl(29_45%_28%)]"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>Hãy dùng tài khoản Telegram chuyên dụng và tuân thủ giới hạn của Telegram. Công cụ không né giới hạn hoặc xoay vòng tài khoản để vượt rate limit. <Link href="/jobs" className="font-bold underline underline-offset-2">Đi tới tác vụ</Link></span></div>
    </div>
  </AppShell>;
}