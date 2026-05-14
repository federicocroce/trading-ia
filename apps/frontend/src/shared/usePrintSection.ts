import { useEffect } from 'react';

function buildPrintCss(id: string): string {
  return `
@media print {
  /* Unlock all scroll/overflow containers so print sees full content */
  html, body { overflow: visible !important; height: auto !important; }
  [class*="overflow-y-auto"], [class*="overflow-x-auto"],
  [data-radix-scroll-area-viewport] {
    overflow: visible !important;
    max-height: none !important;
  }

  body * { visibility: hidden; }
  #${id}, #${id} * { visibility: visible; }

  /* Root: white bg + override ALL dark-theme CSS variables so any element
     using var(--color-*) automatically gets a print-safe value */
  #${id} {
    position: absolute; left: 0; top: 0; width: 100%;
    background: #ffffff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;

    --color-background: #ffffff;
    --color-foreground: #111111;
    --color-card: #f7f7f8;
    --color-card-foreground: #111111;
    --color-muted: #f0f0f1;
    --color-muted-foreground: #52525b;
    --color-border: #d4d4d8;
    --background: #ffffff;
    --foreground: #111111;
    --card: #f7f7f8;
    --card-foreground: #111111;
    --muted: #f0f0f1;
    --muted-foreground: #52525b;
    --border: #d4d4d8;
    --color-trading-green: #15803d;
    --color-trading-red: #b91c1c;
    --color-trading-yellow: #a16207;
    --color-trading-blue: #1d4ed8;
  }

  /* Strip all box-shadows; unlock inner scroll-only containers (not bars/progress) */
  #${id} * { box-shadow: none !important; }
  #${id} [class*="overflow-y-auto"],
  #${id} [class*="max-h-"] {
    overflow: visible !important;
    max-height: none !important;
  }

  /* Cards */
  #${id} [data-slot="card"] {
    background: #f7f7f8 !important;
    border: 1px solid #d4d4d8 !important;
    border-radius: 10px !important;
    page-break-inside: avoid;
  }

  /* Colored left-border accent cards */
  #${id} [class*="border-l-blue"]  { border-left: 4px solid #2563eb !important; }
  #${id} [class*="border-l-green"] { border-left: 4px solid #16a34a !important; }
  #${id} [class*="border-l-red"]   { border-left: 4px solid #dc2626 !important; }
  #${id} [class*="border-l-yellow"],
  #${id} [class*="border-l-amber"] { border-left: 4px solid #d97706 !important; }

  /* Nested content blocks */
  #${id} [class*="bg-muted"]      { background: #efefef !important; }
  #${id} [class*="bg-background"] { background: #f4f4f5 !important; }

  /* Colored semantic backgrounds */
  #${id} [class*="bg-green"]  { background: #dcfce7 !important; }
  #${id} [class*="bg-red"]    { background: #fee2e2 !important; }
  #${id} [class*="bg-blue"]   { background: #dbeafe !important; }
  #${id} [class*="bg-yellow"] { background: #fef9c3 !important; }
  #${id} [class*="bg-amber"]  { background: #fef3c7 !important; }
  #${id} [class*="bg-primary"]{ background: #dbeafe !important; }

  /* Text — explicit class overrides (dark accessible values) */
  #${id} .text-foreground,
  #${id} h2, #${id} h3          { color: #111111 !important; }
  #${id} .text-muted-foreground  { color: #52525b !important; }
  #${id} [class*="text-green"]   { color: #15803d !important; }
  #${id} [class*="text-red"]     { color: #b91c1c !important; }
  #${id} [class*="text-blue"]    { color: #1d4ed8 !important; }
  #${id} [class*="text-yellow"],
  #${id} [class*="text-amber"]   { color: #92400e !important; }
  #${id} [class*="text-purple"]  { color: #7e22ce !important; }
  #${id} [class*="text-teal"]    { color: #0f766e !important; }
  #${id} [class*="text-cyan"]    { color: #0e7490 !important; }
  #${id} [class*="text-sky"]     { color: #0369a1 !important; }
  #${id} [class*="text-indigo"]  { color: #4338ca !important; }
  #${id} [class*="text-orange"]  { color: #c2410c !important; }
  #${id} [class*="text-slate"],
  #${id} [class*="text-zinc"],
  #${id} [class*="text-gray"]    { color: #52525b !important; }

  /* Always show tab-info content block expanded in print */
  #${id} [data-tab-info-content] { display: block !important; }

  /* Hide interactive elements */
  #${id} button { display: none !important; }
  #${id} input  { display: none !important; }
  #${id} select { display: none !important; }

  /* Hide tab/nav chrome that can overlap fixed content */
  [role="tablist"], [role="tab"], nav, aside { display: none !important; }

  @page { margin: 1.5cm; size: A4; }
}`;
}

export function usePrintSection(id: string) {
  useEffect(() => {
    const styleId = `${id}-print-css`;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = buildPrintCss(id);
    document.head.appendChild(style);
    return () => { document.getElementById(styleId)?.remove(); };
  }, [id]);
}
