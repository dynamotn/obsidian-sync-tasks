/** Joins vault path segments, dropping empty ones and duplicate slashes. */
export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((part) => part.replace(/\\/g, "/").split("/"))
    .map((part) => part.trim())
    .filter((part) => part !== "" && part !== ".")
    .join("/")
}

/** Makes a string safe to use as a file name and as a wikilink target. */
export function safeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
}

/** Turns a name into a short folder-friendly slug: "Sprint 12 (Q4)" → "Sprint-12-Q4". */
export function slug(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

/** Splits a comma or newline separated list, dropping blanks. */
export function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** The YYYY-MM-DD part of a date string, or "" when it does not parse. */
export function isoDate(value: string | null | undefined): string {
  if (!value) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

/** A date-based folder: "2026/Q4/October". */
export function dateFolder(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const month = date.getUTCMonth()
  return `${date.getUTCFullYear()}/Q${Math.floor(month / 3) + 1}/${MONTHS[month]}`
}

/** Base64 of a UTF-8 string, without Node's Buffer (absent on mobile). */
export function base64(value: string): string {
  let binary = ""
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Drops later items whose key was already seen. */
export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** A short random id for a new source. */
export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}
