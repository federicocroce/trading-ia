import type {
  SecondOrderEffect,
  AntiHypeFilterResult,
  Opportunity,
  SectorSummary,
  TriangulationConfidence,
} from '@trading/shared';
import {
  insertDailyReport,
  getLatestDailyReport,
  getDailyReportByDate,
} from '../db/repository.js';

export interface DailyReportData {
  reportDate: string;
  reportType: 'morning' | 'on-demand';
  generatedAt: number;
  newsSourceStats: Record<string, number>;
  totalNewsCount: number;
  triangulationStats: Record<TriangulationConfidence, number>;
  secondOrderEffects: SecondOrderEffect[];
  antiHypeResults: AntiHypeFilterResult;
  topRecommendations: Opportunity[];
  allOpportunities: Opportunity[];
  sectorSummary: SectorSummary[];
  totalSymbolsScanned: number;
  analysisEngine: string;
  analysisDetail: string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Read the latest daily report from DB (no re-processing).
 */
export function getStoredDailyReport(): DailyReportData | null {
  const row = getLatestDailyReport();
  if (!row) return null;

  try {
    return {
      reportDate: row.reportDate,
      reportType: row.reportType as 'morning' | 'on-demand',
      generatedAt: new Date(row.createdAt).getTime(),
      newsSourceStats: JSON.parse(row.newsSourceStats),
      totalNewsCount: row.totalNewsCount,
      triangulationStats: JSON.parse(row.triangulationStats),
      secondOrderEffects: JSON.parse(row.secondOrderEffects),
      antiHypeResults: JSON.parse(row.antiHypeResults),
      topRecommendations: JSON.parse(row.topRecommendations),
      allOpportunities: [], // not stored — too large
      sectorSummary: JSON.parse(row.sectorSummary),
      totalSymbolsScanned: row.totalSymbolsScanned,
      analysisEngine: row.analysisEngine,
      analysisDetail: row.analysisDetail,
    };
  } catch (err) {
    console.warn('[daily-report] Failed to parse stored report:', (err as Error).message);
    return null;
  }
}

/**
 * Persist a daily report to the database.
 * Called by the opportunity scan pipeline after completing a live scan.
 */
export function persistDailyReport(data: {
  reportType: 'morning' | 'on-demand';
  newsSourceStats: Record<string, number>;
  totalNewsCount: number;
  triangulationStats: Record<TriangulationConfidence, number>;
  secondOrderEffects: SecondOrderEffect[];
  antiHypeResults: AntiHypeFilterResult;
  topRecommendations: Opportunity[];
  sectorSummary: SectorSummary[];
  totalSymbolsScanned: number;
  analysisEngine: string;
  analysisDetail: string;
  scanId?: number;
}): void {
  try {
    insertDailyReport({
      reportDate: todayStr(),
      reportType: data.reportType,
      scanId: data.scanId,
      newsSourceStats: JSON.stringify(data.newsSourceStats),
      totalNewsCount: data.totalNewsCount,
      triangulationStats: JSON.stringify(data.triangulationStats),
      secondOrderEffects: JSON.stringify(data.secondOrderEffects),
      antiHypeResults: JSON.stringify(data.antiHypeResults),
      topRecommendations: JSON.stringify(data.topRecommendations),
      sectorSummary: JSON.stringify(data.sectorSummary),
      totalSymbolsScanned: data.totalSymbolsScanned,
      analysisEngine: data.analysisEngine,
      analysisDetail: data.analysisDetail,
    });
    console.log(`[daily-report] Reporte ${data.reportType} persistido en BD (${data.topRecommendations.length} recomendaciones)`);
  } catch (err) {
    console.error('[daily-report] Failed to persist:', (err as Error).message);
  }
}
