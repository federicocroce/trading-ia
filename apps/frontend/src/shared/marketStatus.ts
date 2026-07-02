// Estado del mercado US (NYSE/NASDAQ) calculado en hora del Este (America/New_York),
// 100% client-side: refleja el reloj real, independiente de si Yahoo respondió.
// Razón de existir: en feriado/finde los precios quedan congelados en el último cierre
// y la app no avisaba — parecía roto cuando solo estaba cerrado.

// Cierres totales NYSE. Clave YYYY-MM-DD en hora del Este. Los "observed" ya están
// corridos al viernes/lunes cuando el feriado cae en finde.
const NYSE_HOLIDAYS: Record<string, string> = {
  '2025-01-01': 'Año Nuevo',
  '2025-01-20': 'Martin Luther King Jr. Day',
  '2025-02-17': "Presidents' Day",
  '2025-04-18': 'Viernes Santo',
  '2025-05-26': 'Memorial Day',
  '2025-06-19': 'Juneteenth',
  '2025-07-04': 'Independence Day',
  '2025-09-01': 'Labor Day',
  '2025-11-27': 'Thanksgiving',
  '2025-12-25': 'Navidad',
  '2026-01-01': 'Año Nuevo',
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Viernes Santo',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observado)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving',
  '2026-12-25': 'Navidad',
  '2027-01-01': 'Año Nuevo',
  '2027-01-18': 'Martin Luther King Jr. Day',
  '2027-02-15': "Presidents' Day",
  '2027-03-26': 'Viernes Santo',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth (observado)',
  '2027-07-05': 'Independence Day (observado)',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving',
  '2027-12-24': 'Navidad (observado)',
};

// Medio día NYSE: cierre 13:00 ET (víspera de feriados / día después de Thanksgiving).
const NYSE_HALF_DAYS: Record<string, string> = {
  '2025-07-03': 'víspera de Independence Day',
  '2025-11-28': 'día después de Thanksgiving',
  '2025-12-24': 'víspera de Navidad',
  '2026-11-27': 'día después de Thanksgiving',
  '2026-12-24': 'víspera de Navidad',
  '2027-11-26': 'día después de Thanksgiving',
};

const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const FULL_CLOSE_MIN = 16 * 60; // 16:00 ET
const HALF_CLOSE_MIN = 13 * 60; // 13:00 ET

export interface MarketStatus {
  open: boolean;
  tone: 'open' | 'closed';
  /** Texto corto para el badge. */
  label: string;
  /** Detalle para el tooltip. */
  detail: string;
}

function etParts(now: Date): { date: string; weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'), // 'Mon' .. 'Sun'
    minutes: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
  };
}

const STALE = 'Los precios muestran el último cierre; el scan no trae velas nuevas.';

export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const { date, weekday, minutes } = etParts(now);

  const holiday = NYSE_HOLIDAYS[date];
  if (holiday) {
    return { open: false, tone: 'closed', label: `Cerrado · ${holiday}`, detail: `Feriado NYSE. ${STALE}` };
  }

  if (weekday === 'Sat' || weekday === 'Sun') {
    return { open: false, tone: 'closed', label: 'Cerrado · fin de semana', detail: STALE };
  }

  const halfReason = NYSE_HALF_DAYS[date];
  const closeMin = halfReason ? HALF_CLOSE_MIN : FULL_CLOSE_MIN;
  const closeLabel = halfReason ? '13:00' : '16:00';

  if (minutes < OPEN_MIN) {
    return { open: false, tone: 'closed', label: 'Cerrado · abre 9:30 ET', detail: STALE };
  }
  if (minutes >= closeMin) {
    return { open: false, tone: 'closed', label: 'Cerrado · cerró hoy', detail: STALE };
  }

  return {
    open: true,
    tone: 'open',
    label: halfReason ? 'Abierto · medio día' : 'Mercado abierto',
    detail: halfReason
      ? `NYSE en medio día (${halfReason}) — cierra ${closeLabel} ET.`
      : `NYSE abierto — cierra ${closeLabel} ET.`,
  };
}
