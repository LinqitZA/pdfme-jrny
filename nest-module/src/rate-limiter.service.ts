/**
 * RateLimiterService - Per-tenant sliding window rate limiter
 *
 * Provides rate limiting for API endpoints with configurable limits per tenant.
 * Uses an in-memory sliding window algorithm.
 *
 * Default limits:
 * - render/now: 60 requests per minute per tenant
 * - render/bulk: 5 requests per hour per tenant
 */

import { Injectable } from '@nestjs/common';

interface RateLimitWindow {
  timestamps: number[];
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

@Injectable()
export class RateLimiterService {
  // Map of "endpoint:orgId" -> window
  private windows: Map<string, RateLimitWindow> = new Map();

  // Configurable rate limits per endpoint
  private configs: Map<string, RateLimitConfig> = new Map([
    ['render:now', { maxRequests: 60, windowMs: 60 * 1000 }],       // 60/min
    ['render:bulk', { maxRequests: 5, windowMs: 60 * 60 * 1000 }],  // 5/hour
  ]);

  /**
   * Update rate limit config for an endpoint
   */
  setConfig(endpoint: string, maxRequests: number, windowMs: number): void {
    this.configs.set(endpoint, { maxRequests, windowMs });
  }

  /**
   * Get rate limit config for an endpoint
   */
  getConfig(endpoint: string): RateLimitConfig | undefined {
    return this.configs.get(endpoint);
  }

  /**
   * Check if a request is allowed and record it if so.
   * Returns { allowed, remaining, retryAfterMs, limit }
   */
  checkAndRecord(endpoint: string, orgId: string): {
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
    limit: number;
    windowMs: number;
  } {
    const config = this.configs.get(endpoint);
    if (!config) {
      return { allowed: true, remaining: Infinity, retryAfterMs: 0, limit: 0, windowMs: 0 };
    }

    const key = `${endpoint}:${orgId}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Get or create window
    let window = this.windows.get(key);
    if (!window) {
      window = { timestamps: [] };
      this.windows.set(key, window);
    }

    // Prune expired timestamps
    window.timestamps = window.timestamps.filter(ts => ts > windowStart);

    if (window.timestamps.length >= config.maxRequests) {
      // Rate limited - calculate retry after
      const oldestInWindow = window.timestamps[0];
      const retryAfterMs = oldestInWindow + config.windowMs - now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(retryAfterMs, 1000),
        limit: config.maxRequests,
        windowMs: config.windowMs,
      };
    }

    // Record this request
    window.timestamps.push(now);

    return {
      allowed: true,
      remaining: config.maxRequests - window.timestamps.length,
      retryAfterMs: 0,
      limit: config.maxRequests,
      windowMs: config.windowMs,
    };
  }

  /**
   * Reset rate limit for a specific tenant/endpoint
   */
  reset(endpoint: string, orgId: string): void {
    const key = `${endpoint}:${orgId}`;
    this.windows.delete(key);
  }

  /**
   * Reset all rate limits (for testing)
   */
  resetAll(): void {
    this.windows.clear();
  }

  /**
   * Get current usage stats for a tenant/endpoint
   */
  getUsage(endpoint: string, orgId: string): {
    used: number;
    limit: number;
    remaining: number;
    windowMs: number;
  } {
    const config = this.configs.get(endpoint);
    if (!config) {
      return { used: 0, limit: 0, remaining: 0, windowMs: 0 };
    }

    const key = `${endpoint}:${orgId}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const window = this.windows.get(key);
    if (!window) {
      return { used: 0, limit: config.maxRequests, remaining: config.maxRequests, windowMs: config.windowMs };
    }

    // Count active timestamps
    const activeCount = window.timestamps.filter(ts => ts > windowStart).length;

    return {
      used: activeCount,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - activeCount),
      windowMs: config.windowMs,
    };
  }
}
