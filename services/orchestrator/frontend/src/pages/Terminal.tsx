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
  
  const [showGitPanel, setShowGitPanel] = useState(false);

  useEffect(() => {
    if (!terminalRef.current || !sessionId || !environmentId) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff',
        cursor: '#ffffff',
      },
      allowProposedApi: true,
      convertEol: true,
      cols: 80,
      rows: 24,
      scrollback: 1000
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);
    
    fitAddonRef.current = fitAddon;
    xtermRef.current = term;
    
    // Initial fit after terminal is opened
    setTimeout(() => {
      fitAddon.fit();
    }, 50);

    // Set up ResizeObserver for more reliable resize detection
    if (terminalRef.current && window.ResizeObserver) {
      resizeObserverRef.current = new ResizeObserver(() => {
        // Debounce the resize to avoid excessive calls
        clearTimeout((window as any).terminalResizeTimeout);
        (window as any).terminalResizeTimeout = setTimeout(() => {
          if (fitAddonRef.current && xtermRef.current) {
            try {
              fitAddonRef.current.fit();
              
              // Send new dimensions to server if WebSocket is open
              if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current.cols && xtermRef.current.rows) {
                wsRef.current.send(JSON.stringify({
                  type: 'resize',
                  cols: xtermRef.current.cols,
                  rows: xtermRef.current.rows,
                }));
              }
            } catch (error) {
              console.error('Error during terminal resize:', error);
            }
          }
        }, 150);
      });
      
      resizeObserverRef.current.observe(terminalRef.current);
    }

    // Add a small delay before connecting WebSocket to ensure terminal is ready
    const connectWebSocket = () => {
      const ws = new WebSocket(
        `ws://localhost:3000/api/terminal/ws/${sessionId}?environmentId=${environmentId}`
      );

      ws.onopen = () => {
        console.log('WebSocket connected');
        
        // Send initial dimensions after connection is established
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN && term.cols && term.rows) {
            const dimensions = {
              type: 'resize',
              cols: term.cols,
              rows: term.rows,
            };
            ws.send(JSON.stringify(dimensions));
          }
        }, 200);
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

      // Fallback window resize handler for browsers without ResizeObserver
      const handleWindowResize = () => {
        clearTimeout((window as any).windowResizeTimeout);
        (window as any).windowResizeTimeout = setTimeout(() => {
          if (fitAddonRef.current && xtermRef.current) {
            try {
              fitAddonRef.current.fit();
              
              if (ws.readyState === WebSocket.OPEN && xtermRef.current.cols && xtermRef.current.rows) {
                ws.send(JSON.stringify({
                  type: 'resize',
                  cols: xtermRef.current.cols,
                  rows: xtermRef.current.rows,
                }));
              }
            } catch (error) {
              console.error('Error during window resize:', error);
            }
          }
        }, 150);
      };

      window.addEventListener('resize', handleWindowResize);
      wsRef.current = ws;

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
    }, 300);

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
          
          // Send new dimensions to server
          if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current.cols && xtermRef.current.rows) {
            wsRef.current.send(JSON.stringify({
              type: 'resize',
              cols: xtermRef.current.cols,
              rows: xtermRef.current.rows,
            }));
          }
        } catch (error) {
          console.error('Error during git panel resize:', error);
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [showGitPanel]);

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="h-14 border-b border-border flex items-center justify-between px-4">
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
        {environmentId && <SessionList environmentId={environmentId} />}
        
        <div className="flex-1 flex bg-black">
          <div ref={terminalRef} className="flex-1" />
        </div>
        
        {showGitPanel && environmentId && (
          <GitPanel environmentId={environmentId} />
        )}
      </div>
    </div>
  );
}