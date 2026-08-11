import { appDataSource } from './data-source.js';

await appDataSource.initialize();
try {
  const migrations = await appDataSource.runMigrations({ transaction: 'all' });
  console.log(`Applied ${migrations.length} migration(s).`);
} finally {
  await appDataSource.destroy();
}
