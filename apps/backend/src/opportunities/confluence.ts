/**
 * Coverage-aware confluence percentage. Penalizes thin data so a 2-of-2 single-axis
 * agreement no longer reports 95% confidence.
 *
 * - rawConfluence = how aligned the directional votes are.
 * - coverage = how much data we actually have (votes vs an expected full slate).
 * - cap scales with the number of axes (tech/fund/sent) that contributed data.
 */
const EXPECTED_VOTES = 8;

export function computeConfluencePercent(
  dominantCount: number,
  totalVotes: number,
  axesWithData: number,
): number {
  if (totalVotes <= 0) return 30;
  const rawConfluence = (dominantCount / totalVotes) * 100;
  const coverage = Math.max(0, Math.min(1, totalVotes / EXPECTED_VOTES));
  const cap = axesWithData <= 1 ? 55 : axesWithData === 2 ? 75 : 95;
  const adjusted = rawConfluence * (0.5 + 0.5 * coverage);
  return Math.round(Math.min(cap, Math.max(20, adjusted)));
}
