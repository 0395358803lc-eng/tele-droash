import { useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { Button, Label, TextInput } from '@/components/ui-primitives';

interface JobModalProps {
  onClose: () => void;
  onCreate: (name: string, phones: string[]) => void;
}

export function JobModal({ onClose, onCreate }: JobModalProps) {
  const [name, setName] = useState('');
  const [phoneText, setPhoneText] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const phones = phoneText.split(/[\n,;\t]+/).map((item) => item.trim()).filter(Boolean);

  function submit() {
    if (!name.trim()) { setError('Hãy đặt tên cho tác vụ kiểm tra.'); return; }
    if (!phones.length) { setError('Hãy thêm ít nhất một số điện thoại hoặc nhập một tệp.'); return; }
    onCreate(name.trim(), phones);
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setPhoneText(String(reader.result ?? '').replace(/^phone\s*[\n,]/i, ''));
    reader.readAsText(file);
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--sidebar)/.62)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Tạo tác vụ kiểm tra">
    <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[var(--shadow-lg)] animate-rise">
      <div className="flex items-start justify-between border-b border-[hsl(var(--border))] px-5 py-4"><div><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary))]">Chuẩn bị tác vụ</div><h2 className="mt-1 font-display text-xl font-semibold">Tác vụ kiểm tra mới</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Tạo một lần chạy mẫu cục bộ. Bộ máy Python chưa được kết nối.</p></div><Button variant="quiet" className="h-8 w-8 p-0" onClick={onClose} data-testid="button-close-job-modal"><X size={17} /></Button></div>
      <div className="space-y-5 px-5 py-5">
        <div><Label htmlFor="job-name">Tên tác vụ</Label><TextInput id="job-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="ví dụ: Danh sách đối tác tháng 4" data-testid="input-job-name" /></div>
        <div><div className="mb-1.5 flex items-center justify-between"><Label htmlFor="phone-list">Số điện thoại</Label><button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-[hsl(var(--primary))]" onClick={() => fileRef.current?.click()} data-testid="button-import-phones"><FileUp size={13} /> Nhập .txt / .csv</button><input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); }} data-testid="input-import-file" /></div><textarea id="phone-list" value={phoneText} onChange={(event) => setPhoneText(event.target.value)} placeholder={'+84 912 345 678\n+1 415 555 0148\n+44 20 7946 0821'} className="min-h-36 w-full resize-y rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2.5 font-mono text-xs leading-relaxed text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground)/.6)] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]" data-testid="textarea-phone-list" /><div className="mt-1.5 flex justify-between font-mono text-[10px] text-[hsl(var(--muted-foreground))]"><span>Mỗi dòng một số, hoặc phân tách bằng dấu phẩy/tab.</span><span>{phones.length} số đã nhận diện</span></div></div>
        {error && <p className="rounded-md bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-xs font-medium text-[hsl(var(--destructive))]" data-testid="text-job-form-error">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/.45)] px-5 py-4"><Button variant="quiet" onClick={onClose} data-testid="button-cancel-job">Hủy</Button><Button onClick={submit} data-testid="button-create-job">Tạo tác vụ mẫu</Button></div>
    </div>
  </div>;
}