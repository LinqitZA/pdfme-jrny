/**
 * Node.js 25 ships a built-in `localStorage` global (from `node:storage`)
 * but it requires `--localstorage-file=<path>` to function. Without that flag
 * the object exists but its methods (getItem, setItem, etc.) are undefined,
 * causing SSR crashes in any code that assumes browser-like localStorage.
 * Polyfill the missing methods so SSR doesn't throw.
 */
if (typeof globalThis.localStorage !== 'undefined' && typeof globalThis.localStorage.getItem !== 'function') {
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
    clear() { storage.clear(); },
    get length() { return storage.size; },
    key(index) { return [...storage.keys()][index] ?? null; },
  };
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pdfme/ui', '@pdfme-erp/schemas', '@pdfme/common'],
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001/api/pdfme',
  },
  typescript: {
    // Monorepo has conflicting @types/react versions (@pdfme/ui uses v17, designer uses v19).
    // Type checking is handled by IDE and CI; skip during Next.js build to avoid false positives.
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
