/**
 * Re-declare Node.js timer globals for @types/node v25+
 * which no longer includes them in the global scope.
 * These are available at runtime in Node.js but need explicit type declarations.
 */

declare function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): NodeJS.Timeout;
declare function clearTimeout(timeout: NodeJS.Timeout | undefined): void;
declare function setInterval(callback: (...args: any[]) => void, ms?: number, ...args: any[]): NodeJS.Timeout;
declare function clearInterval(timeout: NodeJS.Timeout | undefined): void;
declare function setImmediate(callback: (...args: any[]) => void, ...args: any[]): NodeJS.Immediate;
declare function clearImmediate(immediate: NodeJS.Immediate | undefined): void;
