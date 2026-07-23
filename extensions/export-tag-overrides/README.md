# @ohif/extension-export-tag-overrides

Applies a **rule-based table of DICOM tag overrides** to segmentations that are
**downloaded** from the Segmentation editor.

## Why

Some sites need specific DICOM tags forced to particular values on exported
segmentations for certain patients/studies. For example:

> For patient **FORTEST** (Study Date **28-Apr-2021**), set DICOM tag
> **(0008,1050) Performing Physician Name** to **John Doe**.

Rather than hard-coding a single case, this extension drives the behavior from a
declarative rule table, so new patients/studies/tags are added with data, not
code.

## How it works

Every OHIF export path funnels through one shared command, `createStoreFunction`
(registered by `@ohif/extension-default` in the `DEFAULT` context): the caller
asks it for a `storeFn`, then calls `storeFn(dataset)`. This is true for:

- **Manage Current Segmentation → Export → DICOM SEG** (runs `storeSegmentation`,
  which resolves `createStoreFunction` with the target picked in the Store
  dialog — including its **Download** button), and
- the standalone `downloadSegmentation` command (`dataSource: 'download'`), and
- DICOM RTSS / SR exports.

This extension registers `createStoreFunction` into the **same** `DEFAULT`
context (OHIF's `CommandsManager` overwrites on re-registration, so the later
registration wins — and this extension always loads after the global
`@ohif/extension-default`). Its wrapper captures the original, then returns a
`storeFn` that, just before serialization:

1. Reads `PatientID` / `PatientName` / `StudyDate` from each naturalized instance.
2. Finds matching rules in [`src/rules/exportOverrideRules.ts`](./src/rules/exportOverrideRules.ts).
3. Writes each rule's overrides onto the dataset, then delegates to the original
   `storeFn`.

Because the wrap sits at the single serialization boundary common to all export
paths, it covers both the **Store** dialog's Download and the standalone
download without touching `@ohif/extension-cornerstone-dicom-seg` or
reimplementing `storeSegmentation`. All logging is prefixed
`[export-tag-overrides]`.

## Adding a rule

Edit [`src/rules/exportOverrideRules.ts`](./src/rules/exportOverrideRules.ts):

```ts
{
  id: 'my-rule',
  description: 'What this does and why',
  match: {
    patientIdOrName: 'FORTEST', // matches PatientID OR PatientName
    studyDate: '20210428',      // DICOM YYYYMMDD
  },
  overrides: {
    // Person Name (PN) tags accept components; patronymic is the middle component:
    PerformingPhysicianName: { family: 'Doe', given: 'John', patronymic: 'Ivanovich' },
    // or a raw PN string: PerformingPhysicianName: 'Doe^John^Ivanovich'
    // Non-PN tags accept plain strings:
    // SeriesDescription: 'Reviewed export',
  },
},
```

Match criteria (all provided fields must match — logical AND; case-insensitive):

| Field             | DICOM tag        | Notes                                   |
| ----------------- | ---------------- | --------------------------------------- |
| `patientId`       | (0010,0020)      | exact, normalized                       |
| `patientName`     | (0010,0010)      | PN, normalized                          |
| `patientIdOrName` | either of above  | matches if EITHER equals                |
| `studyDate`       | (0008,0020)      | `YYYYMMDD`                              |

Person-Name-VR tags are listed in `PN_KEYWORDS` in the same file; add to that set
if you need to override another PN tag.

## Installation

1. Registered as a buildable extension in `platform/app/pluginConfig.json`.
2. Added to the `@ohif/mode-segmentation` mode's `extensionDependencies`, so it
   loads only in the Segmentation workflow. (Load order relative to
   cornerstone-dicom-seg is irrelevant now that the hook is on the
   `@ohif/extension-default`-owned `createStoreFunction`, which is always
   registered first at app init.)
