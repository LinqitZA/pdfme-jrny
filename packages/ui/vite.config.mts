import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

export default defineConfig(({ mode }) => {
  return {
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    plugins: [react(), tsconfigPaths({ root: '.' }), cssInjectedByJsPlugin()],
    build: {
      lib: {
        entry: 'src/index.ts',
        name: '@pdfme/ui',
        fileName: (format) => `index.${format}.js`,
      },
      rollupOptions: {
        // form-render imports rc-picker internals which may not be hoisted by pnpm.
        // Treat as warning instead of error to avoid build failures from phantom deps.
        onwarn(warning, warn) {
          if (warning.code === 'UNRESOLVED_IMPORT' && warning.exporter?.includes('rc-picker')) {
            return; // suppress rc-picker phantom dependency warning from form-render
          }
          warn(warning);
        },
      },
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'pdfjs-dist', 'antd'],
      exclude: ['@pdfme/common', '@pdfme/schemas', '@pdfme/converter'],
    },
  };
});
