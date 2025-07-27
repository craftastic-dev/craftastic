import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { Code, GitBranch, GitFork, Play, Plus, Power, Settings } from "lucide-react"
import { api } from '../api/client';
import type { Environment } from '../api/client';

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function DashboardNew() {
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

  const environments = data?.environments || [];

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Environments</h1>
          <p className="text-muted-foreground">Manage your development environments and terminal sessions.</p>
        </div>
        <div className="flex items-center gap-4">
          <Select defaultValue="all">
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Current Environment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Environments</SelectItem>
              {environments.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  {env.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild>
            <Link to="/environments/new">
              <Plus className="mr-2 h-4 w-4" />
              Create Environment
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="grid" className="mt-6">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="grid">Grid</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              Filter
            </Button>
            <Button variant="outline" size="sm">
              Sort
            </Button>
          </div>
        </div>

        <TabsContent value="grid" className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <p className="text-muted-foreground">Loading environments...</p>
            </div>
          ) : environments.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {environments.map((env) => (
                <EnvironmentCard key={env.id} environment={env} onDelete={deleteMutation.mutate} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <h3 className="text-lg font-semibold mb-2">No environments yet</h3>
              <p className="text-muted-foreground mb-6">Create your first development environment to get started</p>
              <Button asChild>
                <Link to="/environments/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Environment
                </Link>
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <p className="text-muted-foreground">Loading environments...</p>
            </div>
          ) : environments.length > 0 ? (
            <div className="rounded-md border">
              {environments.map((env, index) => (
                <div
                  key={env.id}
                  className={`flex items-center justify-between p-4 ${
                    index !== environments.length - 1 ? "border-b" : ""
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <StatusIndicator status={env.status} />
                    <div>
                      <Link to={`/environment/${env.id}`} className="font-medium hover:underline">
                        {env.name}
                      </Link>
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
                    <EnvironmentActions onDelete={() => deleteMutation.mutate(env.id)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <h3 className="text-lg font-semibold mb-2">No environments yet</h3>
              <p className="text-muted-foreground mb-6">Create your first development environment to get started</p>
              <Button asChild>
                <Link to="/environments/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Environment
                </Link>
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
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