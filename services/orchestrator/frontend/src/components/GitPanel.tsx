import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitCommit, Upload, FileText, RefreshCw, GitBranch, History, AlertCircle, Github, CheckCircle, X } from 'lucide-react';
import { api } from '../api/client';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { GitHubAuth } from './GitHubAuth';
import { cn } from '../lib/utils';

interface GitPanelProps {
  sessionId: string;
  environmentId: string;
}

export function GitPanel({ sessionId, environmentId }: GitPanelProps) {
  const [commitMessage, setCommitMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [githubConnected, setGitHubConnected] = useState(false);
  const [githubUsername, setGitHubUsername] = useState<string>();
  const queryClient = useQueryClient();

  const { data: status, refetch: refetchStatus, error: statusError } = useQuery({
    queryKey: ['git-status', sessionId],
    queryFn: () => api.gitStatus(sessionId),
    refetchInterval: 5000,
    retry: false,
  });

  const { data: commits } = useQuery({
    queryKey: ['git-log', sessionId],
    queryFn: () => api.gitLog(sessionId, 10),
    enabled: !!status && !statusError,
    retry: false,
  });

  const { data: repoInfo } = useQuery({
    queryKey: ['repo-info', environmentId],
    queryFn: () => api.getRepositoryInfo(environmentId),
    retry: false,
  });

  const commitMutation = useMutation({
    mutationFn: () => {
      const filesToCommit = selectedFiles.length > 0 ? selectedFiles.map(f => f.replace(/^[AMDR\?\s]+\s*/, '')) : undefined;
      return api.gitCommit(sessionId, commitMessage, filesToCommit);
    },
    onSuccess: () => {
      setCommitMessage('');
      setSelectedFiles([]);
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ['git-log', sessionId] });
    },
  });

  const pushMutation = useMutation({
    mutationFn: () => api.gitPush(sessionId),
    onSuccess: () => {
      refetchStatus();
    },
  });

  const handleFileToggle = (filename: string) => {
    setSelectedFiles(prev =>
      prev.includes(filename)
        ? prev.filter(f => f !== filename)
        : [...prev, filename]
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status.trim()) {
      case 'M': return <span className="text-orange-600">M</span>;
      case 'A': return <span className="text-green-600">A</span>;
      case 'D': return <span className="text-red-600">D</span>;
      case 'R': return <span className="text-blue-600">R</span>;
      case '??': return <span className="text-gray-500">?</span>;
      default: return <span className="text-gray-500">{status}</span>;
    }
  };

  const formatCommitDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = (now.getTime() - date.getTime()) / (1000 * 60);
    
    if (diffInMinutes < 60) {
      return `${Math.floor(diffInMinutes)}m ago`;
    } else if (diffInMinutes < 1440) {
      return `${Math.floor(diffInMinutes / 60)}h ago`;
    } else {
      return `${Math.floor(diffInMinutes / 1440)}d ago`;
    }
  };

  // Check if session has git worktree (no error means it has one)
  const hasGitWorktree = !statusError || !statusError.message?.includes('no git worktree');

  if (!hasGitWorktree) {
    return (
      <div className="w-80 bg-secondary/10 border-l border-border flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Git Panel
          </h3>
        </div>
        <div className="flex flex-col items-center justify-center p-8 text-center flex-1">
          <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-muted-foreground text-sm">No Git repository</p>
          <p className="text-muted-foreground text-xs mt-1">
            This session doesn't have a git worktree
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-80 bg-secondary/10 border-l border-border flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Git Panel
        </h3>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetchStatus()}
          className="h-8 w-8"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      
      <Tabs defaultValue="status" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="status" className="flex-1 text-xs">Status</TabsTrigger>
          <TabsTrigger value="history" className="flex-1 text-xs">History</TabsTrigger>
          <TabsTrigger value="auth" className="flex-1 text-xs">Auth</TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="flex-1 mt-0">
          <ScrollArea className="flex-1">
            {statusError ? (
              <div className="p-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {statusError.message}
                  </AlertDescription>
                </Alert>
              </div>
            ) : status ? (
              <div className="p-4 space-y-4">
                {/* Branch info */}
                <div className="flex items-center gap-2 text-sm">
                  <GitBranch className="h-4 w-4" />
                  <span className="font-mono">{status.branch}</span>
                  {status.ahead > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      +{status.ahead}
                    </Badge>
                  )}
                  {status.behind > 0 && (
                    <Badge variant="outline" className="text-xs">
                      -{status.behind}
                    </Badge>
                  )}
                </div>

                {status.files && status.files.length > 0 ? (
                  <>
                    <div className="space-y-2">
                      {status.files.map((file, index) => (
                        <label key={`${file.filename}-${index}`} className="flex items-center gap-3 text-sm cursor-pointer hover:bg-accent/50 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={selectedFiles.includes(file.filename)}
                            onChange={() => handleFileToggle(file.filename)}
                            className="rounded border-border"
                          />
                          <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">
                            {getStatusIcon(file.status)}
                          </span>
                          <span className="truncate flex-1 text-xs font-mono">{file.filename}</span>
                        </label>
                      ))}
                    </div>

                    <textarea
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="Commit message..."
                      rows={3}
                      className="w-full p-2 text-sm bg-background border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    />

                    <div className="space-y-2">
                      <Button
                        onClick={() => commitMutation.mutate()}
                        disabled={!commitMessage || commitMutation.isPending || !githubConnected}
                        size="sm"
                        className="w-full"
                      >
                        <GitCommit className="h-4 w-4 mr-2" />
                        {commitMutation.isPending ? 'Committing...' : 'Commit'}
                      </Button>
                      
                      <Button
                        onClick={() => pushMutation.mutate()}
                        disabled={pushMutation.isPending || !githubConnected}
                        variant="outline"
                        size="sm"
                        className="w-full"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        {pushMutation.isPending ? 'Pushing...' : 'Push'}
                      </Button>

                      {!githubConnected && (
                        <Alert>
                          <Github className="h-4 w-4" />
                          <AlertDescription className="text-xs">
                            Connect GitHub to commit and push changes
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>

                    {(commitMutation.error || pushMutation.error) && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                          {commitMutation.error?.message || pushMutation.error?.message}
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
                    <p className="text-muted-foreground text-sm">Working tree clean</p>
                    <p className="text-muted-foreground text-xs mt-1">No changes to commit</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center p-8">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="history" className="flex-1 mt-0">
          <ScrollArea className="flex-1">
            {commits?.commits && commits.commits.length > 0 ? (
              <div className="p-4 space-y-3">
                {commits.commits.map((commit) => (
                  <div key={commit.hash} className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {commit.hash.substring(0, 7)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatCommitDate(commit.date)}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{commit.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {commit.author}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <History className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">No commit history</p>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="auth" className="flex-1 mt-0">
          <div className="p-4">
            <GitHubAuth 
              onAuthChange={(connected, username) => {
                setGitHubConnected(connected);
                setGitHubUsername(username);
              }} 
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}