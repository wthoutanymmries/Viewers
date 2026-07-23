/**
 * Helpers for building and normalizing DICOM Person Name (PN VR) values.
 *
 * A DICOM PN is a caret-delimited string with up to five components, in order:
 *   Family^Given^Middle(Patronymic)^Prefix^Suffix
 *
 * dcmjs represents a naturalized PN as an object `{ Alphabetic, Ideographic?, Phonetic? }`
 * (or an array of those for VM > 1). We only deal with the single-value Alphabetic
 * group representation here, which is what the SEG export path produces/consumes.
 */

/** Component form of a DICOM Person Name. All fields optional. */
export interface PersonNameComponents {
  family?: string;
  given?: string;
  /** Middle name — DICOM's third PN component, commonly used for a patronymic. */
  patronymic?: string;
  prefix?: string;
  suffix?: string;
}

/** dcmjs naturalized single-value PN group. */
export interface NaturalizedPersonName {
  Alphabetic: string;
}

/**
 * Build a caret-delimited DICOM PN string from components.
 * Trailing empty components are trimmed (e.g. `Doe^John` rather than `Doe^John^^^`).
 */
export function componentsToPnString(components: PersonNameComponents): string {
  return [
    components.family ?? '',
    components.given ?? '',
    components.patronymic ?? '',
    components.prefix ?? '',
    components.suffix ?? '',
  ]
    .join('^')
    // Drop trailing empty components so we emit the shortest valid representation.
    .replace(/\^+$/, '');
}

/** Component keys — compiler-checked against `PersonNameComponents`. */
const COMPONENT_KEYS = [
  'family',
  'given',
  'patronymic',
  'prefix',
  'suffix',
] as const satisfies readonly (keyof PersonNameComponents)[];

/** Type guard: is this a PersonNameComponents object (vs. a raw string / naturalized PN)? */
export function isPersonNameComponents(
  value: unknown
): value is PersonNameComponents {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return COMPONENT_KEYS.some(key => key in value);
}

/**
 * Coerce a PN value (raw string, component object, or already-naturalized PN)
 * into the dcmjs naturalized form `{ Alphabetic }` used by the export dataset.
 */
export function toNaturalizedPersonName(
  value: string | PersonNameComponents | NaturalizedPersonName
): NaturalizedPersonName {
  if (typeof value === 'string') {
    return { Alphabetic: value };
  }
  if (isPersonNameComponents(value)) {
    return { Alphabetic: componentsToPnString(value) };
  }
  // Already a naturalized PN group.
  return value;
}

/**
 * Normalize any naturalized-PN shape (string, `{ Alphabetic }`, or an array of
 * those) down to a plain comparable Alphabetic string. Returns '' when absent.
 */
export function pnToComparableString(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return pnToComparableString(value[0]);
  }
  if (
    typeof value === 'object'
    && 'Alphabetic' in (value as Record<string, unknown>)
  ) {
    const alphabetic = (value as NaturalizedPersonName).Alphabetic;
    return typeof alphabetic === 'string' ? alphabetic : '';
  }
  return '';
}
