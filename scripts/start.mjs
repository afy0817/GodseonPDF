// npm start: 배포용으로 빌드한 화면(dist/renderer)으로 앱을 실행한다.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronBinary } from './electron-bin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(electronBinary(root), [root, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
