import { useState } from 'react';

interface TabInfoProps {
  children: React.ReactNode;
}

export function TabInfo({ children }: TabInfoProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border/60 bg-muted/20">
      <button
        className="w-full flex items-center gap-2 px-4 py-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors text-left print:hidden"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 opacity-60"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <span>¿Cómo funciona esta sección?</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div
        data-tab-info-content
        className={`px-4 pb-3 pt-1 text-[11px] text-muted-foreground space-y-2 border-t border-border/40 ${open ? '' : 'hidden print:block'}`}
      >
        {children}
      </div>
    </div>
  );
}

export function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">{title}</span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
