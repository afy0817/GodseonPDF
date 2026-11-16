// 개발 모드: Vite 개발 서버를 띄운 뒤 Electron 을 그 주소로 실행한다.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await import('./copy-assets.mjs');

const server = await createServer({ configFile: path.join(root, 'vite.config.mts') });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';
console.log(`[dev] renderer: ${url}`);

const child = spawn(electronPath, [root, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

const shutdown = async (code = 0) => {
  await server.close();
  process.exit(code);
};
child.on('close', (code) => shutdown(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
