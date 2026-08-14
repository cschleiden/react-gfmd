export function isSafeInteractionHref(href: string) {
  const normalized = href.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!normalized) return false;

  const scheme = normalized.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  return scheme !== "javascript" && scheme !== "data" && scheme !== "vbscript";
}
