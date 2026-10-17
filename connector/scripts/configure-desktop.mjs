import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeOrigin } from '../core/security.mjs';

const development = process.argv.includes('--development');
const origin = development ? 'http://localhost:3000' : process.env.CONNECTOR_APP_ORIGIN;
if (!origin) throw new Error('CONNECTOR_APP_ORIGIN에 실제 배포할 HTTPS 웹앱 주소를 지정해야 해요.');
const normalized = normalizeOrigin(origin, { development });
const apps = [{ id: 'hapark', name: '하박조팽', scheme: 'hapark-connect', origin: normalized, allowedOrigins: development ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : [normalized] }];
await writeFile(fileURLToPath(new URL('../desktop/apps.generated.json', import.meta.url)), JSON.stringify({ version: 1, development, applications: apps }, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ configured: true, development, application: apps[0].id, origin: normalized }));
