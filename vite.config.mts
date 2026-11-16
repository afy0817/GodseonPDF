import { defineConfig, type Plugin } from 'vite';

// 배포 빌드에만 CSP(Content-Security-Policy)를 넣는다. 개발 서버는 HMR(websocket, inline) 때문에 제외.
function cspPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'godseon-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public',
  plugins: [cspPlugin()],
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    target: 'chrome130',
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
