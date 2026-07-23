import { id } from './id.js';
import getCommandsModule from './getCommandsModule';

/**
 * Export Tag Overrides extension.
 *
 * Applies a rule-based table of DICOM tag overrides to segmentations exported
 * via the "Store Segmentation" dialog's Download button (Manage Current
 * Segmentation → Export → DICOM SEG) — and only that path. See
 * `src/rules/exportOverrideRules.ts` to add rules for additional
 * patients/studies/tags, and `getCommandsModule.ts` for the trigger scoping.
 */
const exportTagOverridesExtension = {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id,
  getCommandsModule,
};

export default exportTagOverridesExtension;
