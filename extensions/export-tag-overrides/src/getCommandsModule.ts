import { Types } from '@ohif/core';
import { applyExportOverrides } from './utils/applyExportOverrides';

const LOG_PREFIX = '[export-tag-overrides]';

/**
 * The commands this extension wraps by same-name registration (later
 * registration wins within a context), and who owns the original — used for
 * capture, load-order warnings, and the fail-open recapture.
 */
const WRAPPED_COMMANDS = {
  createStoreFunction: { context: 'DEFAULT', owner: '@ohif/extension-default' },
  storeSegmentation: { context: 'SEGMENTATION', owner: '@ohif/extension-cornerstone-dicom-seg' },
} as const;

type WrappedCommandName = keyof typeof WRAPPED_COMMANDS;

/**
 * A registered command definition. `CommandsManager.getCommand` is untyped, and
 * @ohif/core exports no definition type (`Types.Command` only covers run-command
 * inputs), so this is the minimal shape we rely on.
 */
type CommandDefinition = {
  commandFn: (options?: Record<string, unknown>) => unknown;
  options?: Record<string, unknown>;
};

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
 * records the requested modality for the duration of the call. The
 * `createStoreFunction` wrapper applies overrides only when a
 * `storeSegmentation` call with modality 'SEG' is in flight AND the dialog
 * resolved to `dataSource: 'download'`.
 *
 * Load order: `@ohif/extension-default` is a global extension registered at app
 * init; `cornerstone-dicom-seg` is listed before this extension in the
 * segmentation mode's dependency map. Mode-dependency extensions register in
 * map order on mode entry, so both originals exist when this factory runs.
 */
const getCommandsModule = ({
  commandsManager,
  servicesManager,
}: Types.Extensions.ExtensionParams): Types.Extensions.CommandsModule => {
  // Capture the original definitions BEFORE ours overwrite them. getCommand
  // returns the live definition object; registerCommand replaces the map entry
  // with a new object, so these references keep pointing at the originals.
  const originals: Partial<Record<WrappedCommandName, CommandDefinition>> = {};

  for (const name of Object.keys(WRAPPED_COMMANDS) as WrappedCommandName[]) {
    const { context, owner } = WRAPPED_COMMANDS[name];
    const definition = commandsManager.getCommand(name, context);
    if (definition?.commandFn) {
      originals[name] = definition;
    } else {
      console.warn(
        `${LOG_PREFIX} original ${name} not found in ${context} context — ` +
          `overrides will NOT be applied. Is ${owner} registered first?`
      );
    }
  }

  /**
   * Resolve the original to delegate to. If it was not captured at registration
   * time (unexpected load order), retry at call time — the self-check prevents
   * delegating to our own wrapper (infinite recursion). A definitive miss is
   * surfaced as a UI warning, since the Export click would otherwise silently
   * do nothing.
   */
  const getOriginal = (name: WrappedCommandName): CommandDefinition | undefined => {
    if (!originals[name]) {
      const current = commandsManager.getCommand(name, WRAPPED_COMMANDS[name].context);
      if (current?.commandFn && current.commandFn !== actions[name]) {
        originals[name] = current;
      }
    }

    if (!originals[name]) {
      console.warn(`${LOG_PREFIX} ${name} has no original to delegate to`);
      servicesManager?.services?.uiNotificationService?.show({
        title: 'Export Tag Overrides',
        message: `Export unavailable: the "${name}" command could not be reached. Check the extension load order.`,
        type: 'warning',
      });
    }

    return originals[name];
  };

  /**
   * Modality of the wrapped `storeSegmentation` call currently in flight. The
   * dialog is modal, so no other export can start while it is open.
   */
  let activeModality: string | null = null;

  const actions = {
    storeSegmentation: async (args: { modality?: string } = {}) => {
      const original = getOriginal('storeSegmentation');
      if (!original) {
        return;
      }

      activeModality = args.modality ?? 'SEG';
      try {
        return await original.commandFn({ ...original.options, ...args });
      } finally {
        activeModality = null;
      }
    },

    createStoreFunction: (args: { dataSource?: string } = {}) => {
      const original = getOriginal('createStoreFunction');
      if (!original) {
        return;
      }

      // Delegate to the original to get the real store function, preserving any
      // configured command options.
      const storeFn = original.commandFn({ ...original.options, ...args });

      // `null` is the original's normal "no valid store" answer — pass through.
      if (typeof storeFn !== 'function') {
        return storeFn;
      }

      // Scope decision, made synchronously inside the storeSegmentation call:
      // SEG export dialog resolved to its Download button.
      if (!(activeModality === 'SEG' && args.dataSource === 'download')) {
        return storeFn;
      }

      // Return a wrapper that mutates the dataset(s) just before the original
      // store function serializes them for download.
      return async (dicom: unknown, ...rest: unknown[]) => {
        const instances = Array.isArray(dicom) ? dicom : [dicom];
        for (const instance of instances) {
          const appliedRuleIds = applyExportOverrides(instance as Record<string, unknown>);
          if (appliedRuleIds.length > 0) {
            console.log(`${LOG_PREFIX} applied rule(s): ${appliedRuleIds.join(', ')}`);
          }
        }
        return storeFn(dicom, ...rest);
      };
    },
  };

  const definitions = {
    // Same-name registration into each original's context so ours wins.
    createStoreFunction: {
      commandFn: actions.createStoreFunction,
      context: WRAPPED_COMMANDS.createStoreFunction.context,
    },
    storeSegmentation: {
      commandFn: actions.storeSegmentation,
      context: WRAPPED_COMMANDS.storeSegmentation.context,
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'DEFAULT',
  };
};

export default getCommandsModule;
