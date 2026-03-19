/**
 * Dynamic API base URL resolution.
 *
 * In the browser, derives the API URL from window.location.hostname so the
 * sandbox works when accessed via any hostname or IP (not just localhost).
 * On the server (SSR), falls back to the build-time env var or localhost.
 */
export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:3001/api/pdfme`;
  }
  return process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001/api/pdfme';
}
