/**
 * Rule matching + dataset mutation for export tag overrides.
 *
 * The generated SEG dataset (dcmjs naturalized form) already carries the
 * referenced study's PatientID / PatientName / StudyDate, so we match and mutate
 * directly on that dataset — no external metadata lookup needed.
 */
import {
  exportOverrideRules,
  type ExportOverrideRule,
  type ExportRuleMatch,
} from '../rules/exportOverrideRules';
import { pnToComparableString, toNaturalizedPersonName } from './personName';
import { isKnownKeyword, isPnKeyword } from './dicomDictionary';

const LOG_PREFIX = '[export-tag-overrides]';

/** Recognized `match` criteria keys — compiler-checked against `ExportRuleMatch`. */
const KNOWN_MATCH_KEYS = [
  'patientId',
  'patientName',
  'patientIdOrName',
  'studyDate',
] as const satisfies readonly (keyof ExportRuleMatch)[];

const isKnownMatchKey = (key: string): key is keyof ExportRuleMatch =>
  (KNOWN_MATCH_KEYS as readonly string[]).includes(key);

/** Rule ids already validated, so misconfiguration warnings fire once per rule. */
const validatedRuleIds = new Set<string>();

/**
 * Warn (once per rule) about misconfigurations that would otherwise fail
 * silently: unknown/typo'd match keys, a match block with no recognized
 * criteria, and override keywords absent from the DICOM data dictionary.
 */
function validateRule(rule: ExportOverrideRule): void {
  if (validatedRuleIds.has(rule.id)) {
    return;
  }
  validatedRuleIds.add(rule.id);

  const matchKeys = Object.keys(rule.match ?? {});
  const unknownMatchKeys = matchKeys.filter(key => !isKnownMatchKey(key));
  if (unknownMatchKeys.length > 0) {
    console.warn(
      `${LOG_PREFIX} Rule "${rule.id}": unknown match key(s) `
      + `${unknownMatchKeys.join(', ')} — `
      + `did you mean one of: ${KNOWN_MATCH_KEYS.join(', ')}?`
    );
  }
  if (!matchKeys.some(isKnownMatchKey)) {
    console.warn(
      `${LOG_PREFIX} Rule "${rule.id}": match block has no recognized criteria — ` +
      `this rule will never apply.`
    );
  }

  Object.keys(rule.overrides ?? {}).forEach(keyword => {
    if (!isKnownKeyword(keyword)) {
      console.warn(
        `${LOG_PREFIX} Rule "${rule.id}": override keyword "${keyword}" is not in the DICOM ` +
          `data dictionary — it would be dropped from the exported file. Check the spelling.`
      );
    }
  });
}

/** Trim + lowercase for case-insensitive comparison. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normalize a Person Name for comparison: trim, drop trailing empty PN
 * components (`FORTEST^^^^` ≡ `FORTEST^` ≡ `FORTEST`), and lowercase.
 */
function normalizePn(value: string): string {
  return value.trim().replace(/\^+$/, '').toLowerCase();
}

/** Plain-string read (LO/DA VR values in a naturalized dataset). */
const asString =
  (value: unknown): string => (typeof value === 'string' ? value : '');

/** True if every provided criterion in `match` matches the dataset. */
export function datasetMatchesRule(
  dataset: Record<string, unknown>,
  match: ExportRuleMatch
): boolean {
  // A match block with no criteria never matches (avoids applying to everything).
  if (!KNOWN_MATCH_KEYS.some(key => match[key] !== undefined)) {
    return false;
  }

  const patientId = asString(dataset.PatientID);
  const patientName = pnToComparableString(dataset.PatientName);
  const studyDate = asString(dataset.StudyDate);

  if (
    match.patientId !== undefined
    && normalize(patientId) !== normalize(match.patientId)
  ) {
    return false;
  }

  if (
    match.patientName !== undefined &&
    normalizePn(patientName) !== normalizePn(match.patientName)
  ) {
    return false;
  }

  if (match.patientIdOrName !== undefined) {
    if (
      normalize(patientId) !== normalize(match.patientIdOrName) &&
      normalizePn(patientName) !== normalizePn(match.patientIdOrName)
    ) {
      return false;
    }
  }

  if (
    match.studyDate !== undefined
    && normalize(studyDate) !== normalize(match.studyDate)
  ) {
    return false;
  }

  return true;
}

/** Apply a single rule's overrides onto the dataset, coercing PN tags. */
function applyRuleOverrides(
  dataset: Record<string, unknown>,
  rule: ExportOverrideRule
): void {
  Object.entries(rule.overrides).forEach(([keyword, value]) => {
    if (isPnKeyword(keyword)) {
      dataset[keyword] = toNaturalizedPersonName(value);
    }
    else if (typeof value === 'string') {
      dataset[keyword] = value;
    }
    else {
      // Non-PN keyword given a component/naturalized object — skip rather than
      // write a malformed value, and warn so the misconfiguration is visible.
      console.warn(
        `${LOG_PREFIX} Rule "${rule.id}": non-string override for non-PN tag "${keyword}" ignored.`
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
    validateRule(rule);
    if (datasetMatchesRule(dataset, rule.match)) {
      applyRuleOverrides(dataset, rule);
      appliedRuleIds.push(rule.id);
    }
  }

  return appliedRuleIds;
}
