import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';
import { useMarketRefetchInterval } from '@/shared/useMarketRefetchInterval';

const PORTFOLIO_VERB: Record<string, { label: string; cls: string; border: string }> = {
  VENDER: { label: 'VENDER', cls: 'bg-red-500/20 text-red-400', border: 'border-l-red-500' },
  REVISAR: { label: 'REVISAR', cls: 'bg-amber-500/20 text-amber-400', border: 'border-l-amber-500' },
  MANTENER: { label: 'MANTENER', cls: 'bg-slate-500/20 text-slate-300', border: 'border-l-slate-600' },
};

// El verbo NO es una escala de fuerza esperada, es el ESTADO del papel hoy. El ranking por
// score se apagó el 2026-07-27 por no superar al azar (prompt maestro §4): entre dos del
// mismo estado no hay preferencia y la UI no debe sugerir ninguna.
const MARKET_VERB: Record<string, { label: string; cls: string; border: string }> = {
  OPERABLE: { label: 'OPERABLE', cls: 'bg-slate-500/20 text-slate-100', border: 'border-l-slate-400' },
  'EN SEGUIMIENTO': { label: 'EN SEGUIMIENTO', cls: 'bg-slate-700/40 text-slate-400', border: 'border-l-slate-700' },
  'EN ESPERA': { label: 'EN ESPERA', cls: 'bg-amber-500/20 text-amber-400', border: 'border-l-amber-500' },
};

function gainCls(pct: number): string {
  return pct >= 0 ? 'text-green-400' : 'text-red-400';
}
function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function relTime(iso?: string): string {
  if (!iso) return 'sin scan';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  return `hace ${Math.round(hrs / 24)} d`;
}

export function TodayPage() {
  const refetchInterval = useMarketRefetchInterval();
  const { data, isLoading } = trpc.opportunities.today.useQuery(undefined, { staleTime: 60_000, refetchInterval });
  const { data: accuracy } = trpc.opportunities.todayAccuracy.useQuery(undefined, { staleTime: 300_000 });
  const { goToSymbol } = useNavigation();

  // Dos bloques distintos, no un ranking: arriba lo que TIENE punto de entrada hoy (pocos,
  // decidibles); abajo lo que el motor sigue mirando sin setup (típicamente ~99 por scan —
  // mostrarlos como tarjetas los rotularía de operables sin serlo, objetivo #3: cero humo).
  const conSetup = (data?.opportunities ?? []).filter((o) => o.hasEntrySetup);
  const enSeguimiento = (data?.opportunities ?? []).filter((o) => !o.hasEntrySetup);

  return (
    <div className="p-4 space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">📋 Hoy</h2>
        <p className="text-[11px] text-muted-foreground mt-1">
          Tu decisión del día: un solo veredicto por cosa. El default es no hacer nada — actuá solo cuando algo lo pide.
        </p>
        {data && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Precios y stops en vivo · análisis del motor {relTime(data.scanDate)}
            {relTime(data.scanDate).includes('d') && <span className="text-amber-400"> — conviene correr el pipeline</span>}
          </p>
        )}
      </div>

      {/* Régimen por clase de activo (la cartera es multi-activo, no solo US) */}
      {data && (
        <div>
          <div className="flex flex-wrap gap-2">
            {[data.regimes.us, data.regimes.crypto, data.regimes.argentina].map((r) => (
              <div key={r.assetClass} className={`rounded-md border px-2 py-1 text-[11px] ${
                r.regime === 'risk_on' ? 'border-green-500/30 bg-green-500/5 text-green-400'
                : r.regime === 'risk_off' ? 'border-red-500/30 bg-red-500/5 text-red-400'
                : 'border-border bg-muted/20 text-muted-foreground'
              }`}>
                <span className="font-semibold">{r.label}: {r.regime === 'risk_on' ? 'RISK-ON' : r.regime === 'risk_off' ? 'RISK-OFF' : '—'}</span>
                {r.indexPrice != null && r.indexSma200 != null && (
                  <span className="text-muted-foreground"> · {r.proxy} {money(r.indexPrice)} vs SMA200 {money(r.indexSma200)}</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">En risk-off, cautela con compras nuevas de esa clase — está bajo su media larga.</p>
        </div>
      )}

      {isLoading && <p className="text-xs text-muted-foreground">Calculando…</p>}

      {/* ---- Tu cartera ---- */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tu cartera</h3>
        {data && data.portfolio.length === 0 && (
          <Card size="sm"><CardContent><p className="text-xs text-muted-foreground py-3">No tenés posiciones cargadas.</p></CardContent></Card>
        )}
        {data?.portfolio.map((p) => {
          const v = PORTFOLIO_VERB[p.verb] ?? PORTFOLIO_VERB.MANTENER;
          return (
            <Card key={p.symbol} size="sm" className={`border-l-4 ${v.border}`}>
              <CardContent className="py-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge className={`text-[10px] font-bold ${v.cls}`}>{v.label}</Badge>
                  <button className="text-sm font-bold hover:text-purple-400" onClick={() => goToSymbol(p.symbol)}>{p.symbol}</button>
                  <span className={`text-[11px] font-semibold ${gainCls(p.gainPct)}`}>{p.gainPct >= 0 ? '+' : ''}{p.gainPct}%</span>
                  {p.canAdd && <Badge className="text-[9px] bg-green-500/20 text-green-400">podés sumar</Badge>}
                  <span className="text-[10px] text-muted-foreground ml-auto">{money(p.value)} · P&L {p.pnl >= 0 ? '+' : ''}{money(p.pnl)}</span>
                </div>
                <p className="text-[11px] text-foreground">{p.reason}</p>
                {p.warning && <p className="text-[10px] text-amber-400">⚠ {p.warning}</p>}
                <div className="flex gap-3 text-[10px] text-muted-foreground">
                  <span>Costo {money(p.avgCost)}</span>
                  <span>Actual {money(p.currentPrice)}</span>
                  {p.stop != null && <span>Stop ↑ {money(p.stop)}</span>}
                  {p.target != null && <span>Objetivo {money(p.target)}</span>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* ---- Tesis gatilladas (convergencia: la opinión toca su entrada → aparece ACÁ) ---- */}
      {data && data.triggeredTheses.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">⚡ Tesis gatilladas</h3>
          {data.triggeredTheses.map((t) => (
            <Card size="sm" key={t.id}>
              <CardContent className="py-2 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge className={`text-[10px] font-bold ${t.direction === 'alcista' ? 'bg-trading-green/20 text-trading-green' : 'bg-trading-red/20 text-trading-red'}`}>
                    {t.direction.toUpperCase()}
                  </Badge>
                  <span className="text-sm font-bold">{t.primarySymbol}</span>
                  <span className="text-[11px] text-muted-foreground truncate">{t.title}</span>
                  {t.scanVerb && <span className="text-[10px] text-muted-foreground ml-auto">scan: {t.scanVerb}</span>}
                </div>
                <div className="flex gap-3 text-[10px] text-muted-foreground">
                  <span>Gatillo {t.entryTriggerPrice}</span>
                  <span>Inválida {t.invalidationPrice}</span>
                  <span>Horizonte {t.horizonDays}d</span>
                  {t.triggeredAt && <span>gatillada {t.triggeredAt.slice(0, 10)}</span>}
                </div>
                {t.conflictCaveat && <p className="text-[10px] text-amber-400">⚠ {t.conflictCaveat}</p>}
                <p className="text-[10px] text-muted-foreground/80">Opinión LLM medida — no es una orden. Detalle y track record en la tab Tesis.</p>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* ---- Oportunidades ---- */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Con setup de entrada hoy (no los tenés){conSetup.length ? ` · ${conSetup.length}` : ''}
        </h3>
        {conSetup.length > 0 && (
          <p className="text-[10px] text-muted-foreground/80">
            Orden alfabético. El orden NO indica preferencia: medido contra sortear del mismo universo,
            rankear por score no le gana al azar (−0.79%, t=−1.50 a 7d). Todos pasan los mismos filtros
            de calidad y el sistema no sabe cuál es mejor — elegí por diversificación contra tu cartera.
          </p>
        )}
        {data && conSetup.length === 0 && (
          <Card size="sm"><CardContent><p className="text-xs text-muted-foreground py-3">Ningún papel con setup de entrada hoy. Correr el pipeline para refrescar.</p></CardContent></Card>
        )}
        {conSetup.map((o) => {
          const v = MARKET_VERB[o.verb] ?? MARKET_VERB.OPERABLE;
          return (
            <Card key={o.symbol} size="sm" className={`border-l-4 ${v.border}`}>
              <CardContent className="py-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge className={`text-[10px] font-bold ${v.cls}`}>{v.label}</Badge>
                  <button className="text-sm font-bold hover:text-purple-400" onClick={() => goToSymbol(o.symbol)}>{o.symbol}</button>
                  {o.appearances != null && (
                    <span className={`text-[10px] ${o.persistenceCaveat != null ? 'text-amber-400 font-semibold' : 'text-muted-foreground'}`}>
                      {o.appearances === 1 ? 'nueva' : `${o.appearances}ª aparición`}
                    </span>
                  )}
                  {/* El score se sigue calculando y persistiendo (para poder re-medirlo si
                      algún día informa), pero NO se muestra: un "78" sugiere una precisión
                      que la medición contra el índice dice que no existe. */}
                </div>
                {o.reason && <p className="text-[11px] text-foreground">{o.reason}</p>}
                {o.timingCaveat && <p className="text-[10px] text-amber-400">⚠ {o.timingCaveat}</p>}
                {o.persistenceCaveat && <p className="text-[10px] text-amber-400">⚠ {o.persistenceCaveat}</p>}
                {o.cooldownCaveat && <p className="text-[10px] text-red-400">⛔ {o.cooldownCaveat}</p>}
                {/* Relación con TU cartera: el dato ya lo calcula el scan — acá se decide con él a la vista */}
                {o.diversification?.verdict === 'diversifies' && (
                  <p className="text-[10px] text-trading-green">🧩 {o.diversification.reason}</p>
                )}
                {o.diversification?.verdict === 'stacks' && (
                  <p className="text-[10px] text-red-400">⚠ {o.diversification.reason}</p>
                )}
                {o.diversification?.verdict === 'neutral' && o.diversification.reason.includes('Sin factores') && (
                  <p className="text-[10px] text-muted-foreground/70">◌ Relación con tu cartera: sin clasificar</p>
                )}
                {(o.entry != null || o.stop != null || o.target != null) && (
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    {o.entry != null && <span>Entrada {money(o.entry)}</span>}
                    {o.stop != null && <span>Stop {money(o.stop)}</span>}
                    {o.target != null && <span>Target {money(o.target)}</span>}
                  </div>
                )}
                {o.suggestedShares != null && o.suggestedShares > 0 && (
                  <div className="text-[10px] text-blue-400">
                    Sizing por riesgo (~1%): {o.suggestedShares} acciones · {money(o.suggestedDollars ?? 0)}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {accuracy?.total && (
          <p className="text-[10px] text-muted-foreground">
            Track record medido (sobre las propuestas con seguimiento): {accuracy.total.winRate}% de aciertos
            {accuracy.total.avgR != null && <> · R promedio {accuracy.total.avgR >= 0 ? '+' : ''}{accuracy.total.avgR}</>}
            {' '}(n={accuracy.total.n}).
            {accuracy.byBucket.length > 0 && (
              <>
                {' '}Por aparición:{' '}
                {accuracy.byBucket
                  .map((b) => `${b.bucket === '1' ? '1ª' : b.bucket === '2-3' ? '2ª–3ª' : '4ª+'} ${b.winRate}% (n=${b.n})`)
                  .join(' · ')}.
              </>
            )}
          </p>
        )}
      </section>

      {/* ---- En seguimiento: sin punto de entrada, por eso NO son tarjetas ---- */}
      {enSeguimiento.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            En seguimiento · {enSeguimiento.length}
          </h3>
          <p className="text-[10px] text-muted-foreground/80">
            Pasan los filtros de calidad pero <strong>todavía no tienen punto de entrada</strong>. No son
            recomendaciones: es el universo que el motor está mirando. Si alguno arma setup, sube al bloque de arriba.
          </p>
          <Card size="sm">
            <CardContent className="py-3">
              <div className="flex flex-wrap gap-1.5">
                {enSeguimiento.map((o) => (
                  <button
                    key={o.symbol}
                    onClick={() => goToSymbol(o.symbol)}
                    title={o.persistenceCaveat ?? o.cooldownCaveat ?? o.reason}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors hover:border-purple-400 ${
                      o.verb === 'EN ESPERA'
                        ? 'border-amber-500/40 text-amber-400/90'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {o.symbol}
                  </button>
                ))}
              </div>
              {enSeguimiento.some((o) => o.verb === 'EN ESPERA') && (
                <p className="text-[10px] text-amber-400/80 mt-2">
                  En ámbar: marcados por una regla medida (residente crónico o stop perforado).
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      <p className="text-[10px] text-muted-foreground border-t border-border pt-3">
        El sistema no garantiza nada. Su valor honesto: protegerte el capital en lo que tenés y darte una watchlist corta. La decisión final es tuya.
      </p>
    </div>
  );
}
