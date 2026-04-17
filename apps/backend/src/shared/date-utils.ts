// Buenos Aires timezone (UTC-3) — avoids date shift after 21hs local time
export function getToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}
