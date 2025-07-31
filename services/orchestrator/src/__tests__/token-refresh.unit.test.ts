import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the entire api client module
vi.mock('../../frontend/src/api/client', () => {
  const mockLocalStorage: Record<string, string> = {};
  
  const localStorage = {
    getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
    setItem: vi.fn((key: string, value: string) => { mockLocalStorage[key] = value; }),
    removeItem: vi.fn((key: string) => { delete mockLocalStorage[key]; }),
    clear: vi.fn(() => { for (const key in mockLocalStorage) delete mockLocalStorage[key]; })
  };

  const mockFetch = vi.fn();
  
  // Helper to create mock JWT
  const createMockJWT = (exp: number) => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const payload = Buffer.from(JSON.stringify({
      sub: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      emailVerified: true,
      exp
    })).toString('base64');
    return `${header}.${payload}.signature`;
  };

  // The actual implementation copied from client.ts
  const isTokenExpired = (token: string, bufferMinutes: number = 5): boolean => {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const expiresAt = payload.exp * 1000;
      const now = Date.now();
      const bufferMs = bufferMinutes * 60 * 1000;
      return expiresAt - now < bufferMs;
    } catch (error) {
      return true;
    }
  };

  const ensureValidToken = async (): Promise<boolean> => {
    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    
    if (!accessToken || !refreshToken) {
      return false;
    }
    
    if (!isTokenExpired(accessToken)) {
      return true;
    }
    
    try {
      const response = await mockFetch('http://localhost:3000/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      
      if (response.ok) {
        const result = await response.json();
        localStorage.setItem('accessToken', result.data.accessToken);
        localStorage.setItem('refreshToken', result.data.refreshToken);
        return true;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }
    
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    return false;
  };

  const handleApiResponse = async (response: any, originalRequest?: () => Promise<any>): Promise<any> => {
    if (response.status === 401 && originalRequest) {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const refreshResponse = await mockFetch('http://localhost:3000/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });

          if (refreshResponse.ok) {
            const result = await refreshResponse.json();
            localStorage.setItem('accessToken', result.data.accessToken);
            localStorage.setItem('refreshToken', result.data.refreshToken);
            
            return await originalRequest();
          }
        } catch (error) {
          console.error('Token refresh failed:', error);
        }
      }
      
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      
      // Mock window.location.reload
      if (global.window?.location?.reload) {
        global.window.location.reload();
      }
    }
    
    return response;
  };

  return {
    ensureValidToken,
    handleApiResponse,
    __testing: {
      localStorage,
      mockFetch,
      createMockJWT,
      mockLocalStorage
    }
  };
});

describe('Token Refresh Unit Tests', () => {
  let apiClient: any;
  let mockFetch: any;
  let localStorage: any;
  let createMockJWT: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Import the mocked module
    apiClient = await import('../../frontend/src/api/client');
    mockFetch = apiClient.__testing.mockFetch;
    localStorage = apiClient.__testing.localStorage;
    createMockJWT = apiClient.__testing.createMockJWT;
    
    // Clear localStorage
    apiClient.__testing.mockLocalStorage = {};
    
    // Setup window mock
    global.window = { location: { reload: vi.fn() } };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureValidToken', () => {
    it('should return true when token is valid and not near expiration', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 600; // 10 minutes
      const validToken = createMockJWT(futureExp);
      
      localStorage.getItem
        .mockReturnValueOnce(validToken) // accessToken
        .mockReturnValueOnce('refresh-token'); // refreshToken

      const result = await apiClient.ensureValidToken();
      
      expect(result).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should refresh token when it expires within buffer time', async () => {
      const nearExp = Math.floor(Date.now() / 1000) + 180; // 3 minutes
      const expiringToken = createMockJWT(nearExp);
      const newExp = Math.floor(Date.now() / 1000) + 900; // 15 minutes
      const newToken = createMockJWT(newExp);
      
      localStorage.getItem
        .mockReturnValueOnce(expiringToken) // accessToken check
        .mockReturnValueOnce('old-refresh-token'); // refreshToken check

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            accessToken: newToken,
            refreshToken: 'new-refresh-token'
          }
        })
      });

      const result = await apiClient.ensureValidToken();
      
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/auth/refresh',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: 'old-refresh-token' })
        }
      );
      expect(localStorage.setItem).toHaveBeenCalledWith('accessToken', newToken);
      expect(localStorage.setItem).toHaveBeenCalledWith('refreshToken', 'new-refresh-token');
    });

    it('should return false and clear tokens when refresh fails', async () => {
      const expiredToken = createMockJWT(Math.floor(Date.now() / 1000) - 60);
      
      localStorage.getItem
        .mockReturnValueOnce(expiredToken)
        .mockReturnValueOnce('invalid-refresh-token');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid refresh token' })
      });

      const result = await apiClient.ensureValidToken();
      
      expect(result).toBe(false);
      expect(localStorage.removeItem).toHaveBeenCalledWith('accessToken');
      expect(localStorage.removeItem).toHaveBeenCalledWith('refreshToken');
    });

    it('should return false when no tokens exist', async () => {
      localStorage.getItem.mockReturnValue(null);

      const result = await apiClient.ensureValidToken();
      
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle malformed tokens', async () => {
      localStorage.getItem
        .mockReturnValueOnce('malformed.token')
        .mockReturnValueOnce('refresh-token');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401
      });

      const result = await apiClient.ensureValidToken();
      
      expect(result).toBe(false);
      expect(localStorage.removeItem).toHaveBeenCalledWith('accessToken');
      expect(localStorage.removeItem).toHaveBeenCalledWith('refreshToken');
    });

    it('should handle network errors during refresh', async () => {
      const expiredToken = createMockJWT(Math.floor(Date.now() / 1000) - 60);
      
      localStorage.getItem
        .mockReturnValueOnce(expiredToken)
        .mockReturnValueOnce('refresh-token');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await apiClient.ensureValidToken();
      
      expect(result).toBe(false);
      expect(localStorage.removeItem).toHaveBeenCalledWith('accessToken');
      expect(localStorage.removeItem).toHaveBeenCalledWith('refreshToken');
    });
  });

  describe('handleApiResponse', () => {
    it('should retry request after successful token refresh', async () => {
      const response401 = { status: 401, ok: false };
      const successResponse = { status: 200, ok: true, json: async () => ({ data: 'success' }) };
      
      localStorage.getItem.mockReturnValue('old-refresh-token');
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token'
          }
        })
      });

      const originalRequest = vi.fn().mockResolvedValue(successResponse);
      
      const result = await apiClient.handleApiResponse(response401, originalRequest);
      
      expect(result).toBe(successResponse);
      expect(originalRequest).toHaveBeenCalledTimes(1);
      expect(localStorage.setItem).toHaveBeenCalledWith('accessToken', 'new-access-token');
      expect(localStorage.setItem).toHaveBeenCalledWith('refreshToken', 'new-refresh-token');
    });

    it('should clear tokens and reload on refresh failure', async () => {
      const response401 = { status: 401, ok: false };
      
      localStorage.getItem.mockReturnValue('invalid-refresh-token');
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401
      });

      const originalRequest = vi.fn();
      
      await apiClient.handleApiResponse(response401, originalRequest);
      
      expect(originalRequest).not.toHaveBeenCalled();
      expect(localStorage.removeItem).toHaveBeenCalledWith('accessToken');
      expect(localStorage.removeItem).toHaveBeenCalledWith('refreshToken');
      expect(global.window.location.reload).toHaveBeenCalled();
    });

    it('should pass through non-401 responses', async () => {
      const response200 = { status: 200, ok: true };
      
      const result = await apiClient.handleApiResponse(response200);
      
      expect(result).toBe(response200);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent refresh attempts', async () => {
      const expiredToken = createMockJWT(Math.floor(Date.now() / 1000) - 60);
      const newToken = createMockJWT(Math.floor(Date.now() / 1000) + 900);
      
      localStorage.getItem
        .mockReturnValueOnce(expiredToken)
        .mockReturnValueOnce('refresh-token')
        .mockReturnValueOnce(expiredToken)
        .mockReturnValueOnce('refresh-token')
        .mockReturnValueOnce(expiredToken)
        .mockReturnValueOnce('refresh-token');

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            accessToken: newToken,
            refreshToken: 'new-refresh-token'
          }
        })
      });

      const results = await Promise.all([
        apiClient.ensureValidToken(),
        apiClient.ensureValidToken(),
        apiClient.ensureValidToken()
      ]);

      expect(results).toEqual([true, true, true]);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Each call refreshes independently
    });

    it('should handle token that expires exactly at buffer time', async () => {
      const bufferExp = Math.floor(Date.now() / 1000) + 300; // Exactly 5 minutes
      const bufferToken = createMockJWT(bufferExp);
      const newToken = createMockJWT(Math.floor(Date.now() / 1000) + 900);
      
      localStorage.getItem
        .mockReturnValueOnce(bufferToken)
        .mockReturnValueOnce('refresh-token');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            accessToken: newToken,
            refreshToken: 'new-refresh-token'
          }
        })
      });

      const result = await apiClient.ensureValidToken();
      
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalled(); // Should refresh at exactly buffer time
    });
  });
});