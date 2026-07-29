import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
const { runExitRuleBacktest } = await import('../quant/exit-rule-backtest.service.js');
const s = await runExitRuleBacktest({ years: 7, scope: 'portfolio' });
const a = s.aggregate;
console.log('símbolo | motor    | Hoy      | no tocar | ¿operar pagó?');
for (const r of s.perSymbol) {
  console.log(`${r.symbol.padEnd(7)} | ${String(r.sellOnWarning.totalReturn).padStart(8)} | ${String(r.letItRun.totalReturn).padStart(8)} | ` +
    `${String(r.buyHold?.totalReturn ?? 's/d').padStart(8)} | ${r.letItRunBeatsBuyHold == null ? 's/d' : r.letItRunBeatsBuyHold ? 'SÍ' : 'no'}`);
}
console.log(`\nretorno  — motor ${a.avgReturnSellOnWarning} | Hoy ${a.avgReturnLetItRun} | no tocar ${a.avgReturnBuyHold}`);
console.log(`drawdown — motor ${a.avgMaxDdSellOnWarning} | Hoy ${a.avgMaxDdLetItRun} | no tocar ${a.avgMaxDdBuyHold}`);
console.log(`Hoy vs motor ${a.letItRunWinsReturn}/${a.evaluated} · Hoy vs NO TOCAR ${a.letItRunBeatsBuyHold}/${a.evaluatedBuyHold}`);
