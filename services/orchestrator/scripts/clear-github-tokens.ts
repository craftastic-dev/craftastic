import { createDatabase, getDatabase } from '../src/lib/kysely';

async function clearGitHubTokens() {
  createDatabase();
  
  const result = await getDatabase()
    .updateTable('users')
    .set({
      github_access_token: null,
      github_refresh_token: null,
      github_username: null,
      github_token_expires_at: null,
    })
    .execute();
    
  console.log('✅ Cleared GitHub tokens from', result.length, 'users');
  process.exit(0);
}

clearGitHubTokens().catch(console.error);