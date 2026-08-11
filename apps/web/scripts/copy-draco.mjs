import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/three/examples/jsm/libs/draco');
const destination = resolve(root, 'public/draco');

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
