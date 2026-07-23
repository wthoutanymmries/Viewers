/**
 * Rule matching + dataset mutation for export tag overrides.
 *
 * The generated SEG dataset (dcmjs naturalized form) already carries the
 * referenced study's PatientID / PatientName / StudyDate, so we match and mutate
 * directly on that dataset — no external metadata lookup needed.
 */
import {
  exportOverrideRules,
  PN_KEYWORDS,
  type ExportOverrideRule,
  type ExportRuleMatch,
} from '../rules/exportOverrideRules';
import { pnToComparableString, toNaturalizedPersonName } from './personName';

/** Trim + lowercase for case-insensitive comparison. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Read PatientID (LO VR, plain string) from a naturalized dataset. */
function getPatientId(dataset: Record<string, unknown>): string {
  const value = dataset.PatientID;
  return typeof value === 'string' ? value : '';
}

/** Read StudyDate (DA VR, plain string) from a naturalized dataset. */
function getStudyDate(dataset: Record<string, unknown>): string {
  const value = dataset.StudyDate;
  return typeof value === 'string' ? value : '';
}

/** Read PatientName (PN VR) as a comparable Alphabetic string. */
function getPatientName(dataset: Record<string, unknown>): string {
  return pnToComparableString(dataset.PatientName);
}

/** True if every provided criterion in `match` matches the dataset. */
export function datasetMatchesRule(
  dataset: Record<string, unknown>,
  match: ExportRuleMatch
): boolean {
  const patientId = getPatientId(dataset);
  const patientName = getPatientName(dataset);
  const studyDate = getStudyDate(dataset);

  if (match.patientId !== undefined && normalize(patientId) !== normalize(match.patientId)) {
    return false;
  }

  if (match.patientName !== undefined && normalize(patientName) !== normalize(match.patientName)) {
    return false;
  }

  if (match.patientIdOrName !== undefined) {
    const target = normalize(match.patientIdOrName);
    if (normalize(patientId) !== target && normalize(patientName) !== target) {
      return false;
    }
  }

  if (match.studyDate !== undefined && normalize(studyDate) !== normalize(match.studyDate)) {
    return false;
  }

  // A match block with no criteria never matches (avoids applying to everything).
  const hasAnyCriterion =
    match.patientId !== undefined ||
    match.patientName !== undefined ||
    match.patientIdOrName !== undefined ||
    match.studyDate !== undefined;

  return hasAnyCriterion;
}

/** Apply a single rule's overrides onto the dataset, coercing PN tags. */
function applyRuleOverrides(dataset: Record<string, unknown>, rule: ExportOverrideRule): void {
  Object.entries(rule.overrides).forEach(([keyword, value]) => {
    if (PN_KEYWORDS.has(keyword)) {
      dataset[keyword] = toNaturalizedPersonName(value);
    } else if (typeof value === 'string') {
      dataset[keyword] = value;
    } else {
      // Non-PN keyword given a component/naturalized object — skip rather than
      // write a malformed value, and warn so the misconfiguration is visible.
      console.warn(
        `[export-tag-overrides] Rule "${rule.id}": non-string override for non-PN tag "${keyword}" ignored.`
      );
    }
  });
}

/**
 * Apply all matching export override rules to the generated dataset, in place.
 * Returns the list of applied rule ids (empty when nothing matched).
 */
export function applyExportOverrides(
  dataset: Record<string, unknown> | undefined | null,
  rules: ExportOverrideRule[] = exportOverrideRules
): string[] {
  if (!dataset) {
    return [];
  }

  const appliedRuleIds: string[] = [];

  for (const rule of rules) {
    if (datasetMatchesRule(dataset, rule.match)) {
      applyRuleOverrides(dataset, rule);
      appliedRuleIds.push(rule.id);
    }
  }

  return appliedRuleIds;
}
