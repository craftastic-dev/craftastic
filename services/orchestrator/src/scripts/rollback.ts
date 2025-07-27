#!/usr/bin/env tsx

import { rollbackMigrations } from '../lib/migrator';

async function main() {
  const steps = parseInt(process.argv[2]) || 1;
  
  try {
    await rollbackMigrations(steps);
    process.exit(0);
  } catch (error) {
    console.error('Rollback failed:', error);
    process.exit(1);
  }
}

main();