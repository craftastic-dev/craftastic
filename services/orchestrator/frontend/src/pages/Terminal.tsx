import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { Maximize2, Minimize2, ArrowLeft, FileText, PanelRightOpen, PanelRightClose, Trash2 } from 'lucide-react';
import 'xterm/css/xterm.css';
import { Button } from '../components/ui/button';
import { GitPanel } from '../components/GitPanel';
import * as client from '../api/client.ts';

export function Terminal() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const environmentId = searchParams.get('environmentId');
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const preExpandDimensionsRef = useRef<{ cols: number; rows: number } | null>(null);
  
  const [isExpanded, setIsExpanded] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch session data to get the name
  const { data: sessionData } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => client.api.getSession(sessionId!),
    enabled: !!sessionId,
  });

  useEffect(() => {
    console.log('[Terminal.tsx] useEffect triggered', { sessionId, environmentId, hasTerminalRef: !!terminalRef.current });
    
    if (!terminalRef.current || !sessionId || !environmentId) {
      console.log('[Terminal.tsx] Missing required props, skipping initialization');
      return;
    }

    // Check container dimensions before proceeding
    const containerRect = terminalRef.current.getBoundingClientRect();
    console.log('[Terminal.tsx] Container dimensions:', { 
      width: containerRect.width, 
      height: containerRect.height,
      element: terminalRef.current
    });

    console.log('[Terminal.tsx] Creating XTerm instance...');
    const term = new XTerm({
      // Absolute minimal configuration
      fontSize: 14,
      fontFamily: 'monospace',
      theme: {
        background: '#000000',
        foreground: '#ffffff',
      },
      // Essential settings only
      convertEol: false, // Let terminal handle line endings
      cols: 80,
      rows: 24,
      scrollback: 1000,
      // Cursor configuration for visibility
      cursorBlink: true,
      cursorStyle: 'block',
      // Selection settings - enable text selection
      rightClickSelectsWord: true, // Enable right-click word selection
      macOptionClickForcesSelection: true, // Help with tmux on macOS
      // Remove potentially problematic settings
      allowProposedApi: false,
      screenReaderMode: false,
      windowsMode: false,
      allowTransparency: false,
      // Use default canvas renderer (DOM renderer has selection bugs)
      // rendererType: 'dom',
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    
    console.log('[Terminal.tsx] Opening terminal on element:', terminalRef.current);
    console.log('[Terminal.tsx] Terminal state before open:', {
      element: term.element,
      cols: term.cols,
      rows: term.rows
    });
    
    try {
      term.open(terminalRef.current);
      console.log('[Terminal.tsx] Terminal opened successfully');
    } catch (error) {
      console.error('[Terminal.tsx] Error opening terminal:', error);
      throw error;
    }
    
    fitAddonRef.current = fitAddon;
    xtermRef.current = term;
    
    // Initial fit after terminal is opened with multiple attempts
    const fitTerminal = () => {
      try {
        // Ensure terminal container has dimensions before fitting
        if (!terminalRef.current) {
          console.warn('Terminal container not available for fitting');
          return;
        }
        
        const containerRect = terminalRef.current.getBoundingClientRect();
        if (containerRect.width === 0 || containerRect.height === 0) {
          console.warn('Terminal container has zero dimensions, skipping fit');
          return;
        }
        
        // Check if container and fitAddon are ready before fitting
        if (!fitAddon || !terminalRef.current) {
          console.warn('FitAddon or container not ready for fitting');
          return;
        }
        
        // Check if terminal renderer is ready
        if (!term.element || !term.element.querySelector('.xterm-screen')) {
          console.warn('Terminal renderer not ready, delaying fit');
          setTimeout(fitTerminal, 50);
          return;
        }
        
        // Try to get proposed dimensions first to validate
        const proposed = fitAddon.proposeDimensions();
        if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) {
          console.warn('Invalid proposed dimensions:', proposed);
          return;
        }
        
        fitAddon.fit();
        console.log(`Terminal fitted to: ${term.cols}x${term.rows} (proposed: ${proposed.cols}x${proposed.rows})`);
        
        // Force a redraw after fitting
        if (term.rows > 0) {
          term.refresh(0, term.rows - 1);
        }
      } catch (error) {
        console.error('Error during terminal fit:', error);
      }
    };
    
    // Ensure terminal is fully rendered before operations
    const waitForTerminalReady = (callback: () => void) => {
      const checkReady = () => {
        // Check if terminal DOM elements are ready
        if (term.element && term.element.querySelector('.xterm-screen') && term.element.querySelector('.xterm-viewport')) {
          callback();
        } else {
          requestAnimationFrame(checkReady);
        }
      };
      checkReady();
    };

    // Wait until terminal is rendered and fonts are loaded
    waitForTerminalReady(() => {
      if (document?.fonts?.ready) {
        document.fonts.ready.then(() => {
          fitTerminal();
          // Focus terminal after initial setup
          term.focus();
          console.log('Terminal focused after fonts loaded');
        });
      } else {
        // Fallback for browsers without Font Loading API
        setTimeout(() => {
          fitTerminal();
          // Focus terminal after initial setup
          term.focus();
          console.log('Terminal focused after initial setup');
        }, 100);
      }
    });

    // We no longer use ResizeObserver for auto-fitting to avoid recursive shrink issues

    // Add a small delay before connecting WebSocket to ensure terminal is ready
    const connectWebSocket = async () => {
      // Ensure terminal is ready before connecting
      if (!term.element || !term.element.querySelector('.xterm-screen')) {
        console.warn('[Terminal.tsx] Terminal not ready for WebSocket connection, retrying...');
        setTimeout(connectWebSocket, 100);
        return null;
      }

      // Check and refresh token if needed
      console.log('[Terminal.tsx] Checking token validity before WebSocket connection...');
      const tokenValid = await client.ensureValidToken();
      if (!tokenValid) {
        console.error('[Terminal.tsx] Failed to ensure valid token');
        term.write('\r\n[Error] Authentication failed. Please log in again.\r\n');
        // Redirect to login after a delay
        setTimeout(() => {
          window.location.reload(); // This will show the auth form
        }, 2000);
        return null;
      }

      // Get auth token for WebSocket authentication
      const accessToken = localStorage.getItem('accessToken');
      if (!accessToken) {
        console.error('[Terminal.tsx] No access token found after refresh attempt');
        term.write('\r\n[Error] Not authenticated\r\n');
        return null;
      }
      
      const wsUrl = `ws://localhost:3000/api/terminal/ws/${sessionId}?environmentId=${environmentId}&token=${encodeURIComponent(accessToken)}`;
      console.log('[Terminal.tsx] Creating WebSocket connection (with auth)');
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        
        // Ensure terminal is properly sized before sending dimensions
        const setupTerminal = () => {
          if (fitAddonRef.current && xtermRef.current) {
            try {
              // Ensure terminal has valid dimensions
              const proposed = fitAddonRef.current.proposeDimensions();
              if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) {
                console.warn('Invalid dimensions on connect, retrying...');
                setTimeout(setupTerminal, 50);
                return;
              }
              
              fitAddonRef.current.fit();
              console.log(`Connected - terminal size: ${xtermRef.current.cols}x${xtermRef.current.rows}`);
              
              if (xtermRef.current.cols > 0 && xtermRef.current.rows > 0) {
                ws.send(JSON.stringify({
                  type: 'resize',
                  cols: xtermRef.current.cols,
                  rows: xtermRef.current.rows,
                }));
              }

              // Auto-focus the terminal when WebSocket connects
              xtermRef.current.focus();
              console.log('Terminal focused automatically');
            } catch (error) {
              console.error('Error during initial setup:', error);
            }
          }
        };
        
        setTimeout(setupTerminal, 100);
      };

      return ws;
    };

    // Wait a bit before connecting to ensure terminal is fully initialized
    const timeoutId = setTimeout(async () => {
      console.log('[Terminal.tsx] Attempting WebSocket connection...');
      const ws = await connectWebSocket();
      if (!ws) {
        console.log('[Terminal.tsx] WebSocket connection delayed, terminal not ready');
        return;
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[Terminal] WebSocket message received:', data.type, data.data?.length || 0, 'chars');
          
          if (data.type === 'output') {
            // Write data directly to terminal - let xterm handle ANSI sequences
            term.write(data.data);
          } else if (data.type === 'error') {
            term.write(`\r\n[Error] ${data.message}\r\n`);
          } else if (data.type === 'request-resize') {
            // Server is requesting current terminal dimensions
            if (fitAddonRef.current && xtermRef.current) {
              const cols = xtermRef.current.cols;
              const rows = xtermRef.current.rows;
              if (cols > 0 && rows > 0) {
                ws.send(JSON.stringify({
                  type: 'resize',
                  cols,
                  rows,
                }));
                console.log(`Sent terminal dimensions on request: ${cols}x${rows}`);
              }
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        term.write('\r\n[Connection Error]\r\n');
      };

      ws.onclose = async (event) => {
        console.log('WebSocket disconnected', event.code, event.reason);
        
        // Handle authentication failure (code 1008)
        if (event.code === 1008 && event.reason.includes('authentication')) {
          console.log('[Terminal.tsx] WebSocket closed due to authentication failure, attempting token refresh...');
          term.write('\r\n[Authentication failed, refreshing token...]\r\n');
          
          // Try to refresh token and reconnect
          const tokenValid = await client.ensureValidToken();
          if (tokenValid) {
            console.log('[Terminal.tsx] Token refreshed successfully, reconnecting...');
            term.write('[Reconnecting...]\r\n');
            
            // Reconnect with new token
            setTimeout(async () => {
              const newWs = await connectWebSocket();
              if (newWs && newWs instanceof WebSocket) {
                wsRef.current = newWs;
              }
            }, 1000);
          } else {
            console.error('[Terminal.tsx] Failed to refresh token, redirecting to login...');
            term.write('\r\n[Authentication failed. Please log in again.]\r\n');
            setTimeout(() => {
              window.location.reload(); // This will show the auth form
            }, 2000);
          }
        } else {
          term.write('\r\n[Disconnected]\r\n');
        }
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'input',
            data,
          }));
        }
      });

      // Window resize handler - only triggers on actual browser window changes
      const handleWindowResize = () => {
        clearTimeout((window as any).windowResizeTimeout);
        (window as any).windowResizeTimeout = setTimeout(() => {
          if (fitAddonRef.current && xtermRef.current && terminalRef.current) {
            try {
              const container = terminalRef.current;
              const rect = container.getBoundingClientRect();
              
              // Only resize if container has valid dimensions
              if (rect.width > 0 && rect.height > 0) {
                const oldCols = xtermRef.current.cols;
                const oldRows = xtermRef.current.rows;
                
                // Validate proposed dimensions before fitting
                const proposed = fitAddonRef.current.proposeDimensions();
                if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) {
                  console.warn('Window resize: Invalid proposed dimensions:', proposed);
                  return;
                }
                
                fitAddonRef.current.fit();
                console.log(`Window resize: ${oldCols}x${oldRows} -> ${xtermRef.current.cols}x${xtermRef.current.rows} (proposed: ${proposed.cols}x${proposed.rows})`);
                
                // Force a redraw after fitting
                if (xtermRef.current.rows > 0) {
                  xtermRef.current.refresh(0, xtermRef.current.rows - 1);
                }
                
                // Only send if dimensions actually changed
                if (ws.readyState === WebSocket.OPEN && 
                    xtermRef.current.cols > 0 && xtermRef.current.rows > 0 &&
                    (xtermRef.current.cols !== oldCols || xtermRef.current.rows !== oldRows)) {
                  ws.send(JSON.stringify({
                    type: 'resize',
                    cols: xtermRef.current.cols,
                    rows: xtermRef.current.rows,
                  }));
                  console.log(`Window resize: Sent new dimensions ${xtermRef.current.cols}x${xtermRef.current.rows}`);
                }
              }
            } catch (error) {
              console.error('Error during window resize:', error);
            }
          }
        }, 200); // Increased debounce time to prevent rapid firing
      };

      window.addEventListener('resize', handleWindowResize);
      wsRef.current = ws;

      // Disable problematic ResizeObserver that causes shrinking loops
      // Only use window resize events for terminal fitting
      console.log('Skipping ResizeObserver to prevent resize loops');

      return () => {
        window.removeEventListener('resize', handleWindowResize);
        clearTimeout(timeoutId);
        clearTimeout((window as any).terminalResizeTimeout);
        clearTimeout((window as any).windowResizeTimeout);
        
        if (resizeObserverRef.current) {
          resizeObserverRef.current.disconnect();
        }
        
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        term.dispose();
      };
    }, 500);

    // Cleanup function for immediate cleanup
    return () => {
      clearTimeout(timeoutId);
      clearTimeout((window as any).terminalResizeTimeout);
      clearTimeout((window as any).windowResizeTimeout);
      
      console.log('[Terminal.tsx] Cleanup: Disposing terminal resources');
      
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
      
      fitAddonRef.current = null;
    };
  }, [sessionId, environmentId]);

  // Remove duplicate useEffect since we have useLayoutEffect handling this

  // Handle terminal resize when expanded state changes
  useLayoutEffect(() => {
    if (isExpanded && fitAddonRef.current && xtermRef.current) {
      // Store dimensions before expanding
      if (xtermRef.current.cols > 0 && xtermRef.current.rows > 0) {
        preExpandDimensionsRef.current = {
          cols: xtermRef.current.cols,
          rows: xtermRef.current.rows
        };
      }
      
      // Fit to fullscreen after a delay
      setTimeout(() => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit();
          
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'resize',
              cols: xtermRef.current.cols,
              rows: xtermRef.current.rows,
            }));
          }
          
          // Focus terminal after expanding
          xtermRef.current.focus();
          console.log('Terminal focused after expanding');
        }
      }, 200);
    } else if (!isExpanded && xtermRef.current && fitAddonRef.current && terminalRef.current) {
      // Reset to small size to force proper recalculation
      xtermRef.current.resize(10, 10);
      
      // Wait for DOM to settle
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!fitAddonRef.current || !xtermRef.current || !terminalRef.current) return;
          
          try {
            // Restore original dimensions if available
            if (preExpandDimensionsRef.current?.cols > 0 && preExpandDimensionsRef.current?.rows > 0) {
              xtermRef.current.resize(
                preExpandDimensionsRef.current.cols, 
                preExpandDimensionsRef.current.rows
              );
              
              // Fine-tune with fit addon
              setTimeout(() => {
                if (fitAddonRef.current && xtermRef.current) {
                  fitAddonRef.current.fit();
                  
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                      type: 'resize',
                      cols: xtermRef.current.cols,
                      rows: xtermRef.current.rows,
                    }));
                  }
                  
                  xtermRef.current.refresh(0, xtermRef.current.rows - 1);
                  
                  // Re-focus terminal after resize
                  xtermRef.current.focus();
                }
              }, 100);
            } else {
              // Fallback to fit addon
              fitAddonRef.current.fit();
              
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: 'resize',
                  cols: xtermRef.current.cols,
                  rows: xtermRef.current.rows,
                }));
              }
              
              xtermRef.current.refresh(0, xtermRef.current.rows - 1);
              
              // Re-focus terminal after resize
              xtermRef.current.focus();
            }
          } catch (error) {
            console.error('Error during resize:', error);
          }
        });
      });
    }
  }, [isExpanded]);

  return (
    <div className={`flex flex-col bg-background ${isExpanded ? 'fixed inset-0 z-50' : 'h-full'}`}>
      {/* Collapse Button - only show when expanded */}
      {isExpanded && (
        <div className="absolute top-4 right-4 z-10">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded(false)}
            className="bg-background/80 backdrop-blur-sm"
          >
            <Minimize2 className="h-4 w-4 mr-2" />
            Collapse
          </Button>
        </div>
      )}

      {/* Header - only show when not expanded */}
      {!isExpanded && (
        <div className="h-14 border-b border-border flex items-center justify-between px-4 bg-background">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(`/environment/${environmentId}`)}
              className="h-8 w-8"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-lg font-semibold">
              Terminal - {sessionData?.name || `Session ${sessionId?.substring(0, 8)}`}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!sessionId || !environmentId || isDeleting}
              onClick={async () => {
                if (!sessionId || !environmentId) return;
                const confirmed = window.confirm('Delete this session? This cannot be undone.');
                if (!confirmed) return;
                try {
                  setIsDeleting(true);
                  await client.api.deleteSession(sessionId);
                  navigate(`/environment/${environmentId}`);
                } catch (error: any) {
                  alert(error?.message || 'Failed to delete session');
                } finally {
                  setIsDeleting(false);
                }
              }}
              className="text-red-500 border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGitPanel(!showGitPanel)}
            >
              {showGitPanel ? (
                <>
                  <PanelRightClose className="h-4 w-4 mr-2" />
                  Hide Git
                </>
              ) : (
                <>
                  <PanelRightOpen className="h-4 w-4 mr-2" />
                  Show Git
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExpanded(true)}
            >
              <Maximize2 className="h-4 w-4 mr-2" />
              Expand
            </Button>
          </div>
        </div>
      )}
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Terminal */}
        <div className="flex-1 flex bg-black min-w-0 overflow-hidden">
          <div 
            ref={terminalRef} 
            className="flex-1 w-full h-full"
          />
        </div>
        
        {/* Git Panel */}
        {showGitPanel && !isExpanded && sessionId && environmentId && (
          <GitPanel sessionId={sessionId} environmentId={environmentId} />
        )}
      </div>
    </div>
  );
}