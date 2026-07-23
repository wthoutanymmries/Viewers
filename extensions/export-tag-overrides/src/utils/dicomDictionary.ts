/**
 * Thin wrapper over the dcmjs DICOM data dictionary, used to derive a
 * keyword's VR instead of maintaining hard-coded tag lists.
 */
import dcmjs from 'dcmjs';

const { nameMap } = dcmjs.data.DicomMetaDictionary;

/** True when the keyword exists in the DICOM data dictionary. */
export function isKnownKeyword(keyword: string): boolean {
  return Boolean(nameMap?.[keyword]);
}

/** True when the keyword is a Person Name (PN VR) attribute. */
export function isPnKeyword(keyword: string): boolean {
  return nameMap?.[keyword]?.vr === 'PN';
}
