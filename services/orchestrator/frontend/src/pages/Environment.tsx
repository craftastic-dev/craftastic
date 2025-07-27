import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Terminal, Trash2, ArrowLeft, GitBranch, Folder, Clock, Play, Square, Settings } from 'lucide-react';
import { api } from '../api/client';
import type { Environment as EnvironmentType, Session } from '../api/client';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';

export function Environment() {
  const { environmentId } = useParams<{ environmentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [userId] = useState(() => localStorage.getItem('userId') || `user-${Date.now()}`);

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

  const createSessionMutation = useMutation({
    mutationFn: ({ name, workingDirectory }: { name?: string; workingDirectory?: string }) =>
      api.createSession(environmentId!, name, workingDirectory),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', environmentId] });
      navigate(`/terminal/${session.id}?environmentId=${environmentId}`);
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => api.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', environmentId] });
    },
  });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionWorkingDir, setNewSessionWorkingDir] = useState('/workspace');

  const handleCreateSession = () => {
    createSessionMutation.mutate({
      name: newSessionName.trim() || undefined,
      workingDirectory: newSessionWorkingDir.trim(),
    });
    
    setNewSessionName('');
    setNewSessionWorkingDir('/workspace');
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading environment...</p>
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

  const sessions = sessionsData?.sessions || [];

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Folder className="h-8 w-8" />
            {environment.name}
          </h1>
          <p className="text-muted-foreground">Environment details and terminal sessions</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Environment Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${
                  environment.status === 'running' ? 'bg-green-500' : 
                  environment.status === 'starting' ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="capitalize">{environment.status}</span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Branch</label>
              <p className="font-mono text-sm">{environment.branch}</p>
            </div>
            {environment.repositoryUrl && (
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-muted-foreground">Repository</label>
                <p className="font-mono text-sm truncate">{environment.repositoryUrl}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Terminal Sessions</h2>
          <p className="text-muted-foreground">tmux sessions in this environment</p>
        </div>
        
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Session
        </Button>
      </div>

      {sessions.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((session) => (
            <Card key={session.id} className="relative">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Terminal className="h-5 w-5" />
                  {session.name || `Session ${session.id.substring(0, 8)}`}
                </CardTitle>
                <CardDescription>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs">
                      <span>tmux: {session.tmuxSessionName}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <Folder className="h-3 w-3" />
                      <span>{session.workingDirectory}</span>
                    </div>
                  </div>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getStatusColor(session.status)}`} />
                  <span className="text-sm text-muted-foreground">
                    {getStatusText(session.status)}
                  </span>
                </div>
                
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Created {formatDate(session.createdAt)}
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => navigate(`/terminal/${session.id}?environmentId=${environmentId}`)}
                    className="flex-1"
                  >
                    <Terminal className="h-4 w-4 mr-2" />
                    Connect
                  </Button>
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
                      <DropdownMenuItem onClick={() => deleteSessionMutation.mutate(session.id)} className="text-red-600">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Session
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <Terminal className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No sessions yet</h3>
            <p className="text-muted-foreground mb-6">
              Create your first terminal session in this environment
            </p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Session
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create Session Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Session</DialogTitle>
            <DialogDescription>
              Create a new terminal session in this environment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="session-name" className="text-right">
                Name
              </Label>
              <Input
                id="session-name"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                placeholder="main, feature-branch, etc."
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="working-dir" className="text-right">
                Working Dir
              </Label>
              <Input
                id="working-dir"
                value={newSessionWorkingDir}
                onChange={(e) => setNewSessionWorkingDir(e.target.value)}
                placeholder="/workspace"
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateSession}
              disabled={createSessionMutation.isPending}
            >
              {createSessionMutation.isPending ? 'Creating...' : 'Create Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}