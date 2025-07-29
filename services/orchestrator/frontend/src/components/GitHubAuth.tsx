import { useEffect } from 'react';
import { Github, ExternalLink, Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';
import { useGitHub } from '../contexts/GitHubContext';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';

interface GitHubAuthProps {
  onAuthChange?: (connected: boolean, username?: string) => void;
}

export function GitHubAuth({ onAuthChange }: GitHubAuthProps) {
  const {
    isConnected,
    username,
    isLoading,
    connect,
    disconnect,
    deviceCode,
    verificationUri,
    userCode,
    deviceCodeExpired
  } = useGitHub();

  const handleCancelAuth = () => {
    // Context will handle cleanup when deviceCode is cleared
    // For now, we could add a cancel method to the context if needed
  };

  const openGitHub = () => {
    if (verificationUri) {
      window.open(verificationUri, '_blank');
    }
  };

  useEffect(() => {
    onAuthChange?.(isConnected, username);
  }, [isConnected, username, onAuthChange]);

  if (isConnected) {
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
                @{username}
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={disconnect}
              disabled={isLoading}
            >
              {isLoading ? (
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
        {deviceCodeExpired && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Device code has expired. Please try again.</AlertDescription>
          </Alert>
        )}

        {!deviceCode && !userCode && (
          <Button
            onClick={connect}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? (
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

            {deviceCode && (
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