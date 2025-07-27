import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, Circle, Plus } from 'lucide-react';
import { api } from '../api/client';
import type { Session } from '../api/client';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';

interface SessionListProps {
  environmentId: string;
}

export function SessionList({ environmentId }: SessionListProps) {
  const navigate = useNavigate();
  const { sessionId: currentSessionId } = useParams<{ sessionId: string }>();
  
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sessions', environmentId],
    queryFn: () => api.getEnvironmentSessions(environmentId),
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const handleSessionClick = (session: Session) => {
    navigate(`/terminal/${session.id}?environmentId=${environmentId}`);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getSessionName = (session: Session) => {
    return session.name || `Session ${session.id.substring(0, 8)}`;
  };

  return (
    <div className="w-64 bg-secondary/10 border-r border-border flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold text-sm">Sessions</h3>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          title="Refresh sessions"
          className="h-8 w-8"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      
      {isLoading && (
        <div className="flex items-center justify-center p-4 text-muted-foreground text-sm">
          Loading sessions...
        </div>
      )}
      
      <ScrollArea className="flex-1">
        {data?.sessions && data.sessions.length > 0 && (
          <div className="p-2">
            {data.sessions.map(session => (
              <button
                key={session.id}
                className={cn(
                  "w-full text-left p-3 rounded-md transition-colors mb-1",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                  session.id === currentSessionId && "bg-accent"
                )}
                onClick={() => handleSessionClick(session)}
              >
                <div className="flex items-start gap-3">
                  <Circle 
                    className={cn(
                      "h-2 w-2 mt-1.5",
                      session.status === 'active' ? "fill-green-500 text-green-500" : 
                      session.status === 'inactive' ? "fill-yellow-500 text-yellow-500" : "fill-muted text-muted"
                    )}
                  />
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {getSessionName(session)}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div>{formatDate(session.createdAt)}</div>
                      <div className="truncate">{session.workingDirectory}</div>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
      
      {data?.sessions && data.sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center p-4 text-center">
          <p className="text-muted-foreground text-sm mb-4">No sessions yet</p>
          <Button
            onClick={() => navigate(`/environment/${environmentId}`)}
            size="sm"
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Session
          </Button>
        </div>
      )}
    </div>
  );
}