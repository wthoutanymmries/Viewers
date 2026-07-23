import { Types } from '@ohif/core';
import { applyExportOverrides } from './utils/applyExportOverrides';

const LOG_PREFIX = '[export-tag-overrides]';

/**
 * Applies rule-based DICOM tag overrides to segmentations exported via the
 * "Store Segmentation" dialog's Download button — and ONLY that path.
 *
 * Target UI flow (the only one that triggers overrides):
 *   Segmentation panel → "Manage Current Segmentation" → Export → DICOM SEG
 *     → `storeSegmentation` command (modality 'SEG', `SEGMENTATION` context)
 *     → "Store Segmentation" dialog → Download button (`dataSource: 'download'`)
 *     → `createStoreFunction` (`DEFAULT` context) → storeFn(dataset)
 *
 * Explicitly excluded:
 *   - the dialog's Save button (server store; `dataSource` = a named source),
 *   - the same dialog opened via Export → DICOM RTSS (modality 'RTSTRUCT'),
 *   - the standalone `downloadSegmentation` command (also `dataSource:
 *     'download'`, which is why `dataSource` alone cannot discriminate),
 *   - DICOM SR / measurement exports.
 *
 * How the scoping works: we wrap BOTH commands. The `storeSegmentation` wrapper
 * (same-name registration into the `SEGMENTATION` context; later registration
 * wins) records the requested modality for the duration of the call. The
 * `createStoreFunction` wrapper (same-name registration into `DEFAULT`) applies
 * overrides only when a `storeSegmentation` call with modality 'SEG' is in
 * flight AND the dialog resolved to `dataSource: 'download'`.
 *
 * Load order: `@ohif/extension-default` (owner of `createStoreFunction`) is a
 * global extension registered at app init; `cornerstone-dicom-seg` (owner of
 * `storeSegmentation`) is listed before this extension in the segmentation
 * mode's dependency map. Mode-dependency extensions register in map order on
 * mode entry, so both originals exist when this factory runs.
 */
const getCommandsModule = ({
  commandsManager,
  servicesManager,
}: Types.Extensions.ExtensionParams): Types.Extensions.CommandsModule => {
  /**
   * Surface a fail-safe as a visible warning, not just a console line: when a
   * wrapped command has no original to delegate to, the Export click would
   * otherwise silently do nothing.
   */
  const notifyMissingOriginal = (commandName: string) => {
    const message = `Export unavailable: the "${commandName}" command could not be reached. Check the extension load order.`;
    console.warn(`${LOG_PREFIX} ${commandName} has no original to delegate to`);
    servicesManager?.services?.uiNotificationService?.show({
      title: 'Export Tag Overrides',
      message,
      type: 'warning',
    });
  };

  // Capture the original definitions BEFORE ours overwrite them. getCommand
  // returns the live definition object; registerCommand replaces the map entry
  // with a new object, so these references keep pointing at the originals.
  let originalCreateStoreFunction = commandsManager.getCommand('createStoreFunction', 'DEFAULT');
  let originalStoreSegmentation = commandsManager.getCommand('storeSegmentation', 'SEGMENTATION');

  if (!originalCreateStoreFunction?.commandFn) {
    console.warn(
      `${LOG_PREFIX} original createStoreFunction not found in DEFAULT context — ` +
        `overrides will NOT be applied. Is @ohif/extension-default registered first?`
    );
  }
  if (!originalStoreSegmentation?.commandFn) {
    console.warn(
      `${LOG_PREFIX} original storeSegmentation not found in SEGMENTATION context — ` +
        `overrides will NOT be applied. Is @ohif/extension-cornerstone-dicom-seg registered first?`
    );
  }

  /**
   * Fail-open fallback: if an original was not captured at registration time
   * (unexpected load order), retry at call time. The self-check prevents
   * delegating to our own wrapper (infinite recursion) — after our
   * registration, the live definition's commandFn is one of `actions.*`.
   */
  const lazyRecapture = (commandName: string, contextName: string, selfFn: unknown) => {
    const current = commandsManager.getCommand(commandName, contextName);
    return current?.commandFn && current.commandFn !== selfFn ? current : undefined;
  };

  /**
   * Set while a wrapped `storeSegmentation` call is in flight. The dialog is
   * modal, so no other export can start while it is open.
   */
  let activeStoreSegmentation: { modality: string } | null = null;

  const actions = {
    storeSegmentation: async (args: { modality?: string } = {}) => {
      if (!originalStoreSegmentation?.commandFn) {
        originalStoreSegmentation = lazyRecapture(
          'storeSegmentation',
          'SEGMENTATION',
          actions.storeSegmentation
        );
      }
      if (!originalStoreSegmentation?.commandFn) {
        notifyMissingOriginal('storeSegmentation');
        return undefined;
      }

      activeStoreSegmentation = { modality: args?.modality ?? 'SEG' };
      try {
        return await originalStoreSegmentation.commandFn({
          ...(originalStoreSegmentation.options || {}),
          ...args,
        });
      } finally {
        activeStoreSegmentation = null;
      }
    },

    createStoreFunction: (args: { dataSource?: string } = {}) => {
      if (!originalCreateStoreFunction?.commandFn) {
        originalCreateStoreFunction = lazyRecapture(
          'createStoreFunction',
          'DEFAULT',
          actions.createStoreFunction
        );
      }
      if (!originalCreateStoreFunction?.commandFn) {
        notifyMissingOriginal('createStoreFunction');
        return undefined;
      }

      // Delegate to the original to get the real store function, preserving any
      // configured command options.
      const storeFn = originalCreateStoreFunction.commandFn({
        ...(originalCreateStoreFunction.options || {}),
        ...args,
      });

      // `null` is the original's normal "no valid store" answer — pass through.
      if (typeof storeFn !== 'function') {
        return storeFn;
      }

      // Scope decision, made synchronously inside the storeSegmentation call:
      // SEG export dialog resolved to its Download button.
      const shouldApplyOverrides =
        activeStoreSegmentation?.modality === 'SEG' && args?.dataSource === 'download';

      if (!shouldApplyOverrides) {
        return storeFn;
      }

      // Return a wrapper that mutates the dataset(s) just before the original
      // store function serializes them for download.
      return async (dicom: unknown, ...rest: unknown[]) => {
        const instances = Array.isArray(dicom) ? dicom : [dicom];
        instances.forEach(instance => {
          const appliedRuleIds = applyExportOverrides(instance as Record<string, unknown>);
          if (appliedRuleIds.length > 0) {
            console.log(`${LOG_PREFIX} applied rule(s): ${appliedRuleIds.join(', ')}`);
          }
        });
        return (storeFn as (d: unknown, ...r: unknown[]) => unknown)(dicom, ...rest);
      };
    },
  };

  const definitions = {
    // Same-name registration into each original's context so ours wins.
    createStoreFunction: { commandFn: actions.createStoreFunction, context: 'DEFAULT' },
    storeSegmentation: { commandFn: actions.storeSegmentation, context: 'SEGMENTATION' },
  };

  return {
    actions,
    definitions,
    defaultContext: 'DEFAULT',
  };
};

export default getCommandsModule;
