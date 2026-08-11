import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const modelsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const files = (await readdir(modelsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.glb'))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

for (const file of files) {
  const data = await readFile(join(modelsDirectory, file));
  const valid =
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'glTF' &&
    data.readUInt32LE(4) === 2 &&
    data.readUInt32LE(8) === data.length;
  if (!valid) throw new Error(`${file} is not a valid GLB v2 file.`);
}

const manifest = {
  models: files.map((file) => `/models/${file}`),
  note: 'Generated automatically from GLB files in apps/web/public/models.',
};

await writeFile(
  join(modelsDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
