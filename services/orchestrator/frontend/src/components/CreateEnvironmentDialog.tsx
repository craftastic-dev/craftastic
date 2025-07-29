import { useState, useEffect } from 'react';
import { Search, Loader2, Github, GitBranch, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useGitHub } from '../contexts/GitHubContext';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface CreateEnvironmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, repositoryUrl?: string) => void;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  clone_url: string;
  private: boolean;
  updated_at: string;
  language: string;
}

export function CreateEnvironmentDialog({ open, onOpenChange, onCreate }: CreateEnvironmentDialogProps) {
  const { isConnected } = useGitHub();
  const [name, setName] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('manual');

  // Fetch GitHub repos if connected
  const { data: reposData, isLoading: reposLoading } = useQuery({
    queryKey: ['github-repos'],
    queryFn: () => api.listGitHubRepos({ per_page: 100 }),
    enabled: isConnected && open && activeTab === 'github',
  });

  // Filter repos based on search
  const filteredRepos = reposData?.repositories.filter(repo => 
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.description?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setName('');
      setRepositoryUrl('');
      setSelectedRepo(null);
      setSearchQuery('');
      setActiveTab('manual');
    }
  }, [open]);

  // Auto-fill name from selected repo
  useEffect(() => {
    if (selectedRepo && !name) {
      setName(selectedRepo.name);
    }
  }, [selectedRepo, name]);

  const handleCreate = () => {
    if (!name.trim()) return;
    
    const repoUrl = selectedRepo ? selectedRepo.clone_url : repositoryUrl.trim() || undefined;
    onCreate(name.trim(), repoUrl);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Create New Environment</DialogTitle>
          <DialogDescription>
            Create a new development environment with optional Git repository
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">Manual Entry</TabsTrigger>
            <TabsTrigger value="github" disabled={!isConnected}>
              <Github className="mr-2 h-4 w-4" />
              GitHub Repos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="name">Environment Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-project"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repository">Repository URL (optional)</Label>
              <Input
                id="repository"
                value={repositoryUrl}
                onChange={(e) => setRepositoryUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
              />
            </div>
          </TabsContent>

          <TabsContent value="github" className="mt-4">
            {!isConnected ? (
              <div className="text-center py-8 text-muted-foreground">
                Connect your GitHub account to select from your repositories
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Search Repositories</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search your repositories..."
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Select Repository</Label>
                  {reposLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <ScrollArea className="h-[200px] rounded-md border">
                      <div className="p-2 space-y-1">
                        {filteredRepos.length === 0 ? (
                          <div className="text-center py-4 text-sm text-muted-foreground">
                            No repositories found
                          </div>
                        ) : (
                          filteredRepos.map((repo) => (
                            <button
                              key={repo.id}
                              onClick={() => setSelectedRepo(repo)}
                              className={`w-full text-left p-3 rounded-md hover:bg-accent transition-colors ${
                                selectedRepo?.id === repo.id ? 'bg-accent' : ''
                              }`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium truncate">{repo.name}</div>
                                  {repo.description && (
                                    <div className="text-sm text-muted-foreground truncate">
                                      {repo.description}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                    {repo.language && <span>{repo.language}</span>}
                                    <span>{repo.private ? 'Private' : 'Public'}</span>
                                    <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
                                  </div>
                                </div>
                                <a
                                  href={repo.html_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-2 p-1 hover:bg-background rounded"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  )}
                </div>

                {selectedRepo && (
                  <div className="space-y-2">
                    <Label htmlFor="env-name">Environment Name</Label>
                    <Input
                      id="env-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={selectedRepo.name}
                    />
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim()}>
            Create Environment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}