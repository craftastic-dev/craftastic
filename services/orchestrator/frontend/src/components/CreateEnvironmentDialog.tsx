import { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, Github, GitBranch, ExternalLink, Star, GitFork, Lock, Globe, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useGitHub } from '../contexts/GitHubContext';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.ts';
import { useAuth } from '../contexts/AuthContext';

interface CreateEnvironmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, repositoryUrl?: string) => void;
  dockerImageError?: string | null;
  onClearError?: () => void;
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
  stargazers_count: number;
  open_issues_count: number;
}

// Language color mapping for badges
const getLanguageColor = (language: string | null): string => {
  const colors: Record<string, string> = {
    TypeScript: 'bg-blue-500',
    JavaScript: 'bg-yellow-500',
    Python: 'bg-green-500',
    Java: 'bg-red-500',
    Go: 'bg-cyan-500',
    Rust: 'bg-orange-500',
    'C++': 'bg-pink-500',
    C: 'bg-gray-500', 
    PHP: 'bg-purple-500',
    Ruby: 'bg-red-600',
    Swift: 'bg-orange-600',
    Kotlin: 'bg-purple-600',
  };
  return language ? colors[language] || 'bg-gray-400' : 'bg-gray-400';
};

// Format numbers with k/m suffixes
const formatCount = (count: number): string => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}m`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
};

// Repository loading skeleton component
const RepoSkeleton = () => (
  <Card className="p-4">
    <CardContent className="p-0 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-8" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-4 w-24" />
      </div>
    </CardContent>
  </Card>
);

export function CreateEnvironmentDialog({ open, onOpenChange, onCreate, dockerImageError, onClearError }: CreateEnvironmentDialogProps) {
  const { isConnected } = useGitHub();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  
  // Name validation state
  const [nameValidation, setNameValidation] = useState<{
    status: 'idle' | 'checking' | 'available' | 'taken';
    message: string;
    suggestions: string[];
  }>({
    status: 'idle',
    message: '',
    suggestions: []
  });
  
  console.log('CreateEnvironmentDialog - dockerImageError:', dockerImageError);
  
  // Add effect to track dockerImageError changes
  useEffect(() => {
    console.log('dockerImageError changed to:', dockerImageError);
  }, [dockerImageError]);

  // Debounced name validation
  const checkNameAvailability = useCallback(async (nameToCheck: string) => {
    if (!nameToCheck.trim() || !user?.id) {
      setNameValidation({ status: 'idle', message: '', suggestions: [] });
      return;
    }

    setNameValidation({ status: 'checking', message: 'Checking availability...', suggestions: [] });

    try {
      const result = await api.checkEnvironmentName(user.id, nameToCheck.trim());
      setNameValidation({
        status: result.available ? 'available' : 'taken',
        message: result.message,
        suggestions: result.suggestions
      });
    } catch (error) {
      console.error('Error checking name availability:', error);
      setNameValidation({ 
        status: 'idle', 
        message: 'Unable to check name availability', 
        suggestions: [] 
      });
    }
  }, [user?.id]);

  // Debounce name checking
  useEffect(() => {
    if (!name.trim()) {
      setNameValidation({ status: 'idle', message: '', suggestions: [] });
      return;
    }

    const timeoutId = setTimeout(() => {
      checkNameAvailability(name);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [name, checkNameAvailability]);

  // Fetch GitHub repos if connected
  const { data: reposData, isLoading: reposLoading } = useQuery({
    queryKey: ['github-repos'],
    queryFn: () => api.listGitHubRepos({ per_page: 100 }),
    enabled: isConnected && open,
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
      setSelectedRepo(null);
      setSearchQuery('');
      setNameValidation({ status: 'idle', message: '', suggestions: [] });
    }
  }, [open]);

  // Auto-fill name from selected repo
  useEffect(() => {
    if (selectedRepo && !name) {
      setName(selectedRepo.name);
    }
  }, [selectedRepo, name]);

  const handleCreate = () => {
    if (!name.trim() || nameValidation.status === 'taken') return;
    
    const repoUrl = selectedRepo?.clone_url;
    onCreate(name.trim(), repoUrl);
  };

  const getValidationIcon = () => {
    switch (nameValidation.status) {
      case 'checking':
        return <Clock className="h-4 w-4 text-muted-foreground animate-spin" />;
      case 'available':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'taken':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getValidationColor = () => {
    switch (nameValidation.status) {
      case 'available':
        return 'text-green-600';
      case 'taken':
        return 'text-red-600';
      case 'checking':
        return 'text-muted-foreground';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <div className="relative">
          <DialogHeader>
            <DialogTitle>Create New Environment</DialogTitle>
            <DialogDescription>
              Create a new development environment with optional Git repository
            </DialogDescription>
          </DialogHeader>

        {!isConnected ? (
          <Card className="mt-6">
            <CardContent className="p-8 text-center">
              <Github className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Connect GitHub Account</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                To create environments from your repositories, please connect your GitHub account first.
              </p>
              <Button 
                onClick={() => window.open('/settings/git', '_blank')}
                className="mb-2"
              >
                <Github className="mr-2 h-4 w-4" />
                Connect GitHub
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                This will open the Git settings page in a new tab
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4 mt-6">
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

            <div className="space-y-3">
              <Label>Select Repository</Label>
              {reposLoading ? (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <RepoSkeleton key={i} />
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {filteredRepos.length === 0 ? (
                      <Card className="p-8">
                        <CardContent className="p-0 text-center">
                          <Github className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                          <div className="text-sm text-muted-foreground">
                            {searchQuery ? 'No repositories match your search' : 'No repositories found'}
                          </div>
                          {searchQuery && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Try adjusting your search terms
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ) : (
                      filteredRepos.map((repo) => (
                        <Card
                          key={repo.id}
                          className={`cursor-pointer transition-all duration-200 hover:shadow-md border-2 ${
                            selectedRepo?.id === repo.id 
                              ? 'border-primary bg-accent/50' 
                              : 'border-border hover:border-accent-foreground/20'
                          }`}
                          onClick={() => setSelectedRepo(repo)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0 space-y-2">
                                {/* Repository name and privacy indicator */}
                                <div className="flex items-center gap-2">
                                  <h3 className="font-semibold text-base truncate">{repo.name}</h3>
                                  {repo.private ? (
                                    <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                                  ) : (
                                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                                  )}
                                </div>
                                
                                {/* Description */}
                                {repo.description && (
                                  <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                                    {repo.description}
                                  </p>
                                )}
                                
                                {/* Metadata row */}
                                <div className="flex items-center gap-4">
                                  {/* Language badge */}
                                  {repo.language && (
                                    <Badge 
                                      variant="secondary" 
                                      className={`text-white ${getLanguageColor(repo.language)}`}
                                    >
                                      {repo.language}
                                    </Badge>
                                  )}
                                  
                                  {/* Stats */}
                                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    {(repo.stargazers_count ?? 0) > 0 && (
                                      <div className="flex items-center gap-1">
                                        <Star className="h-3 w-3" />
                                        <span>{formatCount(repo.stargazers_count!)}</span>
                                      </div>
                                    )}
                                    {(repo.open_issues_count ?? 0) > 0 && (
                                      <div className="flex items-center gap-1">
                                        <GitBranch className="h-3 w-3" />
                                        <span>{formatCount(repo.open_issues_count!)} issues</span>
                                      </div>
                                    )}
                                    <span className="text-xs">
                                      Updated {new Date(repo.updated_at).toLocaleDateString()}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              
                              {/* External link button */}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0 h-8 w-8 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(repo.html_url, '_blank', 'noopener,noreferrer');
                                }}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>

            {selectedRepo && (
              <div className="space-y-2">
                <Label htmlFor="env-name">Environment Name</Label>
                <div className="relative">
                  <Input
                    id="env-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={selectedRepo.name}
                    className={`pr-10 ${nameValidation.status === 'taken' ? 'border-red-500 focus-visible:ring-red-500' : 
                      nameValidation.status === 'available' ? 'border-green-500 focus-visible:ring-green-500' : ''}`}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {getValidationIcon()}
                  </div>
                </div>
                
                {/* Validation message */}
                {nameValidation.message && (
                  <p className={`text-sm ${getValidationColor()}`}>
                    {nameValidation.message}
                  </p>
                )}
                
                {/* Suggestions for taken names */}
                {nameValidation.status === 'taken' && nameValidation.suggestions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Try these alternatives:</p>
                    <div className="flex flex-wrap gap-1">
                      {nameValidation.suggestions.map((suggestion, index) => (
                        <Button
                          key={index}
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setName(suggestion)}
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Docker Image Error Overlay */}
        {dockerImageError && (
            <div className="absolute inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center p-4 z-50 rounded-lg">
              <Card className="max-w-3xl w-full shadow-xl border-2 border-orange-200 dark:border-orange-800">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                    <span className="text-xl">🐳</span>
                    Docker Build Required
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <p className="text-base text-muted-foreground">
                      The Docker image for development environments is missing. Please build it using the command below:
                    </p>
                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <pre className="text-sm font-mono leading-relaxed select-text cursor-text whitespace-pre-wrap break-all" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
                            <code style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>{dockerImageError}</code>
                          </pre>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 ml-2"
                          onClick={() => {
                            navigator.clipboard.writeText(dockerImageError);
                            setIsCopied(true);
                            setTimeout(() => setIsCopied(false), 2000);
                          }}
                        >
                          {isCopied ? '✓ Copied' : 'Copy'}
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>💡 Tip:</strong> After running this command, try creating your environment again.
                    </p>
                  </div>
                  
                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={() => onClearError?.()}
                      variant="default"
                      size="lg"
                    >
                      Got it
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreate} 
            disabled={
              !isConnected || 
              !selectedRepo || 
              !name.trim() || 
              nameValidation.status === 'taken' ||
              nameValidation.status === 'checking'
            }
          >
            Create Environment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}