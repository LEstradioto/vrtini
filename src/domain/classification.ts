/**
 * Classification layer - maps DOM diff findings to change categories.
 * Pure functions, no I/O.
 */

import type {
  DomDiffResult,
  DomFinding,
  FindingType,
  FindingSeverity,
} from '../engines/dom-diff.js';
import type { ChangeCategory } from './ai-prompt.js';

export type ChangeClass = 'text' | 'layout' | 'spacing' | 'style' | 'background';

export interface ClassificationEntry {
  changeClass: ChangeClass;
  findings: DomFinding[];
  maxSeverity: FindingSeverity;
}

export interface ClassificationResult {
  classifications: ClassificationEntry[];
  primaryClass: ChangeClass | null;
  overallSeverity: FindingSeverity;
}

const FINDING_TO_CLASS: Record<FindingType, ChangeClass> = {
  text_changed: 'text',
  text_moved: 'text',
  layout_shift: 'layout',
  element_added: 'layout',
  element_removed: 'layout',
  spacing_change: 'spacing',
  style_change: 'style',
  background_change: 'background',
};

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

const CLASS_TO_CATEGORY: Record<ChangeClass, ChangeCategory> = {
  text: 'content_change',
  layout: 'layout_shift',
  spacing: 'layout_shift',
  style: 'cosmetic',
  background: 'cosmetic',
};

function maxSeverity(a: FindingSeverity, b: FindingSeverity): FindingSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export function classifyFindings(diffResult: DomDiffResult): ClassificationResult {
  const grouped = new Map<ChangeClass, DomFinding[]>();

  for (const finding of diffResult.findings) {
    const cls = FINDING_TO_CLASS[finding.type];
    const list = grouped.get(cls) ?? [];
    list.push(finding);
    grouped.set(cls, list);
  }

  const classifications: ClassificationEntry[] = [];
  let overallSeverity: FindingSeverity = 'info';

  for (const [changeClass, findings] of grouped) {
    let classSeverity: FindingSeverity = 'info';
    for (const f of findings) {
      classSeverity = maxSeverity(classSeverity, f.severity);
    }
    // Sort findings within each class: critical first
    findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    classifications.push({ changeClass, findings, maxSeverity: classSeverity });
    overallSeverity = maxSeverity(overallSeverity, classSeverity);
  }

  // Sort classifications by severity (most severe first), then by finding count
  classifications.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity];
    if (sevDiff !== 0) return sevDiff;
    return b.findings.length - a.findings.length;
  });

  const primaryClass = classifications.length > 0 ? classifications[0].changeClass : null;

  return { classifications, primaryClass, overallSeverity };
}

export function classToCategory(cls: ChangeClass): ChangeCategory {
  return CLASS_TO_CATEGORY[cls];
}

export function classificationToCategory(
  classification: ClassificationResult
): ChangeCategory | undefined {
  if (!classification.primaryClass) return undefined;
  return classToCategory(classification.primaryClass);
}
