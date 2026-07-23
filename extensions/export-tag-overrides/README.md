# @ohif/extension-export-tag-overrides

Applies a **rule-based table of DICOM tag overrides** to segmentations exported
via the **Download** button of the **"Store Segmentation" dialog** in the
Segmentation editor.

## Why

Some sites need specific DICOM tags forced to particular values on exported
segmentations for certain patients/studies. For example:

> For patient **FORTEST** (Study Date **28-Apr-2021**), set DICOM tag
> **(0008,1050) Performing Physician Name** to **John Doe**.

Rather than hard-coding a single case, this extension drives the behavior from a
declarative rule table, so new patients/studies/tags are added with data, not
code.

## Scope — exactly one trigger path

Overrides apply **only** on this flow:

**Segmentation panel → Manage Current Segmentation → Export → DICOM SEG →
"Store Segmentation" dialog → Download button**

Explicitly excluded (dataset is never touched):

- the dialog's **Save** button (server store),
- the same dialog opened via **Export → DICOM RTSS**,
- the standalone `downloadSegmentation` command,
- DICOM SR / measurement exports.

## How it works

Two commands are wrapped by same-name registration (OHIF's `CommandsManager`
overwrites on re-registration within a context, so the later registration wins;
this extension loads after both owners — see Installation):

1. **`storeSegmentation`** (`SEGMENTATION` context, owned by
   `@ohif/extension-cornerstone-dicom-seg`) — runs the SEG/RTSS export dialog.
   The wrapper records the requested modality while the call is in flight, then
   delegates to the original.
2. **`createStoreFunction`** (`DEFAULT` context, owned by
   `@ohif/extension-default`) — the shared serialization boundary every export
   path funnels through. The wrapper applies overrides **only** when a
   `storeSegmentation` call with modality `SEG` is in flight **and** the dialog
   resolved to `dataSource: 'download'` (the Download button). Note
   `dataSource: 'download'` alone cannot discriminate — the standalone
   `downloadSegmentation` command produces the identical call.

When the trigger matches, the wrapper reads `PatientID` / `PatientName` /
`StudyDate` from each naturalized instance, finds matching rules in
[`src/rules/exportOverrideRules.ts`](./src/rules/exportOverrideRules.ts), and
writes each rule's overrides onto the dataset before delegating to the original
`storeFn`, which serializes it for download. Logging is prefixed
`[export-tag-overrides]` and never includes patient identifiers.

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

Match criteria (all provided fields must match — logical AND; case-insensitive;
person-name comparisons also ignore trailing empty PN components, so
`FORTEST^^^^` matches `FORTEST`):

| Field             | DICOM tag        | Notes                                   |
| ----------------- | ---------------- | --------------------------------------- |
| `patientId`       | (0010,0020)      | exact, normalized                       |
| `patientName`     | (0010,0010)      | PN-normalized                           |
| `patientIdOrName` | either of above  | matches if EITHER equals                |
| `studyDate`       | (0008,0020)      | `YYYYMMDD`                              |

Override keywords are validated against the dcmjs DICOM data dictionary — a
typo'd keyword logs a warning instead of silently dropping the tag. Person Name
(PN VR) keywords are detected via the dictionary automatically, so any PN tag
works without registering it anywhere.

## Installation

1. Registered as a buildable extension in `platform/app/pluginConfig.json`.
2. Added to the `@ohif/mode-segmentation` mode's `extensionDependencies`, so it
   loads only in the Segmentation workflow. Load order is guaranteed:
   `@ohif/extension-default` is a global extension registered at app init, and
   `@ohif/extension-cornerstone-dicom-seg` is listed before this extension in
   the mode's dependency map (mode-dependency extensions register in map order
   on mode entry), so both wrapped originals exist when this extension
   registers.
