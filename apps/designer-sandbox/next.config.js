/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pdfme/ui', '@pdfme-erp/schemas', '@pdfme/common'],
};

module.exports = nextConfig;
