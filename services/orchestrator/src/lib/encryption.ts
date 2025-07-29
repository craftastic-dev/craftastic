import crypto from 'crypto';

// Encryption configuration
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Get the encryption key from environment variable
 */
function getEncryptionKey(): Buffer {
  const keyString = process.env.SERVER_ENCRYPTION_KEY;
  if (!keyString) {
    throw new Error('SERVER_ENCRYPTION_KEY environment variable is required');
  }
  
  // Convert hex string to buffer, or create a hash if it's not hex
  if (keyString.length === KEY_LENGTH * 2 && /^[0-9a-fA-F]+$/.test(keyString)) {
    return Buffer.from(keyString, 'hex');
  } else {
    // Create a consistent key from the string
    return crypto.scryptSync(keyString, 'craftastic-salt', KEY_LENGTH);
  }
}

/**
 * Encrypt credential data
 */
export function encryptCredentials(data: any): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    const jsonString = JSON.stringify(data);
    let encrypted = cipher.update(jsonString, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Combine IV and encrypted data
    const result = iv.toString('hex') + ':' + encrypted;
    return result;
  } catch (error: any) {
    throw new Error(`Failed to encrypt credentials: ${error.message}`);
  }
}

/**
 * Decrypt credential data
 */
export function decryptCredentials(encryptedData: string): any {
  try {
    const key = getEncryptionKey();
    const parts = encryptedData.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error: any) {
    throw new Error(`Failed to decrypt credentials: ${error.message}`);
  }
}

/**
 * Test encryption/decryption functionality
 */
export function testEncryption(): boolean {
  try {
    const testData = { 
      api_key: 'test-key-123', 
      email: 'test@example.com',
      timestamp: new Date().toISOString()
    };
    
    const encrypted = encryptCredentials(testData);
    const decrypted = decryptCredentials(encrypted);
    
    return JSON.stringify(testData) === JSON.stringify(decrypted);
  } catch (error) {
    console.error('Encryption test failed:', error);
    return false;
  }
}

/**
 * Simple credential validation - just ensure it's a non-empty string
 */
export function validateCredentialValue(value: any): value is string {
  return typeof value === 'string' && value.length > 0;
}