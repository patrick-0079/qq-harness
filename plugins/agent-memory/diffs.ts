import type { MemoryRecord } from '@qq-harness/contracts';
export interface MemoryRevisionView {
  record: MemoryRecord;
  changedAt: number;
}
// A correction publishes a new record whose revision starts at 1. Numeric
// revision ordering alone therefore reverses facts; follow the explicit edges.
export function memoryDiffs(revisions: MemoryRevisionView[]) {
  return [...revisions]
    .sort(
      (a, b) =>
        b.changedAt - a.changedAt ||
        (b.record.factVersion ?? 1) - (a.record.factVersion ?? 1) ||
        b.record.revision - a.record.revision,
    )
    .slice(0, 6)
    .map((item) => {
      const sameRecord = revisions.find(
        (v) => v.record.id === item.record.id && v.record.revision === item.record.revision - 1,
      );
      const source = item.record.derivedFrom
        ?.map((ref) =>
          revisions.find((v) => v.record.id === ref.id && v.record.revision === ref.revision),
        )
        .find(Boolean);
      return { item, previous: sameRecord ?? source };
    });
}
