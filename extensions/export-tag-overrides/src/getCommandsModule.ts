import { Types } from '@ohif/core';
import { applyExportOverrides } from './utils/applyExportOverrides';
import { pnToComparableString } from './utils/personName';

const LOG_PREFIX = '[export-tag-overrides]';

/**
 * Applies rule-based DICOM tag overrides to exported segmentations (and any
 * other exported DICOM) by wrapping the shared `createStoreFunction` command.
 *
 * Why `createStoreFunction` (and not `downloadSegmentation`)?
 * Every export path funnels through `createStoreFunction` (registered by
 * `@ohif/extension-default` in the `DEFAULT` context) to obtain a `storeFn`,
 * then calls `storeFn(dataset)`:
 *   - "Manage Current Segmentation → Export → DICOM SEG" runs `storeSegmentation`
 *     (which resolves `createStoreFunction` with the data source picked in the
 *     Store dialog — including its "Download" button).
 *   - the standalone `downloadSegmentation` command uses `createStoreFunction`
 *     with `dataSource: 'download'`.
 * Wrapping `createStoreFunction` therefore intercepts the dataset at the single
 * serialization boundary common to all of them — no need to touch
 * cornerstone-dicom-seg or reimplement `storeSegmentation`.
 *
 * This extension must be registered AFTER `@ohif/extension-default` so that this
 * definition wins the same-context (`DEFAULT`) registration. Load order is
 * guaranteed because extension-default is a global/default extension registered
 * at app init, while this extension is registered later, on Segmentation-mode
 * entry.
 */
const getCommandsModule = ({
  commandsManager,
}: Types.Extensions.ExtensionParams): Types.Extensions.CommandsModule => {
  console.log(`${LOG_PREFIX} commands module initializing (wrapping createStoreFunction)`);

  // Capture the original createStoreFunction BEFORE our definition overwrites it
  // in the DEFAULT context. getCommand returns the live definition object, so
  // this reference keeps pointing at the original even after we register ours.
  const originalCreateStoreFunction = commandsManager.getCommand('createStoreFunction', 'DEFAULT');

  if (!originalCreateStoreFunction?.commandFn) {
    console.warn(
      `${LOG_PREFIX} original createStoreFunction not found in DEFAULT context — overrides will NOT be applied. ` +
        `Is this extension registered after @ohif/extension-default?`
    );
  } else {
    console.log(`${LOG_PREFIX} captured original createStoreFunction from DEFAULT context`);
  }

  /** Apply override rules to a single naturalized instance, with logging. */
  const overrideInstance = (instance: Record<string, unknown>, index: number): void => {
    const patientName = pnToComparableString(instance?.PatientName);
    const patientId = typeof instance?.PatientID === 'string' ? instance.PatientID : '';
    const studyDate = typeof instance?.StudyDate === 'string' ? instance.StudyDate : '';
    const modality = typeof instance?.Modality === 'string' ? instance.Modality : '';

    console.log(
      `${LOG_PREFIX} instance[${index}] Modality=${modality} PatientName="${patientName}" ` +
        `PatientID="${patientId}" StudyDate="${studyDate}"`
    );

    const appliedRuleIds = applyExportOverrides(instance);

    if (appliedRuleIds.length > 0) {
      console.log(
        `${LOG_PREFIX} instance[${index}] applied rule(s): ${appliedRuleIds.join(', ')} → ` +
          `PerformingPhysicianName=`,
        instance.PerformingPhysicianName
      );
    } else {
      console.log(`${LOG_PREFIX} instance[${index}] no rule matched — dataset left unchanged`);
    }
  };

  const actions = {
    createStoreFunction: (args: { dataSource?: string } = {}) => {
      console.log(`${LOG_PREFIX} createStoreFunction called; dataSource=`, args?.dataSource);

      if (!originalCreateStoreFunction?.commandFn) {
        return undefined;
      }

      // Delegate to the original to get the real store function, preserving any
      // configured command options.
      const storeFn = originalCreateStoreFunction.commandFn({
        ...(originalCreateStoreFunction.options || {}),
        ...args,
      });

      if (typeof storeFn !== 'function') {
        console.warn(`${LOG_PREFIX} original createStoreFunction returned no store fn; passing through`);
        return storeFn;
      }

      // Return a wrapper that mutates the dataset(s) just before the original
      // store function serializes/sends them.
      return async (dicom: unknown, ...rest: unknown[]) => {
        const instances = Array.isArray(dicom) ? dicom : [dicom];
        console.log(`${LOG_PREFIX} storeFn invoked with ${instances.length} instance(s)`);
        instances.forEach((instance, index) =>
          overrideInstance(instance as Record<string, unknown>, index)
        );
        return (storeFn as (d: unknown, ...r: unknown[]) => unknown)(dicom, ...rest);
      };
    },
  };

  const definitions = {
    createStoreFunction: actions.createStoreFunction,
  };

  return {
    actions,
    definitions,
    // Register into the DEFAULT context so this overrides extension-default's
    // createStoreFunction of the same name.
    defaultContext: 'DEFAULT',
  };
};

export default getCommandsModule;
