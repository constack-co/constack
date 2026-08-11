import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? sourceFiles(resolve(directory, entry.name))
          : entry.name.endsWith('.ts')
            ? [resolve(directory, entry.name)]
            : [],
      ),
    )
  ).flat();
}

describe('hard runtime boundaries', () => {
  it('keeps analysis worker free of Kubernetes and action dependencies', async () => {
    const root = resolve(process.cwd(), '../../apps/analysis-worker');
    const files = await sourceFiles(root);
    const content = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(content).not.toMatch(/@kubernetes\/client-node/);
    expect(content).not.toMatch(/constack-actions/);
    expect(content).not.toMatch(/actionPreview|ActionType|recommendation.*execute/i);
    expect(manifest.dependencies).not.toHaveProperty('@constack/shared-types');
    expect(manifest.dependencies).not.toHaveProperty('@constack/action-worker');
    expect(manifest.dependencies).not.toHaveProperty('@constack/kubernetes-types');
  });

  it('does not expose recommendation-to-action routes in the API', async () => {
    const root = resolve(process.cwd(), '../../apps/api/src');
    const files = await sourceFiles(root);
    const content = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    expect(content).not.toMatch(
      /applyRecommendation|executeRecommendation|recommendationId.*action/i,
    );
  });
});
