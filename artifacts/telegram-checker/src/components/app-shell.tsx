import { type ReactNode } from 'react';
import { Activity, ChevronRight, CircleHelp, Database, LayoutDashboard, Settings, ShieldCheck, TerminalSquare } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/jobs', label: 'Jobs', icon: Database },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const pageLabel = location === '/jobs' ? 'Jobs' : location === '/settings' ? 'Settings' : 'Overview';
  return <div className="app-noise min-h-[100dvh] bg-[hsl(var(--background))]">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[238px] flex-col bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] md:flex">
      <div className="flex h-[74px] items-center border-b border-[hsl(var(--sidebar-border))] px-6">
        <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-[9px] bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]"><TerminalSquare size={17} strokeWidth={2.5} /><span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[hsl(var(--accent))]" /></div>
          <div><div className="font-display text-[15px] font-bold tracking-tight text-[hsl(var(--sidebar-accent-foreground))]">Relaycheck</div><div className="font-mono text-[9px] uppercase tracking-[.17em] text-[hsl(var(--sidebar-foreground)/.5)]">sandbox ops</div></div>
        </Link>
      </div>
      <div className="px-4 pt-7">
        <div className="mb-3 px-3 font-mono text-[9px] font-semibold uppercase tracking-[.18em] text-[hsl(var(--sidebar-foreground)/.42)]">Workspace</div>
        <nav className="space-y-1" aria-label="Primary navigation">
          {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={cn('group flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors', location === href ? 'bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))]' : 'text-[hsl(var(--sidebar-foreground)/.7)] hover:bg-[hsl(var(--sidebar-accent)/.65)] hover:text-[hsl(var(--sidebar-accent-foreground))]')}><Icon size={16} strokeWidth={location === href ? 2.4 : 1.8} /><span>{label}</span>{location === href && <ChevronRight className="ml-auto text-[hsl(var(--sidebar-primary))]" size={14} />}</Link>)}
        </nav>
      </div>
      <div className="mt-auto px-4 pb-5">
        <div className="mb-4 rounded-md border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/.55)] p-3.5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[hsl(var(--sidebar-accent-foreground))]"><ShieldCheck size={14} className="text-[hsl(var(--sidebar-primary))]" /> Safety envelope</div>
          <p className="text-[11px] leading-relaxed text-[hsl(var(--sidebar-foreground)/.58)]">Local sample mode. No Telegram session is connected.</p>
          <Link href="/settings" data-testid="link-safety-settings" className="mt-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--sidebar-primary))]">Review settings <ChevronRight size={12} /></Link>
        </div>
        <div className="flex items-center justify-between border-t border-[hsl(var(--sidebar-border))] pt-4 text-[10px] text-[hsl(var(--sidebar-foreground)/.45)]"><span className="flex items-center gap-1.5"><Activity size={12} /> Engine idle</span><CircleHelp size={13} /></div>
      </div>
    </aside>
    <div className="md:pl-[238px]">
      <header className="sticky top-0 z-20 flex h-[74px] items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/.9)] px-5 backdrop-blur-md sm:px-8">
        <div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-primary))] md:hidden"><TerminalSquare size={16} /></div><div><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]">Relaycheck / {pageLabel.toLowerCase()}</div><div className="font-display text-lg font-semibold tracking-tight">{pageLabel}</div></div></div>
        <div className="flex items-center gap-3"><span className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /> Local sandbox</span><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--sidebar))] font-display text-xs font-bold text-[hsl(var(--sidebar-primary))]" data-testid="avatar-operator">OP</div></div>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 lg:px-10">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex h-16 items-center justify-around border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.96)] px-6 backdrop-blur-md md:hidden">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-mobile-${label.toLowerCase()}`} className={cn('flex flex-col items-center gap-1 text-[10px] font-semibold', location === href ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]')}><Icon size={18} /><span>{label}</span></Link>)}
      </nav>
    </div>
  </div>;
}