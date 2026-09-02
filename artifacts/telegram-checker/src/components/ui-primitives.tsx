import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Button({ className, variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'outline' | 'danger' }) {
  const variants = {
    primary: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))] hover:brightness-105',
    quiet: 'bg-transparent text-[hsl(var(--muted-foreground))] border-transparent hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]',
    outline: 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] border-[hsl(var(--border))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]',
    danger: 'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] border-[hsl(var(--destructive))] hover:brightness-105',
  };
  return <button {...props} className={cn('inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3.5 text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-45', variants[variant], className)} />;
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-sm text-[hsl(var(--foreground))] outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]', className)} />;
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-lg border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] shadow-[var(--shadow-xs)]', className)}>{children}</section>;
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{children}</label>;
}

export function StatusPill({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    running: { label: 'Đang chạy', className: 'bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]' },
    paused: { label: 'Đã tạm dừng', className: 'bg-[hsl(var(--accent)/.2)] text-[hsl(29_58%_31%)]' },
    queued: { label: 'Đang chờ', className: 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]' },
    completed: { label: 'Hoàn tất', className: 'bg-[hsl(162_45%_88%)] text-[hsl(170_48%_29%)]' },
    failed: { label: 'Thất bại', className: 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]' },
    found: { label: 'Tìm thấy', className: 'bg-[hsl(var(--primary)/.12)] text-[hsl(var(--primary))]' },
    not_discoverable: { label: 'Không thể xác định', className: 'bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]' },
    invalid: { label: 'Không hợp lệ', className: 'bg-[hsl(var(--accent)/.2)] text-[hsl(29_58%_31%)]' },
    error: { label: 'Lỗi', className: 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]' },
    rate_limited: { label: 'Bị giới hạn', className: 'bg-[hsl(var(--accent)/.2)] text-[hsl(29_58%_31%)]' },
  };
  const item = config[status] ?? config.queued;
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide', item.className)}><span className={cn('mr-1.5 h-1.5 w-1.5 rounded-full bg-current', status === 'running' && 'pulse-dot')} />{item.label}</span>;
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return <div className={cn('h-1.5 overflow-hidden rounded-full bg-[hsl(var(--muted))]', className)}><div className="h-full rounded-full bg-[hsl(var(--primary))] transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="flex min-h-48 flex-col items-center justify-center px-5 py-10 text-center"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-[hsl(var(--primary)/.45)] bg-[hsl(var(--primary)/.06)] text-[hsl(var(--primary))]"><span className="font-mono text-lg">/</span></div><h3 className="font-display text-base font-semibold">{title}</h3><p className="mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">{detail}</p>{action && <div className="mt-4">{action}</div>}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[hsl(var(--muted))]', className)} />;
}