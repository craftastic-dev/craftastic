import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { Code, GitBranch, GitFork, Play, Plus, Power, Settings, X, Grid3X3, List } from "lucide-react"
import { api } from '../api/client';
import type { Environment } from '../api/client';
import { useCreateEnvironment } from '../components/AppSidebar';
import { CreateEnvironmentDialog } from '../components/CreateEnvironmentDialog';

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export function DashboardNew() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [userId] = useState(() => {
    const stored = localStorage.getItem('userId');
    if (!stored) {
      const newUserId = `user-${Date.now()}`;
      localStorage.setItem('userId', newUserId);
      return newUserId;
    }
    return stored;
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['environments', userId],
    queryFn: () => api.getUserEnvironments(userId),
  });

  const createMutation = useMutation({
    mutationFn: ({ name, repositoryUrl }: { name: string; repositoryUrl?: string }) => 
      api.createEnvironment(userId, name, repositoryUrl),
    onSuccess: (environment) => {
      console.log('Environment created successfully:', environment);
      // Invalidate all environment queries for this user
      queryClient.invalidateQueries({ queryKey: ['environments', userId] });
      // Also refetch the data immediately
      refetch();
      navigate(`/environment/${environment.id}`);
    },
    onError: (error) => {
      console.error('Error creating environment:', error);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (environmentId: string) => api.deleteEnvironment(environmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments', userId] });
      refetch();
    },
  });

  const { showCreateDialog, setShowCreateDialog } = useCreateEnvironment();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  const handleCreateEnvironment = (name: string, repositoryUrl?: string) => {
    console.log('Creating environment:', { name, repositoryUrl });
    
    createMutation.mutate({
      name,
      repositoryUrl,
    });
    
    setShowCreateDialog(false);
  };

  const environments = data?.environments || [];

  console.log('DashboardNew render:', { userId, environmentsCount: environments.length, isLoading });

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Environments</h1>
          <p className="text-muted-foreground">Manage your development environments and sessions.</p>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              Filter
            </Button>
            <Button variant="outline" size="sm">
              Sort
            </Button>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Environment
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-8 mt-4">
            <p className="text-muted-foreground">Loading environments...</p>
          </div>
        ) : environments.length > 0 ? (
          viewMode === 'list' ? (
            <div className="rounded-md border mt-4">
              {environments.map((env, index) => (
                <Link
                  key={env.id}
                  to={`/environment/${env.id}`}
                  className={`flex items-center justify-between p-4 hover:bg-accent/50 transition-colors cursor-pointer ${
                    index !== environments.length - 1 ? "border-b" : ""
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <StatusIndicator status={env.status} />
                    <div>
                      <div className="font-medium">
                        {env.name}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <GitFork className="h-3.5 w-3.5" />
                          {env.repositoryUrl ? env.repositoryUrl.split('/').slice(-2).join('/') : `user/${env.name}`}
                        </div>
                        <div className="flex items-center gap-1">
                          <GitBranch className="h-3.5 w-3.5" />
                          {['main', 'develop', 'feature/model-training'][Math.floor(Math.random() * 3)]}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-muted-foreground">
                      Last active: {env.status === 'running' ? '2 hours ago' : env.status === 'starting' ? '5 minutes ago' : '1 day ago'}
                    </div>
                    <div onClick={(e) => e.preventDefault()}>
                      <EnvironmentActions onDelete={() => deleteMutation.mutate(env.id)} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4">
              {environments.map((env) => (
                <EnvironmentCard key={env.id} environment={env} onDelete={deleteMutation.mutate} />
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center mt-4">
            <h3 className="text-lg font-semibold mb-2">No environments yet</h3>
            <p className="text-muted-foreground mb-6">Create your first development environment to get started</p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Environment
            </Button>
          </div>
        )}
      </div>

      {/* Create Environment Dialog */}
      <CreateEnvironmentDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreate={handleCreateEnvironment}
      />
    </div>
  )
}

function EnvironmentCard({ environment, onDelete }: { environment: Environment; onDelete: (id: string) => void }) {
  // Generate a mock last activity time based on environment status
  const getLastActivity = (status: string) => {
    switch (status) {
      case 'running':
        return '2 hours ago';
      case 'starting':
        return '5 minutes ago';
      case 'stopped':
        return '1 day ago';
      default:
        return 'Unknown';
    }
  };

  // Extract repo name from repository URL or use a default
  const getRepoName = (repoUrl?: string) => {
    if (!repoUrl) return 'user/' + environment.name;
    const parts = repoUrl.split('/');
    return parts.slice(-2).join('/');
  };

  // Mock branch name
  const getBranchName = () => {
    const branches = ['main', 'develop', 'feature/model-training'];
    return branches[Math.floor(Math.random() * branches.length)];
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <StatusIndicator status={environment.status} />
            <Link to={`/environment/${environment.id}`} className="hover:underline">
              {environment.name}
            </Link>
          </CardTitle>
          <EnvironmentActions onDelete={() => onDelete(environment.id)} />
        </div>
        <CardDescription>Last active: {getLastActivity(environment.status)}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <GitFork className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{getRepoName(environment.repositoryUrl)}</span>
          </div>
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span>{getBranchName()}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" size="sm" asChild>
          <Link to={`/environment/${environment.id}`}>
            <Code className="mr-2 h-4 w-4" />
            Details
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/environment/${environment.id}`}>Terminal</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

function StatusIndicator({ status }: { status: string }) {
  const statusColors = {
    running: "bg-green-500",
    stopped: "bg-gray-300",
    starting: "bg-yellow-500",
  }

  return (
    <div
      className={`h-2.5 w-2.5 rounded-full ${
        statusColors[status as keyof typeof statusColors] || statusColors.stopped
      }`}
    />
  )
}

function EnvironmentActions({ onDelete }: { onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <Settings className="h-4 w-4" />
          <span className="sr-only">Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>
          <Play className="mr-2 h-4 w-4" />
          Start
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Power className="mr-2 h-4 w-4" />
          Stop
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete} className="text-red-600">
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}