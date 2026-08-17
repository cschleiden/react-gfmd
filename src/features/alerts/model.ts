export const alertKinds = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;

export type AlertKind = (typeof alertKinds)[number];

export function isAlertKind(value: unknown): value is AlertKind {
  return (
    typeof value === "string" &&
    alertKinds.includes(value.toLowerCase() as AlertKind)
  );
}

export function alertLabel(kind: AlertKind) {
  return kind[0].toUpperCase() + kind.slice(1);
}
