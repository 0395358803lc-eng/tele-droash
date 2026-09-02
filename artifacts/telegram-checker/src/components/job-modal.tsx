import { useRef, useState } from 'react';
import { FileUp, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { checkTelegramAccountPhones, useListTelegramAccounts } from '@workspace/api-client-react';
import type { TelegramCheckResult } from '@workspace/api-client-react';
import { Button, Label, TextInput } from '@/components/ui-primitives';

interface JobModalProps {
  onClose: () => void;
  onCreate: (accountId: string, name: string, results: TelegramCheckResult[]) => Promise<void> | void;
}

export function JobModal({ onClose, onCreate }: JobModalProps) {
  const [name, setName] = useState('');
  const [phoneText, setPhoneText] = useState('');
  const [error, setError] = useState('');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const phones = phoneText.split(/[\n,;\t]+/).map((item) => item.trim()).filter(Boolean);
  const accountsQuery = useListTelegramAccounts({ query: { queryKey: ['/api/telegram-accounts'] } });
  const accounts = accountsQuery.data?.accounts ?? [];
  const connectedAccounts = accounts.filter((account) => account.status === 'connected');

  async function submit() {
    if (!name.trim()) { setError('Hãy đặt tên cho tác vụ kiểm tra.'); return; }
    if (!phones.length) { setError('Hãy thêm ít nhất một số điện thoại hoặc nhập một tệp.'); return; }
    const selectedAccountId = accountId || connectedAccounts[0]?.id;
    if (!selectedAccountId) { setError('Hãy kết nối ít nhất một tài khoản Telegram trước khi kiểm tra.'); return; }
    setBusy(true);
    setError('');
    try {
      const response = await checkTelegramAccountPhones(selectedAccountId, { phones });
      await onCreate(selectedAccountId, name.trim(), response.results);
      onClose();
    } catch (requestError) {
      const data = (requestError as { data?: { message?: string } } | undefined)?.data;
      setError(data?.message ?? (requestError instanceof Error ? requestError.message : 'Không thể chạy kiểm tra Telegram.'));
    } finally {
      setBusy(false);
    }
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setPhoneText(String(reader.result ?? '').replace(/^phone\s*[\n,]/i, ''));
    reader.readAsText(file);
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--sidebar)/.62)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Tạo tác vụ kiểm tra">
    <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[var(--shadow-lg)] animate-rise">
      <div className="flex items-start justify-between border-b border-[hsl(var(--border))] px-5 py-4"><div><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary))]">Chuẩn bị tác vụ</div><h2 className="mt-1 font-display text-xl font-semibold">Tác vụ kiểm tra mới</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Chọn account đã kết nối để gửi yêu cầu qua Telegram thật.</p></div><Button variant="quiet" className="h-8 w-8 p-0" onClick={onClose} disabled={busy} data-testid="button-close-job-modal"><X size={17} /></Button></div>
      <div className="space-y-5 px-5 py-5">
        <div><Label htmlFor="job-name">Tên tác vụ</Label><TextInput id="job-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Kiểm tra danh sách tháng này" data-testid="input-job-name" /></div>
        <div><Label htmlFor="job-account">Tài khoản Telegram sử dụng</Label>{connectedAccounts.length ? <select id="job-account" value={accountId || connectedAccounts[0].id} onChange={(event) => setAccountId(event.target.value)} className="h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="select-job-account">{connectedAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName || account.phoneNumber}{account.username ? ` · @${account.username}` : ''}</option>)}</select> : <div className="flex items-start gap-2 rounded-md border border-[hsl(var(--accent)/.45)] bg-[hsl(var(--accent)/.1)] px-3 py-2.5 text-xs text-[hsl(29_45%_28%)]"><ShieldCheck size={14} className="mt-0.5 shrink-0" /><span>Chưa có tài khoản connected. <a href="/settings" className="font-bold underline underline-offset-2">Mở Cài đặt</a> để thêm account.</span></div>}</div>
        <div><div className="mb-1.5 flex items-center justify-between"><Label htmlFor="phone-list">Số điện thoại</Label><button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-[hsl(var(--primary))]" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="button-import-phones"><FileUp size={13} /> Nhập .txt / .csv</button><input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); }} data-testid="input-import-file" /></div><textarea id="phone-list" value={phoneText} onChange={(event) => setPhoneText(event.target.value)} placeholder="Mỗi dòng một số điện thoại quốc tế" className="min-h-36 w-full resize-y rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2.5 font-mono text-xs leading-relaxed text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground)/.6)] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]" data-testid="textarea-phone-list" /><div className="mt-1.5 flex justify-between font-mono text-[10px] text-[hsl(var(--muted-foreground))]"><span>Mỗi dòng một số, hoặc phân tách bằng dấu phẩy/tab.</span><span>{phones.length} số đã nhận diện</span></div></div>
        {error && <p className="rounded-md bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-xs font-medium text-[hsl(var(--destructive))]" data-testid="text-job-form-error">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/.45)] px-5 py-4"><Button variant="quiet" onClick={onClose} disabled={busy} data-testid="button-cancel-job">Hủy</Button><Button onClick={submit} disabled={busy || !connectedAccounts.length} data-testid="button-create-job">{busy ? <><LoaderCircle size={14} className="animate-spin" /> Đang kiểm tra…</> : 'Bắt đầu kiểm tra'}</Button></div>
    </div>
  </div>;
}