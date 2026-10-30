import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const at = (...parts) => path.join(ROOT, ...parts);
process.env.PLAYWRIGHT_BROWSERS_PATH ||= at('runtime', 'browsers');
