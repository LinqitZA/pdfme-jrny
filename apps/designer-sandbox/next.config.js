/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pdfme/ui', '@pdfme-erp/schemas', '@pdfme/common'],
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001/api/pdfme',
  },
};

module.exports = nextConfig;
