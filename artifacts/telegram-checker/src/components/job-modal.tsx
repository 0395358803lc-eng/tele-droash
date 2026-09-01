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
    if (!name.trim()) { setError('Give this checking job a name.'); return; }
    if (!phones.length) { setError('Add at least one phone number or import a file.'); return; }
    onCreate(name.trim(), phones);
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setPhoneText(String(reader.result ?? '').replace(/^phone\s*[\n,]/i, ''));
    reader.readAsText(file);
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--sidebar)/.62)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Create checking job">
    <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[var(--shadow-lg)] animate-rise">
      <div className="flex items-start justify-between border-b border-[hsl(var(--border))] px-5 py-4"><div><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--primary))]">Prepare run</div><h2 className="mt-1 font-display text-xl font-semibold">New checking job</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Create a local sample run. The Python engine is not connected.</p></div><Button variant="quiet" className="h-8 w-8 p-0" onClick={onClose} data-testid="button-close-job-modal"><X size={17} /></Button></div>
      <div className="space-y-5 px-5 py-5">
        <div><Label htmlFor="job-name">Job name</Label><TextInput id="job-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. April partner list" data-testid="input-job-name" /></div>
        <div><div className="mb-1.5 flex items-center justify-between"><Label htmlFor="phone-list">Phone numbers</Label><button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-[hsl(var(--primary))]" onClick={() => fileRef.current?.click()} data-testid="button-import-phones"><FileUp size={13} /> Import .txt / .csv</button><input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); }} data-testid="input-import-file" /></div><textarea id="phone-list" value={phoneText} onChange={(event) => setPhoneText(event.target.value)} placeholder={'+1 415 555 0148\n+44 20 7946 0821\n+33 1 42 68 53 00'} className="min-h-36 w-full resize-y rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 py-2.5 font-mono text-xs leading-relaxed text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground)/.6)] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]" data-testid="textarea-phone-list" /><div className="mt-1.5 flex justify-between font-mono text-[10px] text-[hsl(var(--muted-foreground))]"><span>One number per line, comma, or tab separated.</span><span>{phones.length} detected</span></div></div>
        {error && <p className="rounded-md bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-xs font-medium text-[hsl(var(--destructive))]" data-testid="text-job-form-error">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted)/.45)] px-5 py-4"><Button variant="quiet" onClick={onClose} data-testid="button-cancel-job">Cancel</Button><Button onClick={submit} data-testid="button-create-job">Create sample job</Button></div>
    </div>
  </div>;
}