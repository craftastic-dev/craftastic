import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import * as client from '@/api/client.ts';

interface InlineTerminalProps {
  sessionId: string;
  environmentId: string;
  height?: number | string;
  onTokenDetected?: (token: string) => void;
}

export function InlineTerminal({ sessionId, environmentId, height = 420, onTokenDetected }: InlineTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      fontSize: 14,
      fontFamily: 'monospace',
      cursorBlink: true,
      scrollback: 1000,
      theme: { background: '#000000', foreground: '#e5e7eb' },
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(containerRef.current);
    // Delay initial fit until DOM paints
    const safeFit = () => {
      try {
        const proposed = fit.proposeDimensions();
        if (proposed && proposed.cols > 0 && proposed.rows > 0) {
          fit.fit();
        } else if (xtermRef.current) {
          // Fallback to a sane default
          xtermRef.current.resize(80, 24);
          xtermRef.current.refresh(0, 24);
        }
      } catch {}
    };
    setTimeout(safeFit, 50);
    xtermRef.current = term;
    fitAddonRef.current = fit;

    const connect = async () => {
      const ok = await client.ensureValidToken();
      if (!ok) return;
      const token = localStorage.getItem('accessToken');
      const wsUrl = `ws://localhost:3000/api/terminal/ws/${sessionId}?environmentId=${environmentId}&token=${encodeURIComponent(token || '')}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setTimeout(safeFit, 100);
        // Send our current size proactively
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN && xtermRef.current) {
            ws.send(JSON.stringify({ type: 'resize', cols: xtermRef.current.cols, rows: xtermRef.current.rows }));
          }
        }, 150);
        // Visible handshake so the user sees something even if app output lags
        term.writeln('\r\n[Connected]\r\n');
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'output') {
            term.write(data.data);
            // Detect Claude long-lived token in output
            const m = /CLAUDE_CODE_OAUTH_TOKEN=([a-zA-Z0-9_\-\.]+)/.exec(data.data) || /\bsk-[a-z0-9]{2,}[-_a-z0-9\.]*\b/i.exec(data.data);
            if (m && onTokenDetected) {
              onTokenDetected(m[1] || m[0]);
            }
          } else if (data.type === 'request-resize') {
            safeFit();
            if (ws.readyState === WebSocket.OPEN && xtermRef.current) {
              ws.send(JSON.stringify({ type: 'resize', cols: xtermRef.current.cols, rows: xtermRef.current.rows }));
            }
          }
        } catch {}
      };
      ws.onclose = () => setConnected(false);

      term.onData((d) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
      });
    };

    connect();

    const onResize = () => safeFit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      wsRef.current?.close();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, environmentId]);

  return (
    <div style={{ height }} className="bg-black rounded-md overflow-hidden border border-border">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}


