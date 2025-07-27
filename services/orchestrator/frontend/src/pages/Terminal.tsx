import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { GitBranch } from 'lucide-react';
import 'xterm/css/xterm.css';
import { GitPanel } from '../components/GitPanel';
import { SessionList } from '../components/SessionList';
import { Button } from '../components/ui/button';

export function Terminal() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const environmentId = searchParams.get('environmentId');
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  
  const [showGitPanel, setShowGitPanel] = useState(false);

  useEffect(() => {
    if (!terminalRef.current || !sessionId || !environmentId) return;

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
    term.open(terminalRef.current);
    
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
    
    // Wait until fonts are fully loaded before fitting – prevents later shrink when font metrics change
    if (document?.fonts?.ready) {
      document.fonts.ready.then(() => {
        fitTerminal();
      });
    } else {
      // Fallback for browsers without Font Loading API
      requestAnimationFrame(() => {
        fitTerminal();
      });
    }

    // We no longer use ResizeObserver for auto-fitting to avoid recursive shrink issues

    // Add a small delay before connecting WebSocket to ensure terminal is ready
    const connectWebSocket = () => {
      const ws = new WebSocket(
        `ws://localhost:3000/api/terminal/ws/${sessionId}?environmentId=${environmentId}`
      );

      ws.onopen = () => {
        console.log('WebSocket connected');
        
        // Simple fit and dimension send
        setTimeout(() => {
          if (fitAddonRef.current && xtermRef.current) {
            try {
              fitAddonRef.current.fit();
              console.log(`Connected - terminal size: ${xtermRef.current.cols}x${xtermRef.current.rows}`);
              
              if (xtermRef.current.cols > 0 && xtermRef.current.rows > 0) {
                ws.send(JSON.stringify({
                  type: 'resize',
                  cols: xtermRef.current.cols,
                  rows: xtermRef.current.rows,
                }));
              }
            } catch (error) {
              console.error('Error during initial setup:', error);
            }
          }
        }, 100);
      };

      return ws;
    };

    // Wait a bit before connecting to ensure terminal is fully initialized
    const timeoutId = setTimeout(() => {
      const ws = connectWebSocket();

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'output') {
            // Write data directly to terminal - let xterm handle ANSI sequences
            term.write(data.data);
          } else if (data.type === 'error') {
            term.write(`\r\n[Error] ${data.message}\r\n`);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        term.write('\r\n[Connection Error]\r\n');
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason);
        term.write('\r\n[Disconnected]\r\n');
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

  // Handle terminal resize when git panel is toggled
  useEffect(() => {
    const timer = setTimeout(() => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit();
          
          // Force a redraw after fitting
          xtermRef.current.refresh(0, xtermRef.current.rows - 1);
          
          // Send new dimensions to server
          if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current.cols && xtermRef.current.rows) {
            const dimensions = {
              type: 'resize',
              cols: xtermRef.current.cols,
              rows: xtermRef.current.rows,
            };
            console.log('Sending dimensions after git panel toggle:', dimensions);
            wsRef.current.send(JSON.stringify(dimensions));
          }
        } catch (error) {
          console.error('Error during git panel resize:', error);
        }
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [showGitPanel]);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      <div className="h-14 border-b border-border flex items-center justify-between px-4 bg-background">
        <h2 className="text-lg font-semibold">
          Terminal - Session: {sessionId?.substring(0, 8)}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowGitPanel(!showGitPanel)}
        >
          <GitBranch className="h-4 w-4 mr-2" />
          {showGitPanel ? 'Hide' : 'Show'} Git Panel
        </Button>
      </div>
      
      <div className="flex-1 flex overflow-hidden">
        {environmentId && (
          <div className="w-64 border-r border-border bg-background flex-shrink-0">
            <SessionList environmentId={environmentId} />
          </div>
        )}
        
        <div className="flex-1 flex flex-col bg-black min-w-0">
          <div 
            ref={terminalRef} 
            className="flex-1 w-full h-full terminal-container"
            style={{ 
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              overflow: 'hidden',
            }}
          />
        </div>
        
        {showGitPanel && environmentId && (
          <div className="w-80 border-l border-border bg-background flex-shrink-0">
            <GitPanel environmentId={environmentId} />
          </div>
        )}
      </div>
    </div>
  );
}