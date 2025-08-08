import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Terminal, Trash2, ArrowLeft, GitBranch, Folder, Clock, Play, Square, Settings, Bot, Grid3X3, List, User, AlertCircle, Loader2, ExternalLink, Copy, Search, SortAsc, SortDesc } from 'lucide-react';
import { api } from '../api/client.ts';
import type { Session } from '../api/client.ts';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { CreateSessionDialog } from '../components/CreateSessionDialog';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Skeleton } from '@/components/ui/skeleton';

export function Environment() {
  const { environmentId } = useParams<{ environmentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();
  const [branchConflictError, setBranchConflictError] = useState<{
    branch: string;
    existingSession: { id: string; name: string | null };
  } | null>(null);

  const { data: environment, isLoading } = useQuery({
    queryKey: ['environment', environmentId],
    queryFn: () => api.getEnvironment(environmentId!),
    enabled: !!environmentId,
  });

  const { data: sessionsData } = useQuery({
    queryKey: ['sessions', environmentId],
    queryFn: () => api.getEnvironmentSessions(environmentId!),
    enabled: !!environmentId,
    refetchInterval: 5000,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['agents', userId],
    queryFn: () => userId ? api.getUserAgents(userId) : Promise.resolve({ agents: [] }),
    enabled: !!userId,
  });

  const createSessionMutation = useMutation({
    mutationFn: ({ name, branch, workingDirectory, sessionType, agentId }: { 
      name?: string; 
      branch?: string;
      workingDirectory?: string; 
      sessionType?: 'terminal' | 'agent';
      agentId?: string;
    }) =>
      api.createSession(environmentId!, name, branch, workingDirectory, sessionType, agentId),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', environmentId] });
      setBranchConflictError(null);
      navigate(`/terminal/${session.id}?environmentId=${environmentId}`);
    },
    onError: (error: any) => {
      console.error('Failed to create session:', error);
      
      // Handle Docker image not found error
      const errorMessage = error?.message || 'Failed to create session';
      const errorDetails = error?.response?.data?.details || error?.details || '';
      
      if (errorMessage.includes('Environment not ready') || errorDetails.includes('Docker image')) {
        const dockerCommand = errorDetails.match(/docker build[^\n]+/)?.[0] || 
          'docker build -f services/orchestrator/docker/sandbox.Dockerfile -t craftastic-sandbox:latest .';
        
        toast({
          title: "Environment Not Ready",
          description: (
            <div className="space-y-3">
              <p>Docker image not found. Run this command to build it:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-2 py-1 rounded text-xs font-mono">
                  {dockerCommand}
                </code>
                <button
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3"
                  onClick={(e) => {
                    e.preventDefault();
                    navigator.clipboard.writeText(dockerCommand);
                    toast({
                      title: "Copied!",
                      description: "Command copied to clipboard",
                      duration: 2000,
                    });
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          ),
          duration: 30000, // Show for 30 seconds
        });
        return;
      }
      
      // Handle session name conflict
      if (error.code === 'SESSION_NAME_IN_USE' && error.existingSession) {
        toast({
          title: "Session Name Already In Use",
          description: `A session named "${error.existingSession.name}" already exists in this environment.`,
          variant: "destructive",
          duration: 5000,
        });
        return;
      }
      
      // Handle branch conflict
      if (error.code === 'BRANCH_IN_USE' && error.existingSession) {
        setBranchConflictError({
          branch: environment?.branch || 'main',
          existingSession: error.existingSession,
        });
        setShowCreateDialog(false);
      }
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => api.deleteSession(sessionId),
    onMutate: async (sessionId) => {
      // Mark session as being deleted
      setDeletingSessionIds(prev => new Set(prev).add(sessionId));
      
      // Cancel any outgoing refetches to prevent overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: ['sessions', environmentId] });
      
      // Snapshot the previous value
      const previousSessions = queryClient.getQueryData(['sessions', environmentId]);
      
      // Optimistically update by removing the session
      queryClient.setQueryData(['sessions', environmentId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          sessions: old.sessions.filter((s: Session) => s.id !== sessionId)
        };
      });
      
      // Return a context object with the snapshotted value
      return { previousSessions, sessionId };
    },
    onError: (err, sessionId, context) => {
      // Remove from deleting set
      setDeletingSessionIds(prev => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousSessions) {
        queryClient.setQueryData(['sessions', environmentId], context.previousSessions);
      }
      toast({
        title: "Failed to delete session",
        description: err instanceof Error ? err.message : "An error occurred while deleting the session",
        variant: "destructive",
      });
    },
    onSuccess: (_, sessionId) => {
      // Remove from deleting set
      setDeletingSessionIds(prev => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
      
      toast({
        title: "Session deleted",
        description: "The session has been successfully removed",
      });
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['sessions', environmentId] });
      // Force immediate refetch to ensure UI updates
      queryClient.refetchQueries({ queryKey: ['sessions', environmentId] });
    },
  });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const stored = environmentId ? localStorage.getItem(`env:${environmentId}:viewMode`) : null;
    return (stored === 'grid' || stored === 'list') ? (stored as 'grid' | 'list') : 'list';
  });
  const [deletingSessionIds, setDeletingSessionIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'created'>(() => {
    const stored = environmentId ? localStorage.getItem(`env:${environmentId}:sortBy`) : null;
    return (stored === 'recent' || stored === 'name' || stored === 'created') ? (stored as any) : 'recent';
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createDefaults, setCreateDefaults] = useState<{ branch?: string; name?: string }>({});

  useEffect(() => {
    if (!environmentId) return;
    localStorage.setItem(`env:${environmentId}:viewMode`, viewMode);
  }, [environmentId, viewMode]);

  useEffect(() => {
    if (!environmentId) return;
    localStorage.setItem(`env:${environmentId}:sortBy`, sortBy);
  }, [environmentId, sortBy]);

  // Derived sessions list (filter + sort) - must be defined before any early returns
  const sortedSessions = useMemo(() => {
    const base = sessionsData?.sessions || [];
    const filtered = base.filter((s) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (s.name || '').toLowerCase().includes(q) ||
        (s.gitBranch || '').toLowerCase().includes(q) ||
        (s.status || '').toLowerCase().includes(q)
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortBy === 'created') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      const aTime = new Date(a.lastActivity || a.updatedAt || a.createdAt).getTime();
      const bTime = new Date(b.lastActivity || b.updatedAt || b.createdAt).getTime();
      return bTime - aTime;
    });
    return sorted;
  }, [sessionsData?.sessions, searchQuery, sortBy]);

  const handleCreateSession = (data: {
    name?: string;
    branch?: string;
    workingDirectory: string;
    sessionType: 'terminal' | 'agent';
    agentId?: string;
  }) => {
    createSessionMutation.mutate(data);
    setShowCreateDialog(false);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // State for real-time status
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, {
    status: string;
    isChecking: boolean;
    lastChecked?: Date;
  }>>({});

  // Check real-time status for a session
  const checkSessionStatus = async (sessionId: string) => {
    setSessionStatuses(prev => ({
      ...prev,
      [sessionId]: { ...prev[sessionId], isChecking: true }
    }));

    try {
      const result = await api.checkSessionStatus(sessionId);
      setSessionStatuses(prev => ({
        ...prev,
        [sessionId]: {
          status: result.status,
          isChecking: false,
          lastChecked: new Date()
        }
      }));
    } catch (error) {
      console.error('Failed to check session status:', error);
      setSessionStatuses(prev => ({
        ...prev,
        [sessionId]: { ...prev[sessionId], isChecking: false }
      }));
    }
  };

  // Check all sessions on mount and periodically
  useEffect(() => {
    const sessionList = sessionsData?.sessions || [];
    if (sessionList.length > 0) {
      // Initial check
      sessionList.forEach(session => {
        checkSessionStatus(session.id);
      });

      // Periodic check every 30 seconds
      const interval = setInterval(() => {
        sessionList.forEach(session => {
          checkSessionStatus(session.id);
        });
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [sessionsData?.sessions]);

  const getSessionStatus = (session: Session) => {
    const realtimeStatus = sessionStatuses[session.id];
    if (realtimeStatus && !realtimeStatus.isChecking) {
      return realtimeStatus.status;
    }
    return session.status;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500';
      case 'inactive':
        return 'bg-yellow-500';
      case 'dead':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active':
        return 'Running';
      case 'inactive':
        return 'Stopped';
      case 'dead':
        return 'Dead';
      default:
        return 'Unknown';
    }
  };

  const getGitHubWebUrl = (repoUrl?: string) => {
    if (!repoUrl) return undefined;
    try {
      if (repoUrl.startsWith('git@github.com:')) {
        const path = repoUrl.replace('git@github.com:', '').replace(/\.git$/, '');
        return `https://github.com/${path}`;
      }
      if (repoUrl.includes('github.com')) {
        // Normalize to https and strip .git
        const url = new URL(repoUrl.startsWith('http') ? repoUrl : `https://${repoUrl}`);
        url.protocol = 'https:';
        const cleaned = url.toString().replace(/\.git$/, '');
        return cleaned;
      }
    } catch {}
    return repoUrl;
  };

  // Keyboard shortcut: S to create a session
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setCreateDefaults({});
        setShowCreateDialog(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b">
          <div className="h-16 max-w-6xl mx-auto px-2 flex items-center justify-between gap-4">
            <Skeleton className="h-6 w-60" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!environment) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <h2 className="text-xl font-semibold mb-2">Environment not found</h2>
        <Button onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const agents = agentsData?.agents || [];
  
  const getSessionTypeIcon = (sessionType?: string, agentId?: string | null) => {
    if (sessionType === 'agent' && agentId && agents.length > 0) {
      const agent = agents.find((a: any) => a.id === agentId);
      if (agent) {
        switch (agent.type) {
          case 'claude-code': return '🤖';
          case 'gemini-cli': return '💎';
          case 'qwen-coder': return '🧠';
          default: return <Bot className="h-4 w-4" />;
        }
      }
      return <Bot className="h-4 w-4" />;
    }
    return <Terminal className="h-4 w-4" />;
  };
  
  const getSessionTypeBadge = (sessionType?: string, agentId?: string | null) => {
    if (sessionType === 'agent' && agentId && agents.length > 0) {
      const agent = agents.find((a: any) => a.id === agentId);
      return <Badge variant="secondary">{agent?.name || 'Agent'}</Badge>;
    }
    return <Badge variant="outline">Terminal</Badge>;
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Sticky Header with breadcrumb and actions */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="max-w-6xl mx-auto h-16 px-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}> 
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/">Environments</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="truncate max-w-[16rem]">
                  <BreadcrumbLink asChild>
                    <span className="truncate">{environment.name}</span>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex items-center gap-2">
            {environment.repositoryUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={getGitHubWebUrl(environment.repositoryUrl)} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" /> Open Repo
                </a>
              </Button>
            )}
            <Button onClick={() => { setCreateDefaults({}); setShowCreateDialog(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              New Session
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            Environment Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {environment.repositoryUrl && (
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-medium text-muted-foreground">Repository</label>
                <div className="flex items-center gap-2 min-w-0">
                  <a
                    href={getGitHubWebUrl(environment.repositoryUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-sm truncate text-primary hover:underline"
                    title={environment.repositoryUrl}
                  >
                    {getGitHubWebUrl(environment.repositoryUrl)}
                  </a>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => navigator.clipboard.writeText(environment.repositoryUrl!)}
                    title="Copy URL"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    asChild
                    title="Open in GitHub"
                  >
                    <a href={getGitHubWebUrl(environment.repositoryUrl)} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {branchConflictError && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Branch Already In Use</AlertTitle>
          <AlertDescription>
            <p className="mb-2">
              The branch <code className="font-mono">{branchConflictError.branch}</code> is already being used by another session: 
              <strong className="ml-1">
                {branchConflictError.existingSession.name || `Session ${branchConflictError.existingSession.id.substring(0, 8)}`}
              </strong>
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  navigate(`/terminal/${branchConflictError.existingSession.id}?environmentId=${environmentId}`);
                  setBranchConflictError(null);
                }}
              >
                Go to Existing Session
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBranchConflictError(null)}
              >
                Dismiss
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Sessions Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions (name, branch, status)"
              className="pl-8 w-80"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {sortBy === 'name' ? <SortAsc className="h-4 w-4 mr-2" /> : <SortDesc className="h-4 w-4 mr-2" />}
                Sort: {sortBy === 'recent' ? 'Recent activity' : sortBy === 'created' ? 'Created' : 'Name'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setSortBy('recent')}>Recent activity</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('created')}>Created</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy('name')}>Name</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const confirmed = window.confirm(`Delete ${selectedIds.size} selected session(s)?`);
                if (!confirmed) return;
                selectedIds.forEach((id) => deleteSessionMutation.mutate(id));
                setSelectedIds(new Set());
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete selected
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border rounded-lg p-1">
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="h-8 px-3"
            >
              <List className="h-4 w-4 mr-1" />
              List
            </Button>
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('grid')}
              className="h-8 px-3"
            >
              <Grid3X3 className="h-4 w-4 mr-1" />
              Grid
            </Button>
          </div>
          <Button onClick={() => { setCreateDefaults({}); setShowCreateDialog(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            New Session
          </Button>
        </div>
      </div>

      {sortedSessions.length > 0 ? (
        viewMode === 'list' ? (
          <Card>
            <CardContent className="p-0">
              <div className="space-y-0">
                {sortedSessions.map((session, index) => (
                  <div 
                    key={session.id} 
                    className={`relative flex items-center justify-between p-4 hover:bg-accent/50 transition-colors cursor-pointer ${index !== sortedSessions.length - 1 ? 'border-b' : ''} ${deletingSessionIds.has(session.id) ? 'opacity-50' : ''}`}
                    onClick={() => !deletingSessionIds.has(session.id) && navigate(`/terminal/${session.id}?environmentId=${environmentId}`)}
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedIds.has(session.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(session.id)) next.delete(session.id); else next.add(session.id);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${getStatusColor(getSessionStatus(session))}`} />
                        <span className="text-2xl">
                          {getSessionTypeIcon(session.sessionType || 'terminal', session.agentId)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">
                          {session.name || `Session ${session.id.substring(0, 8)}`}
                        </h3>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            <span>tmux: {session.tmuxSessionName}</span>
                          </div>
                          {session.gitBranch && (
                            <div className="flex items-center gap-1">
                              <GitBranch className="h-3 w-3" />
                              <span>{session.gitBranch}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            <Folder className="h-3 w-3" />
                            <span>{session.workingDirectory}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground min-w-[140px] text-right">
                        <div>Last {formatRelative(session.lastActivity || session.updatedAt)}</div>
                        <div className="text-xs">Created {formatDate(session.createdAt)}</div>
                      </div>
                      {getSessionTypeBadge(session.sessionType || 'terminal', session.agentId)}
                    </div>
                    <div className="flex items-center gap-2 ml-4" onClick={(e) => e.stopPropagation()}>
                      <Button
                        onClick={() => navigate(`/terminal/${session.id}?environmentId=${environmentId}`)}
                        size="sm"
                      >
                        <Terminal className="h-4 w-4 mr-2" />
                        Connect
                      </Button>
                      {/* Git button removed per design */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <Settings className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <Play className="mr-2 h-4 w-4" />
                            Start Session
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Square className="mr-2 h-4 w-4" />
                            Stop Session
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => deleteSessionMutation.mutate(session.id)} 
                            className="text-red-600"
                            disabled={deletingSessionIds.has(session.id)}
                          >
                            {deletingSessionIds.has(session.id) ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 h-4 w-4" />
                            )}
                            Delete Session
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedSessions.map((session) => (
            <Card key={session.id} className={`relative ${deletingSessionIds.has(session.id) ? 'opacity-50' : ''}`}>
              {/* Show loading overlay when deleting */}
              {deletingSessionIds.has(session.id) && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10 rounded-lg">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              )}
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selectedIds.has(session.id)}
                    onChange={() => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(session.id)) next.delete(session.id); else next.add(session.id);
                        return next;
                      });
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {getSessionTypeIcon(session.sessionType || 'terminal', session.agentId)}
                  {session.name || `Session ${session.id.substring(0, 8)}`}
                </CardTitle>
                <CardDescription>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs">
                      <span>tmux: {session.tmuxSessionName}</span>
                    </div>
                    {session.gitBranch && (
                      <div className="flex items-center gap-1 text-xs">
                        <GitBranch className="h-3 w-3" />
                        <span>{session.gitBranch}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-xs">
                      <Folder className="h-3 w-3" />
                      <span>{session.workingDirectory}</span>
                    </div>
                  </div>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${getStatusColor(getSessionStatus(session))}`} />
                    <span className="text-sm text-muted-foreground">
                      {getStatusText(getSessionStatus(session))}
                    </span>
                  </div>
                  {getSessionTypeBadge(session.sessionType || 'terminal', session.agentId)}
                </div>
                
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Last {formatRelative(session.lastActivity || session.updatedAt)}
                  </div>
                  <div>Created {formatDate(session.createdAt)}</div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => navigate(`/terminal/${session.id}?environmentId=${environmentId}`)}
                    className="flex-1"
                  >
                    <Terminal className="h-4 w-4 mr-2" />
                    Connect
                  </Button>
                  {/* Git button removed per design */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Settings className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <Play className="mr-2 h-4 w-4" />
                        Start Session
                      </DropdownMenuItem>
                                             <DropdownMenuItem>
                         <Square className="mr-2 h-4 w-4" />
                         Stop Session
                       </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => deleteSessionMutation.mutate(session.id)} 
                        className="text-red-600"
                        disabled={deletingSessionIds.has(session.id)}
                      >
                        {deletingSessionIds.has(session.id) ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Delete Session
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
            ))}
          </div>
        )
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <Terminal className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No sessions yet</h3>
            <p className="text-muted-foreground mb-6">
              Create your first session in this environment
            </p>
            <div className="flex items-center gap-2">
              <Button onClick={() => { setCreateDefaults({}); setShowCreateDialog(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                Create Session
              </Button>
              <Button variant="outline" onClick={() => { setCreateDefaults({ branch: 'feature/', name: 'feature/' }); setShowCreateDialog(true); }}>
                Create feature-branch
              </Button>
            </div>
            <div className="text-xs text-muted-foreground mt-3">Shortcut: Press S to create a session</div>
          </CardContent>
        </Card>
      )}

      <CreateSessionDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreateSession={handleCreateSession}
        agents={agents}
        isCreating={createSessionMutation.isPending}
        environmentId={environmentId!}
        defaultBranch={createDefaults.branch}
        defaultName={createDefaults.name}
      />
    </div>
  );
}

// Utilities
function formatRelative(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / (1000 * 60));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}