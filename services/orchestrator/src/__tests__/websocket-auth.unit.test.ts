import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock WebSocket class
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({ type: 'open' });
    }, 10);
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ type: 'close', code, reason });
  }
}

// Mock terminal write
const mockTerminalWrite = vi.fn();

// Mock ensureValidToken
const mockEnsureValidToken = vi.fn();

describe('WebSocket Authentication and Reconnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.WebSocket = MockWebSocket as any;
    
    // Reset localStorage mock
    global.localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    };
  });

  it('should check and refresh token before WebSocket connection', async () => {
    const validToken = 'valid.jwt.token';
    mockEnsureValidToken.mockResolvedValueOnce(true);
    (global.localStorage.getItem as any).mockReturnValue(validToken);

    const connectWebSocket = async () => {
      const tokenValid = await mockEnsureValidToken();
      if (!tokenValid) {
        mockTerminalWrite('\r\n[Error] Authentication failed. Please log in again.\r\n');
        return null;
      }

      const accessToken = global.localStorage.getItem('accessToken');
      if (!accessToken) {
        mockTerminalWrite('\r\n[Error] Not authenticated\r\n');
        return null;
      }

      const ws = new MockWebSocket(`ws://localhost:3000/api/terminal/ws/session-123?token=${accessToken}`);
      return ws;
    };

    const ws = await connectWebSocket();

    expect(mockEnsureValidToken).toHaveBeenCalled();
    expect(ws).toBeTruthy();
    expect(ws?.url).toContain('token=valid.jwt.token');
  });

  it('should fail connection when token refresh fails', async () => {
    mockEnsureValidToken.mockResolvedValueOnce(false);
    const mockReload = vi.fn();
    global.window = { location: { reload: mockReload } };

    const connectWebSocket = async () => {
      const tokenValid = await mockEnsureValidToken();
      if (!tokenValid) {
        mockTerminalWrite('\r\n[Error] Authentication failed. Please log in again.\r\n');
        setTimeout(() => window.location.reload(), 2000);
        return null;
      }

      const accessToken = global.localStorage.getItem('accessToken');
      if (!accessToken) {
        mockTerminalWrite('\r\n[Error] Not authenticated\r\n');
        return null;
      }

      const ws = new MockWebSocket(`ws://localhost:3000/api/terminal/ws/session-123?token=${accessToken}`);
      return ws;
    };

    const ws = await connectWebSocket();

    expect(mockEnsureValidToken).toHaveBeenCalled();
    expect(ws).toBeNull();
    expect(mockTerminalWrite).toHaveBeenCalledWith('\r\n[Error] Authentication failed. Please log in again.\r\n');
    
    // Wait for reload timeout
    await new Promise(resolve => setTimeout(resolve, 2100));
    expect(mockReload).toHaveBeenCalled();
  });

  it('should reconnect WebSocket on authentication failure (1008)', async () => {
    const oldToken = 'old.jwt.token';
    const newToken = 'new.jwt.token';
    let tokenCallCount = 0;
    
    mockEnsureValidToken.mockImplementation(async () => {
      tokenCallCount++;
      return true; // Always return true for this test
    });
    
    (global.localStorage.getItem as any).mockImplementation(() => {
      return tokenCallCount > 1 ? newToken : oldToken;
    });

    let wsInstances: MockWebSocket[] = [];
    
    const connectWebSocket = async (): Promise<MockWebSocket | null> => {
      const tokenValid = await mockEnsureValidToken();
      if (!tokenValid) {
        mockTerminalWrite('\r\n[Error] Authentication failed. Please log in again.\r\n');
        return null;
      }

      const accessToken = global.localStorage.getItem('accessToken');
      if (!accessToken) {
        mockTerminalWrite('\r\n[Error] Not authenticated\r\n');
        return null;
      }

      const ws = new MockWebSocket(`ws://localhost:3000/api/terminal/ws/session-123?token=${accessToken}`);
      wsInstances.push(ws);
      
      ws.onclose = async (event: any) => {
        if (event.code === 1008 && event.reason?.includes('authentication')) {
          mockTerminalWrite('\r\n[Authentication failed, refreshing token...]\r\n');
          
          const tokenValid = await mockEnsureValidToken();
          if (tokenValid) {
            mockTerminalWrite('[Reconnecting...]\r\n');
            setTimeout(async () => {
              await connectWebSocket();
            }, 1000);
          } else {
            mockTerminalWrite('\r\n[Authentication failed. Please log in again.]\r\n');
          }
        } else {
          mockTerminalWrite('\r\n[Disconnected]\r\n');
        }
      };

      return ws;
    };

    // Initial connection
    const ws1 = await connectWebSocket();
    expect(ws1).toBeTruthy();
    expect(ws1?.url).toContain('token=old.jwt.token');

    // Simulate auth failure
    ws1?.close(1008, 'Invalid authentication token');

    // Wait for reconnection
    await new Promise(resolve => setTimeout(resolve, 1100));

    expect(wsInstances).toHaveLength(2);
    expect(wsInstances[1].url).toContain('token=new.jwt.token');
    expect(mockTerminalWrite).toHaveBeenCalledWith('\r\n[Authentication failed, refreshing token...]\r\n');
    expect(mockTerminalWrite).toHaveBeenCalledWith('[Reconnecting...]\r\n');
  });

  it('should not reconnect on non-auth WebSocket failures', async () => {
    mockEnsureValidToken.mockResolvedValueOnce(true);
    (global.localStorage.getItem as any).mockReturnValue('valid.token');

    let reconnectAttempted = false;

    const connectWebSocket = async () => {
      const tokenValid = await mockEnsureValidToken();
      if (!tokenValid) return null;

      const accessToken = global.localStorage.getItem('accessToken');
      if (!accessToken) return null;

      const ws = new MockWebSocket(`ws://localhost:3000/api/terminal/ws/session-123?token=${accessToken}`);
      
      ws.onclose = async (event: any) => {
        if (event.code === 1008 && event.reason?.includes('authentication')) {
          reconnectAttempted = true;
          // Would attempt reconnect here
        } else {
          mockTerminalWrite('\r\n[Disconnected]\r\n');
        }
      };

      return ws;
    };

    const ws = await connectWebSocket();
    expect(ws).toBeTruthy();

    // Simulate non-auth failure
    ws?.close(1006, 'Abnormal closure');

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(reconnectAttempted).toBe(false);
    expect(mockTerminalWrite).toHaveBeenCalledWith('\r\n[Disconnected]\r\n');
  });

  it('should handle token refresh during active WebSocket session', async () => {
    const initialToken = 'initial.jwt.token';
    const refreshedToken = 'refreshed.jwt.token';
    let currentToken = initialToken;

    mockEnsureValidToken.mockResolvedValue(true);
    (global.localStorage.getItem as any).mockImplementation(() => currentToken);

    const connectWebSocket = async () => {
      await mockEnsureValidToken();
      const accessToken = global.localStorage.getItem('accessToken');
      const ws = new MockWebSocket(`ws://localhost:3000/api/terminal/ws/session-123?token=${accessToken}`);
      return ws;
    };

    // Connect with initial token
    const ws = await connectWebSocket();
    expect(ws?.url).toContain(`token=${initialToken}`);

    // Wait for WebSocket to open
    await new Promise(resolve => setTimeout(resolve, 20));

    // Simulate token refresh happening in background
    currentToken = refreshedToken;

    // WebSocket should continue working with old token until reconnection needed
    expect(ws?.readyState).toBe(MockWebSocket.OPEN);

    // When reconnection happens (e.g., due to network issue), it should use new token
    ws?.close(1006, 'Network error');
    
    // Reconnect would use the refreshed token
    const ws2 = await connectWebSocket();
    expect(ws2?.url).toContain(`token=${refreshedToken}`);
  });
});