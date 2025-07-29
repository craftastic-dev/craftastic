import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Github, ExternalLink, Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';
import { api } from '../api/client';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';

interface GitHubAuthProps {
  onAuthChange?: (connected: boolean, username?: string) => void;
}

export function GitHubAuth({ onAuthChange }: GitHubAuthProps) {
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: githubStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['github-status'],
    queryFn: () => api.getGitHubStatus(),
    retry: false,
  });

  const initiateMutation = useMutation({
    mutationFn: () => api.initiateGitHubAuth(),
    onSuccess: (data) => {
      setDeviceCode(data.device_code);
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
      setError(null);
      
      // Start polling
      setPolling(true);
      pollForAuth(data.device_code, data.interval);
    },
    onError: (error) => {
      setError(error.message);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.disconnectGitHub(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-status'] });
      setDeviceCode(null);
      setUserCode(null);
      setVerificationUri(null);
      setPolling(false);
      setError(null);
      onAuthChange?.(false);
    },
    onError: (error) => {
      setError(error.message);
    },
  });

  const pollForAuth = async (deviceCode: string, interval: number) => {
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setPolling(false);
        setError('Authentication timeout. Please try again.');
        return;
      }

      try {
        await api.pollGitHubAuth(deviceCode, interval);
        
        // Authentication successful
        setPolling(false);
        setDeviceCode(null);
        setUserCode(null);
        setVerificationUri(null);
        setError(null);
        
        // Refresh status
        await refetchStatus();
        onAuthChange?.(true);
        
      } catch (error) {
        if (error.message.includes('authorization_pending') || error.message.includes('slow_down')) {
          // Continue polling
          attempts++;
          setTimeout(poll, interval * 1000);
        } else {
          setPolling(false);
          setError(error.message);
        }
      }
    };

    setTimeout(poll, interval * 1000);
  };

  const handleCancelAuth = () => {
    setPolling(false);
    setDeviceCode(null);
    setUserCode(null);
    setVerificationUri(null);
    setError(null);
  };

  const openGitHub = () => {
    if (verificationUri) {
      window.open(verificationUri, '_blank');
    }
  };

  useEffect(() => {
    if (githubStatus) {
      onAuthChange?.(githubStatus.connected, githubStatus.username);
    }
  }, [githubStatus, onAuthChange]);

  if (githubStatus?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Github className="h-4 w-4" />
            GitHub Connected
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                @{githubStatus.username}
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Disconnect'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Github className="h-4 w-4" />
          GitHub Authentication
        </CardTitle>
        <CardDescription>
          Connect your GitHub account to push changes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!polling && !userCode && (
          <Button
            onClick={() => initiateMutation.mutate()}
            disabled={initiateMutation.isPending}
            className="w-full"
          >
            {initiateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Initiating...
              </>
            ) : (
              <>
                <Github className="h-4 w-4 mr-2" />
                Connect GitHub
              </>
            )}
          </Button>
        )}

        {userCode && (
          <div className="space-y-4">
            <Alert>
              <Github className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p>Go to GitHub and enter this code:</p>
                  <div className="flex items-center justify-between bg-muted p-2 rounded font-mono text-sm">
                    <span className="font-bold text-lg">{userCode}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(userCode)}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <Button onClick={openGitHub} className="flex-1">
                <ExternalLink className="h-4 w-4 mr-2" />
                Open GitHub
              </Button>
              <Button variant="outline" onClick={handleCancelAuth}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>

            {polling && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for authorization...
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}