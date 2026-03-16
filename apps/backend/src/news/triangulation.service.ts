import type { NewsItem, TriangulationResult, TriangulationConfidence, NewsSourceType } from '@trading/shared';

// --- Tokenization & Similarity ---

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'for', 'and', 'nor', 'but',
  'or', 'yet', 'so', 'in', 'on', 'at', 'to', 'of', 'by', 'with', 'from',
  'as', 'into', 'about', 'after', 'before', 'between', 'under', 'over',
  'up', 'down', 'out', 'off', 'than', 'that', 'this', 'these', 'those',
  'not', 'its', 'it', 'he', 'she', 'they', 'we', 'you', 'his', 'her',
  'their', 'our', 'your', 'new', 'says', 'said', 'also', 'more', 'most',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function symbolOverlap(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  let common = 0;
  for (const s of b) {
    if (setA.has(s)) common++;
  }
  const total = new Set([...a, ...b]).size;
  return total > 0 ? common / total : 0;
}

function timeProximity(timeA: string, timeB: string): number {
  const diffMs = Math.abs(new Date(timeA).getTime() - new Date(timeB).getTime());
  const hours24 = 24 * 60 * 60 * 1000;
  if (diffMs > hours24) return 0;
  return 1 - diffMs / hours24; // 1.0 = same time, 0.0 = 24h apart
}

function computeSimilarity(a: NewsItem, b: NewsItem, tokensA: Set<string>, tokensB: Set<string>): number {
  const titleSim = jaccardSimilarity(tokensA, tokensB);
  const symbolSim = symbolOverlap(a.relatedTickers, b.relatedTickers);
  const timeSim = timeProximity(a.time, b.time);

  return titleSim * 0.6 + symbolSim * 0.3 + timeSim * 0.1;
}

// --- Union-Find ---

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return;

    if (this.rank[rootX] < this.rank[rootY]) {
      this.parent[rootX] = rootY;
    } else if (this.rank[rootX] > this.rank[rootY]) {
      this.parent[rootY] = rootX;
    } else {
      this.parent[rootY] = rootX;
      this.rank[rootX]++;
    }
  }

  getClusters(): Map<number, number[]> {
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root)!.push(i);
    }
    return clusters;
  }
}

// --- Major sources (for single-source confidence boost) ---

const MAJOR_SOURCES = new Set([
  'Reuters', 'Bloomberg', 'WSJ', 'Wall Street Journal', 'Financial Times',
  'CNBC', 'AP News', 'Associated Press', 'The New York Times',
]);

function isMajorSource(sourceName: string): boolean {
  const lower = sourceName.toLowerCase();
  for (const major of MAJOR_SOURCES) {
    if (lower.includes(major.toLowerCase())) return true;
  }
  return false;
}

// --- Confidence scoring ---

function computeConfidence(
  sourceCount: number,
  sourceDiversity: number,
  hasMajorSource: boolean,
): TriangulationConfidence {
  if (sourceCount >= 3) return 'high';
  if (sourceCount >= 2 && sourceDiversity >= 2) return 'high';
  if (sourceCount >= 2) return 'medium';
  if (sourceCount === 1 && hasMajorSource) return 'medium';
  return 'low';
}

// --- Main triangulation function ---

const SIMILARITY_THRESHOLD = 0.5;

export function triangulateNews(news: NewsItem[]): NewsItem[] {
  if (news.length === 0) return [];

  // Tokenize all titles
  const tokens = news.map((n) => tokenize(n.title));

  // Build similarity graph and cluster with Union-Find
  const uf = new UnionFind(news.length);

  for (let i = 0; i < news.length; i++) {
    for (let j = i + 1; j < news.length; j++) {
      const sim = computeSimilarity(news[i], news[j], tokens[i], tokens[j]);
      if (sim >= SIMILARITY_THRESHOLD) {
        uf.union(i, j);
      }
    }
  }

  const clusters = uf.getClusters();

  // Assign triangulation results to each news item
  const result: NewsItem[] = [];
  let clusterCounter = 0;

  for (const [, indices] of clusters) {
    clusterCounter++;
    const clusterId = `cluster-${clusterCounter}`;

    // Collect unique sources and source types in this cluster
    const sources = new Set<string>();
    const sourceTypes = new Set<string>();
    let hasMajor = false;

    for (const idx of indices) {
      const item = news[idx];
      sources.add(item.source);
      if (item.sourceType) sourceTypes.add(item.sourceType);
      if (isMajorSource(item.source)) hasMajor = true;
    }

    const sourceCount = sources.size;
    const sourceDiversity = sourceTypes.size;
    const confidence = computeConfidence(sourceCount, sourceDiversity, hasMajor);

    const triangulation: TriangulationResult = {
      storyClusterId: clusterId,
      sourceCount,
      sourceDiversity,
      confidence,
      corroboratedBy: Array.from(sources),
    };

    for (const idx of indices) {
      result.push({
        ...news[idx],
        triangulation,
      });
    }
  }

  // Sort by time (newest first), same as input
  result.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  // Stats
  const highCount = result.filter((n) => n.triangulation?.confidence === 'high').length;
  const mediumCount = result.filter((n) => n.triangulation?.confidence === 'medium').length;
  const lowCount = result.filter((n) => n.triangulation?.confidence === 'low').length;
  console.log(
    `[triangulation] ${result.length} noticias en ${clusterCounter} clusters` +
    ` (alta: ${highCount}, media: ${mediumCount}, baja: ${lowCount})`,
  );

  return result;
}

/**
 * Get triangulation stats summary
 */
export function getTriangulationStats(news: NewsItem[]): Record<TriangulationConfidence, number> {
  const stats: Record<TriangulationConfidence, number> = { high: 0, medium: 0, low: 0 };
  for (const item of news) {
    const conf = item.triangulation?.confidence ?? 'low';
    stats[conf]++;
  }
  return stats;
}
