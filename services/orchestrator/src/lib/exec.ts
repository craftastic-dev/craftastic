import { exec } from 'child_process';
import { promisify } from 'util';

export const execPromise = promisify(exec);

/**
 * Execute a command with better error handling and logging
 */
export async function execCommand(
  command: string,
  options: { cwd?: string; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const { cwd, timeout = 30000 } = options;
  
  console.log(`🔧 Executing: ${command}${cwd ? ` (cwd: ${cwd})` : ''}`);
  
  try {
    const result = await execPromise(command, {
      cwd,
      timeout,
      encoding: 'utf8',
    });
    
    if (result.stderr && result.stderr.trim()) {
      console.warn(`⚠️  Command stderr: ${result.stderr.trim()}`);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    console.error(`   Error: ${error.message}`);
    if (error.stderr) {
      console.error(`   Stderr: ${error.stderr}`);
    }
    throw error;
  }
}