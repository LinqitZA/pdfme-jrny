/**
 * Font Cache - Browser Cache API for font caching with 24h TTL
 *
 * Caches font files fetched from the API using the browser's Cache API.
 * Fonts are cached with a 24-hour TTL to avoid re-downloading on page reload.
 *
 * Cache key format: font URL (e.g., /api/pdfme/fonts/<fontId>)
 * Cache name: 'pdfme-font-cache-v1'
 * TTL: 24 hours (configurable)
 */

const CACHE_NAME = 'pdfme-font-cache-v1';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours in ms
const CACHE_TIMESTAMP_HEADER = 'X-PdfMe-Cache-Timestamp';

/**
 * Check if the Cache API is available in the current browser environment.
 */
export function isCacheApiAvailable(): boolean {
  return typeof window !== 'undefined' && 'caches' in window;
}

/**
 * Get a font from the cache if it exists and hasn't expired.
 *
 * @param url - The font URL to look up
 * @param ttlMs - Time-to-live in milliseconds (default: 24h)
 * @returns The cached Response, or null if not cached/expired
 */
export async function getCachedFont(
  url: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<Response | null> {
  if (!isCacheApiAvailable()) return null;

  try {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(url);

    if (!cachedResponse) return null;

    // Check TTL using our custom timestamp header
    const cachedAt = cachedResponse.headers.get(CACHE_TIMESTAMP_HEADER);
    if (cachedAt) {
      const age = Date.now() - parseInt(cachedAt, 10);
      if (age > ttlMs) {
        // Expired - delete from cache
        await cache.delete(url);
        return null;
      }
    }

    return cachedResponse;
  } catch {
    // Cache API errors should not break font loading
    return null;
  }
}

/**
 * Store a font response in the cache with a timestamp header.
 *
 * @param url - The font URL to cache
 * @param response - The Response object to cache (will be cloned)
 */
export async function cacheFontResponse(
  url: string,
  response: Response,
): Promise<void> {
  if (!isCacheApiAvailable()) return;

  try {
    const cache = await caches.open(CACHE_NAME);

    // Clone the response and add our timestamp header
    const body = await response.clone().arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set(CACHE_TIMESTAMP_HEADER, String(Date.now()));

    const cachedResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

    await cache.put(url, cachedResponse);
  } catch {
    // Silently fail - caching is an optimization, not a requirement
  }
}

/**
 * Fetch a font with Cache API caching.
 * First checks the cache, then falls back to network fetch.
 *
 * @param url - The font URL to fetch
 * @param options - Fetch options (headers, etc.)
 * @param ttlMs - Cache TTL in milliseconds (default: 24h)
 * @returns Object with the response ArrayBuffer, content type, and whether it was from cache
 */
export async function fetchFontWithCache(
  url: string,
  options?: RequestInit,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<{ data: ArrayBuffer; contentType: string; fromCache: boolean }> {
  // Try cache first
  const cached = await getCachedFont(url, ttlMs);
  if (cached) {
    const data = await cached.arrayBuffer();
    const contentType = cached.headers.get('Content-Type') || 'font/ttf';
    return { data, contentType, fromCache: true };
  }

  // Network fetch
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Failed to fetch font: ${response.status} ${response.statusText}`);
  }

  // Cache the response for next time
  await cacheFontResponse(url, response.clone());

  const data = await response.arrayBuffer();
  const contentType = response.headers.get('Content-Type') || 'font/ttf';
  return { data, contentType, fromCache: false };
}

/**
 * Get cache statistics: number of cached fonts, total size, entries with age.
 */
export async function getFontCacheStats(): Promise<{
  available: boolean;
  cacheName: string;
  entryCount: number;
  totalSizeBytes: number;
  entries: Array<{
    url: string;
    sizeBytes: number;
    cachedAtMs: number;
    ageMs: number;
    expired: boolean;
  }>;
  ttlMs: number;
}> {
  const stats = {
    available: isCacheApiAvailable(),
    cacheName: CACHE_NAME,
    entryCount: 0,
    totalSizeBytes: 0,
    entries: [] as Array<{
      url: string;
      sizeBytes: number;
      cachedAtMs: number;
      ageMs: number;
      expired: boolean;
    }>,
    ttlMs: DEFAULT_TTL_MS,
  };

  if (!isCacheApiAvailable()) return stats;

  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();

    for (const request of keys) {
      const response = await cache.match(request);
      if (!response) continue;

      const body = await response.clone().arrayBuffer();
      const cachedAtStr = response.headers.get(CACHE_TIMESTAMP_HEADER);
      const cachedAtMs = cachedAtStr ? parseInt(cachedAtStr, 10) : 0;
      const ageMs = cachedAtMs ? Date.now() - cachedAtMs : 0;

      stats.entries.push({
        url: request.url,
        sizeBytes: body.byteLength,
        cachedAtMs,
        ageMs,
        expired: ageMs > DEFAULT_TTL_MS,
      });
      stats.totalSizeBytes += body.byteLength;
    }

    stats.entryCount = stats.entries.length;
  } catch {
    // Ignore cache errors
  }

  return stats;
}

/**
 * Clear all cached fonts.
 */
export async function clearFontCache(): Promise<boolean> {
  if (!isCacheApiAvailable()) return false;

  try {
    return await caches.delete(CACHE_NAME);
  } catch {
    return false;
  }
}

/**
 * Remove expired entries from the cache.
 * @param ttlMs - TTL in milliseconds (default: 24h)
 * @returns Number of entries removed
 */
export async function pruneExpiredFonts(
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<number> {
  if (!isCacheApiAvailable()) return 0;

  let removed = 0;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();

    for (const request of keys) {
      const response = await cache.match(request);
      if (!response) continue;

      const cachedAt = response.headers.get(CACHE_TIMESTAMP_HEADER);
      if (cachedAt) {
        const age = Date.now() - parseInt(cachedAt, 10);
        if (age > ttlMs) {
          await cache.delete(request);
          removed++;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return removed;
}
