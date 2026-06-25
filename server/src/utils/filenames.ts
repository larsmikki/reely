// Strip characters that are invalid in Windows/SMB filenames, plus trailing
// dots and spaces (Windows rejects those at the end of a name).
export function sanitizeForFilename(name: string): string {
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\x00-\x1f\\/]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
}
