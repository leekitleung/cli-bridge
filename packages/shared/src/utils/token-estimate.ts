export interface TokenEstimateMetrics {
  rawLength?: number;
  processedLength: number;
  rawTokenEstimate?: number;
  processedTokenEstimate: number;
  compressionRatio?: number;
}

export function estimateTokenCount(content: string): number {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  return Math.ceil(trimmed.length / 4);
}

export function calculateCompressionRatio(rawLength: number, processedLength: number): number | undefined {
  if (rawLength <= 0) {
    return undefined;
  }

  return Number((processedLength / rawLength).toFixed(4));
}

export function createTokenEstimateMetrics(rawContent: string, processedContent: string): TokenEstimateMetrics {
  const rawLength = rawContent.length;
  const processedLength = processedContent.length;

  return {
    rawLength,
    processedLength,
    rawTokenEstimate: estimateTokenCount(rawContent),
    processedTokenEstimate: estimateTokenCount(processedContent),
    compressionRatio: calculateCompressionRatio(rawLength, processedLength),
  };
}
