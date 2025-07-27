import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Terminal, Trash2, User, GitBranch, Folder, Play, Square } from 'lucide-react';
import { api } from '../api/client';
import type { Environment } from '../api/client';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [userId] = useState(() => localStorage.getItem('userId') || `user-${Date.now()}`);

  const { data, isLoading } = useQuery({
    queryKey: ['environments', userId],
    queryFn: () => api.getUserEnvironments(userId),
  });

  const createMutation = useMutation({
    mutationFn: ({ name, repositoryUrl }: { name: string; repositoryUrl?: string }) => 
      api.createEnvironment(userId, name, repositoryUrl),
    onSuccess: (environment) => {
      queryClient.invalidateQueries({ queryKey: ['environments'] });
      // Navigate to the environment's first session or create one
      navigate(`/environment/${environment.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (environmentId: string) => api.deleteEnvironment(environmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments'] });
    },
  });

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEnvironmentName, setNewEnvironmentName] = useState('');
  const [newEnvironmentRepo, setNewEnvironmentRepo] = useState('');

  const handleCreateEnvironment = () => {
    if (!newEnvironmentName.trim()) return;
    
    createMutation.mutate({
      name: newEnvironmentName.trim(),
      repositoryUrl: newEnvironmentRepo.trim() || undefined,
    });
    
    setNewEnvironmentName('');
    setNewEnvironmentRepo('');
    setShowCreateForm(false);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Craftify Development Environments</h1>
        <p className="text-muted-foreground">Manage your Git repository development environments</p>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5" />
            User Information
          </CardTitle>
          <CardDescription>Your current session details</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-mono bg-muted px-3 py-2 rounded-md inline-block">
            User ID: {userId}
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Your Environments</h2>
          <p className="text-muted-foreground">Git repositories with development containers</p>
        </div>
        
        {!showCreateForm ? (
          <Button 
            onClick={() => setShowCreateForm(true)}
            size="lg"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Environment
          </Button>
        ) : (
          <Card className="w-96">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Create New Environment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Environment Name</label>
                <input
                  type="text"
                  value={newEnvironmentName}
                  onChange={(e) => setNewEnvironmentName(e.target.value)}
                  placeholder="my-project"
                  className="w-full mt-1 px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Git Repository URL (optional)</label>
                <input
                  type="text"
                  value={newEnvironmentRepo}
                  onChange={(e) => setNewEnvironmentRepo(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                  className="w-full mt-1 px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={handleCreateEnvironment}
                  disabled={!newEnvironmentName.trim() || createMutation.isPending}
                  className="flex-1"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewEnvironmentName('');
                    setNewEnvironmentRepo('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      
      {isLoading && (
        <div className="flex items-center justify-center p-8">
          <p className="text-muted-foreground">Loading environments...</p>
        </div>
      )}
      
      {data?.environments && data.environments.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.environments.map((environment) => (
            <Card key={environment.id} className="relative">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Folder className="h-5 w-5" />
                  {environment.name}
                </CardTitle>
                <CardDescription className="space-y-1">
                  {environment.repositoryUrl && (
                    <div className="flex items-center gap-1 text-xs">
                      <GitBranch className="h-3 w-3" />
                      <span className="truncate">{environment.repositoryUrl}</span>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {environment.sessions.length} session{environment.sessions.length !== 1 ? 's' : ''}
                  </div>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${
                    environment.status === 'running' ? 'bg-green-500' : 
                    environment.status === 'starting' ? 'bg-yellow-500' : 'bg-red-500'
                  }`} />
                  <span className="text-sm text-muted-foreground capitalize">
                    {environment.status}
                  </span>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    onClick={() => navigate(`/environment/${environment.id}`)}
                    className="flex-1"
                  >
                    <Terminal className="h-4 w-4 mr-2" />
                    Open Environment
                  </Button>
                  <Button
                    onClick={() => deleteMutation.mutate(environment.id)}
                    disabled={deleteMutation.isPending}
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
      )}
      
      {data?.environments && data.environments.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <Folder className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No environments yet</h3>
            <p className="text-muted-foreground mb-6">Create your first development environment to get started</p>
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Environment
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}