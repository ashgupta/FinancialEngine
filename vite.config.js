import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/yf': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/social': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/cot': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/momentum': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/volatility': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/sector': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ai': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ibkr': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/crash': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/options': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
