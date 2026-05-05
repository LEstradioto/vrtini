/**
 * Pure mappings from semantic values (category, severity, etc.) to the CSS
 * class strings used in the HTML report. Split out of report-builder.ts so
 * the lookups are easy to test/extend in isolation and the main builder file
 * stays focused on HTML composition.
 */

export function getCategoryClass(category: string): string {
  if (category === 'regression') return 'category-regression';
  if (category === 'cosmetic' || category === 'noise') return 'category-cosmetic';
  return 'category-change';
}

export function getSeverityClass(severity: string): string {
  if (severity === 'critical') return 'severity-critical';
  if (severity === 'warning') return 'severity-warning';
  return 'severity-info';
}

export function getRecommendClass(recommendation: string): string {
  if (recommendation === 'approve') return 'recommend-approve';
  if (recommendation === 'reject') return 'recommend-reject';
  return 'recommend-review';
}

export function getVerdictClass(verdict: string): string {
  if (verdict === 'pass' || verdict === 'likely-pass') return 'verdict-pass';
  if (verdict === 'fail' || verdict === 'likely-fail') return 'verdict-fail';
  return 'verdict-review';
}

export function getDiffStatsClass(diffPercentage: number): string {
  if (diffPercentage > 5) return 'diff-high';
  if (diffPercentage > 1) return 'diff-medium';
  return 'diff-low';
}

export function getSsimClass(ssimScore: number): string {
  if (ssimScore >= 0.95) return 'ssim-good';
  if (ssimScore >= 0.8) return 'ssim-warn';
  return 'ssim-bad';
}

export function getPhashClass(similarity: number): string {
  if (similarity >= 0.95) return 'phash-good';
  if (similarity >= 0.85) return 'phash-warn';
  return 'phash-bad';
}

export function getAutoActionClass(action: string): string {
  if (action === 'approve') return 'auto-approve';
  if (action === 'reject') return 'auto-reject';
  return 'auto-flag';
}
