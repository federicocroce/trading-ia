export function printWithTitle(sectionName: string, date?: string) {
  const dateStr = date ?? new Date().toISOString().slice(0, 10);
  const prev = document.title;
  document.title = `dashboard ${sectionName} ${dateStr}`;
  window.print();
  document.title = prev;
}
