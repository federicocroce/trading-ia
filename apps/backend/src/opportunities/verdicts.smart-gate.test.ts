import { describe, it, expect, beforeEach } from 'vitest';
import { applySmartAction, smartUpgradeEnabled } from './verdicts.service.js';

describe('applySmartAction — la capa smart tampoco puede subir la acción', () => {
  beforeEach(() => { delete process.env.SMART_CAN_UPGRADE; });

  // Hallazgo del review adversarial (2026-07-28): la regla dura #2 gatea al LLM
  // ("solo puede degradar") y ese gate funciona. Pero la capa `smart` reemplazaba el
  // veredicto SIN gate: `if (smartAction !== finalAction) finalAction = smartAction`.
  // En los datos había 9 subidas WATCH→BUY, la más reciente 5 días antes del hallazgo
  // (GE, ISRG, XLC, ROK, XLE, FXI, KEEL, NUVL). Es el patrón exacto del caso SDOT
  // entrando por otra puerta. Y con solo 10 de 37 veredictos `smart` medidos, es una
  // capa con poder de decisión y sin evidencia.
  it('degradar SIEMPRE se permite: es la dirección segura', () => {
    expect(applySmartAction('BUY', 'WATCH')).toBe('WATCH');
    expect(applySmartAction('BUY', 'SELL')).toBe('SELL');
    expect(applySmartAction('HOLD', 'SELL')).toBe('SELL');
  });

  it('subir queda BLOQUEADO por default (fail-closed)', () => {
    expect(applySmartAction('WATCH', 'BUY')).toBe('WATCH');
    expect(applySmartAction('SELL', 'BUY')).toBe('SELL');
    expect(applySmartAction('WATCH', 'HOLD')).toBe('WATCH');
  });

  it('acción desconocida no rompe: se queda con la algorítmica', () => {
    expect(applySmartAction('BUY', 'INVENTADA')).toBe('BUY');
    expect(applySmartAction('INVENTADA', 'WATCH')).toBe('INVENTADA');
  });

  it('la flag permite re-habilitar la subida para volver a medirla', () => {
    try {
      process.env.SMART_CAN_UPGRADE = '1';
      expect(smartUpgradeEnabled()).toBe(true);
      expect(applySmartAction('WATCH', 'BUY')).toBe('BUY');
    } finally {
      delete process.env.SMART_CAN_UPGRADE;
    }
  });

  it('solo "1" habilita — cualquier otro valor deja el bloqueo puesto', () => {
    try {
      for (const v of ['0', 'true', 'si', '']) {
        process.env.SMART_CAN_UPGRADE = v;
        expect(applySmartAction('WATCH', 'BUY')).toBe('WATCH');
      }
    } finally {
      delete process.env.SMART_CAN_UPGRADE;
    }
  });
});
