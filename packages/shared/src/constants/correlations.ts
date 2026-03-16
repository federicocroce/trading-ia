import type { SectorCorrelation } from '../types/intelligence.js';

/**
 * Mapa estatico de correlaciones entre sectores.
 * Usado como contexto para el LLM y como fallback si LLM falla.
 *
 * trigger: evento que activa la correlacion
 * from: sector/mercado origen del evento
 * to: sectores afectados
 * direction: positive (beneficia), negative (perjudica), mixed
 * strength: 0-1, que tan fuerte es la correlacion
 */
export const SECTOR_CORRELATIONS: SectorCorrelation[] = [
  // --- Petroleo y Energia ---
  {
    trigger: 'oil-price-up',
    from: 'us-energy',
    to: ['argentina-energy'],
    direction: 'positive',
    strength: 0.85,
  },
  {
    trigger: 'oil-price-down',
    from: 'us-energy',
    to: ['argentina-energy'],
    direction: 'negative',
    strength: 0.80,
  },
  {
    trigger: 'vaca-muerta-production-up',
    from: 'argentina-energy',
    to: ['argentina-finance'],
    direction: 'positive',
    strength: 0.5,
  },
  {
    trigger: 'opec-cut',
    from: 'global',
    to: ['us-energy', 'argentina-energy'],
    direction: 'positive',
    strength: 0.7,
  },

  // --- Dolar y Tasas ---
  {
    trigger: 'usd-strengthen',
    from: 'global',
    to: ['argentina-finance', 'argentina-cedears', 'argentina-energy'],
    direction: 'negative',
    strength: 0.65,
  },
  {
    trigger: 'interest-rates-up',
    from: 'global',
    to: ['bonds', 'argentina-finance', 'us-tech'],
    direction: 'negative',
    strength: 0.6,
  },
  {
    trigger: 'interest-rates-down',
    from: 'global',
    to: ['bonds', 'us-tech', 'crypto'],
    direction: 'positive',
    strength: 0.6,
  },
  {
    trigger: 'argentina-country-risk-down',
    from: 'argentina-finance',
    to: ['argentina-energy', 'argentina-cedears'],
    direction: 'positive',
    strength: 0.7,
  },
  {
    trigger: 'argentina-country-risk-up',
    from: 'argentina-finance',
    to: ['argentina-energy', 'argentina-cedears'],
    direction: 'negative',
    strength: 0.75,
  },

  // --- Tech y Crypto ---
  {
    trigger: 'crypto-rally',
    from: 'crypto',
    to: ['us-tech'],
    direction: 'positive',
    strength: 0.3,
  },
  {
    trigger: 'crypto-crash',
    from: 'crypto',
    to: ['us-tech'],
    direction: 'negative',
    strength: 0.25,
  },
  {
    trigger: 'ai-boom',
    from: 'us-tech',
    to: ['crypto'],
    direction: 'positive',
    strength: 0.2,
  },
  {
    trigger: 'tech-regulation',
    from: 'us-tech',
    to: ['argentina-cedears'],
    direction: 'negative',
    strength: 0.4,
  },

  // --- Macro Argentina ---
  {
    trigger: 'imf-agreement',
    from: 'global',
    to: ['argentina-finance', 'argentina-energy', 'argentina-cedears'],
    direction: 'positive',
    strength: 0.7,
  },
  {
    trigger: 'argentina-devaluation',
    from: 'argentina-finance',
    to: ['argentina-cedears', 'crypto'],
    direction: 'mixed',
    strength: 0.6,
  },

  // --- Bonos ---
  {
    trigger: 'inflation-up',
    from: 'global',
    to: ['bonds'],
    direction: 'negative',
    strength: 0.7,
  },
  {
    trigger: 'recession-fear',
    from: 'global',
    to: ['bonds', 'us-tech'],
    direction: 'mixed',
    strength: 0.5,
  },
];
