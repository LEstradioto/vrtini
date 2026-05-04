/**
 * Barrel re-export of project-adjacent services, kept so existing route
 * callers keep working after the split. New code should import directly
 * from the specific service module.
 */

export * from './config-service.js';
export * from '../../../src/core/acceptance-store.js';
export * from './image-service.js';

// Domain re-exports kept for backward compat with existing imports that
// used to land here before P3.2.
export { computeAutoThresholdCaps } from '../../../src/domain/auto-threshold.js';
export { parseImageFilename } from '../../../src/domain/image-naming.js';
export type {
  Acceptance,
  AcceptanceMetrics,
  AcceptanceSignals,
  ImageFlag,
} from '../../../src/domain/acceptance.js';
export type { AutoThresholdCap, AutoThresholdCaps } from '../../../src/domain/auto-threshold.js';
