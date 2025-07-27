import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { GitCommit, Upload, FileText, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '../lib/utils';

interface GitPanelProps {
  environmentId: string;
}

export function GitPanel({ environmentId }: GitPanelProps) {
  const [commitMessage, setCommitMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

  const { data: status, refetch } = useQuery({
    queryKey: ['git-status', environmentId],
    queryFn: () => api.gitStatus(environmentId),
    refetchInterval: 5000,
  });

  const commitMutation = useMutation({
    mutationFn: () => api.gitCommit(environmentId, commitMessage, selectedFiles),
    onSuccess: () => {
      setCommitMessage('');
      setSelectedFiles([]);
      refetch();
    },
  });

  const pushMutation = useMutation({
    mutationFn: () => api.gitPush(environmentId),
  });

  const handleFileToggle = (path: string) => {
    setSelectedFiles(prev =>
      prev.includes(path)
        ? prev.filter(p => p !== path)
        : [...prev, path]
    );
  };

  return (
    <div className="w-80 bg-secondary/10 border-l border-border flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Git Status
        </h3>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          className="h-8 w-8"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        {status?.files && status.files.length > 0 ? (
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              {status.files.map(file => (
                <label key={file.path} className="flex items-center gap-3 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedFiles.includes(file.path)}
                    onChange={() => handleFileToggle(file.path)}
                    className="rounded border-border"
                  />
                  <span 
                    className={cn(
                      "font-mono text-xs px-1.5 py-0.5 rounded",
                      file.status === 'M' && "bg-orange-500/20 text-orange-600",
                      file.status === 'A' && "bg-green-500/20 text-green-600", 
                      file.status === 'D' && "bg-red-500/20 text-red-600",
                      file.status === '??' && "bg-gray-500/20 text-gray-500"
                    )}
                  >
                    {file.status}
                  </span>
                  <span className="truncate flex-1">{file.path}</span>
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

            <div className="flex gap-2">
              <Button
                onClick={() => commitMutation.mutate()}
                disabled={!commitMessage || commitMutation.isPending}
                size="sm"
                className="flex-1"
              >
                <GitCommit className="h-4 w-4 mr-2" />
                {commitMutation.isPending ? 'Committing...' : 'Commit'}
              </Button>
              
              <Button
                onClick={() => pushMutation.mutate()}
                disabled={pushMutation.isPending}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                <Upload className="h-4 w-4 mr-2" />
                {pushMutation.isPending ? 'Pushing...' : 'Push'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <FileText className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-muted-foreground text-sm">No changes to commit</p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}