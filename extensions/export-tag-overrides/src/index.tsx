import { id } from './id.js';
import getCommandsModule from './getCommandsModule';

/**
 * Export Tag Overrides extension.
 *
 * Applies a rule-based table of DICOM tag overrides to segmentations exported
 * (downloaded) from the Segmentation editor. See `src/rules/exportOverrideRules.ts`
 * to add rules for additional patients/studies/tags.
 */
const exportTagOverridesExtension = {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id,
  getCommandsModule,
};

export default exportTagOverridesExtension;
