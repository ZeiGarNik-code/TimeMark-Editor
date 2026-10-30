import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // Desktop builds load the renderer from a secure local Electron protocol.
  // GitHub Pages serves this repository beneath /TimeMark-Editor/.
  base: mode === 'desktop' ? './' : process.env.GITHUB_ACTIONS === 'true' ? '/TimeMark-Editor/' : '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
}));
