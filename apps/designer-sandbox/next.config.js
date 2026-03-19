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
