import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Terminal, Trash2, ArrowLeft, GitBranch, Folder, Clock } from 'lucide-react';
import { api } from '../api/client';
import type { Environment as EnvironmentType, Session } from '../api/client';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

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

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionWorkingDir, setNewSessionWorkingDir] = useState('/workspace');

  const handleCreateSession = () => {
    createSessionMutation.mutate({
      name: newSessionName.trim() || undefined,
      workingDirectory: newSessionWorkingDir.trim(),
    });
    
    setNewSessionName('');
    setNewSessionWorkingDir('/workspace');
    setShowCreateForm(false);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
        
        {!showCreateForm ? (
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Session
          </Button>
        ) : (
          <Card className="w-80">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Create New Session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Session Name (optional)</label>
                <input
                  type="text"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="main, feature-branch, etc."
                  className="w-full mt-1 px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Working Directory</label>
                <input
                  type="text"
                  value={newSessionWorkingDir}
                  onChange={(e) => setNewSessionWorkingDir(e.target.value)}
                  placeholder="/workspace"
                  className="w-full mt-1 px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={handleCreateSession}
                  disabled={createSessionMutation.isPending}
                  className="flex-1"
                >
                  {createSessionMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewSessionName('');
                    setNewSessionWorkingDir('/workspace');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
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
                  <div className={`h-2 w-2 rounded-full ${
                    session.status === 'active' ? 'bg-green-500' : 
                    session.status === 'inactive' ? 'bg-yellow-500' : 'bg-red-500'
                  }`} />
                  <span className="text-sm text-muted-foreground capitalize">
                    {session.status}
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
                  <Button
                    onClick={() => deleteSessionMutation.mutate(session.id)}
                    disabled={deleteSessionMutation.isPending}
                    variant="destructive"
                    size="icon"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
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
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Session
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}