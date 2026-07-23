/**
 * Rule table for patient-specific DICOM tag overrides applied to exported
 * segmentations.
 *
 * Each rule has a `match` block (all provided criteria must match — logical AND)
 * and an `overrides` block (DICOM keyword -> value) that is written onto the
 * generated dataset just before it is serialized for download.
 *
 * To support a new patient/tag in the future, add another entry to
 * `exportOverrideRules` below. No code changes are required.
 */
import type {
  PersonNameComponents,
  NaturalizedPersonName,
} from '../utils/personName';

/**
 * Match criteria for a rule. Every provided field must match for the rule to
 * apply. All string comparisons are trimmed and case-insensitive; person-name
 * values additionally ignore trailing empty PN components.
 */
export interface ExportRuleMatch {
  /** Match against DICOM PatientID (0010,0020). */
  patientId?: string;
  /** Match against DICOM PatientName (0010,0010). */
  patientName?: string;
  /** Match if EITHER PatientID or PatientName equals this value. */
  patientIdOrName?: string;
  /** Match against DICOM StudyDate (0008,0020), format `YYYYMMDD`. */
  studyDate?: string;
}

/**
 * A single override value. Plain strings are written as-is for string VRs; for
 * Person Name (PN) tags a string is treated as the Alphabetic component, and a
 * `PersonNameComponents` object is serialized to `Family^Given^Patronymic^...`.
 */
export type OverrideValue =
  | string
  | PersonNameComponents
  | NaturalizedPersonName;

export interface ExportOverrideRule {
  /** Stable identifier, for logging/debugging. */
  id: string;
  /** Human-readable description of intent. */
  description?: string;
  match: ExportRuleMatch;
  /**
   * DICOM keyword -> override value (e.g. `PerformingPhysicianName`).
   * Keywords are validated against the dcmjs data dictionary at apply time;
   * Person Name (PN VR) keywords are detected via the dictionary and coerced
   * into the naturalized `{ Alphabetic }` form the export path expects.
   */
  overrides: Record<string, OverrideValue>;
}

export const exportOverrideRules: ExportOverrideRule[] = [
  {
    id: 'fortest-2021-04-28-performing-physician',
    description:
      'Patient FORTEST, Study Date 28-Apr-2021: set Performing Physician Name (0008,1050) to Ivanov Ivan.',
    match: {
      patientIdOrName: 'FORTEST',
      studyDate: '20210428',
    },
    overrides: {
      // (0008,1050) PerformingPhysicianName. Family^Given (patronymic omitted).
      PerformingPhysicianName: {
        family: 'Ivanov',
        given: 'Ivan',
        patronymic: 'Ivanovich',
      },
    },
  },
];
