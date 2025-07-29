import { Github, Check, X, Loader2, GitBranch, AlertCircle, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGitHub } from '../contexts/GitHubContext';
import { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';

export function GitSettings() {
  const { isConnected, username, isLoading, connect, disconnect, verificationUri, userCode, isPolling } = useGitHub();
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const { toast } = useToast();

  const handleConnect = () => {
    connect();
    setShowAuthDialog(true);
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const handleCopyCode = async () => {
    if (userCode) {
      try {
        await navigator.clipboard.writeText(userCode);
        toast({
          description: "Code copied to clipboard",
        });
      } catch (err) {
        toast({
          variant: "destructive",
          description: "Failed to copy code",
        });
      }
    }
  };

  // Auto-close dialog when connected
  if (isConnected && showAuthDialog) {
    setShowAuthDialog(false);
  }
  

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Git Settings</h1>
        <p className="text-muted-foreground">Manage your Git and GitHub integration settings</p>
      </div>

      <div className="space-y-6">
        {/* GitHub Connection Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              GitHub Connection
            </CardTitle>
            <CardDescription>
              Connect your GitHub account to enable Git operations like push, pull, and commit
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Connection Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${
                    isConnected ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                  }`}>
                    {isConnected ? (
                      <>
                        <Check className="h-4 w-4" />
                        Connected
                      </>
                    ) : (
                      <>
                        <X className="h-4 w-4" />
                        Not Connected
                      </>
                    )}
                  </div>
                  {isConnected && username && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Connected as</span>
                      <span className="ml-2 font-medium">{username}</span>
                    </div>
                  )}
                </div>
                <div>
                  {isLoading ? (
                    <Button disabled size="sm">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </Button>
                  ) : isConnected ? (
                    <Button variant="destructive" size="sm" onClick={handleDisconnect}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" onClick={handleConnect}>
                      Connect GitHub
                    </Button>
                  )}
                </div>
              </div>

              {/* Info Box */}
              {!isConnected && (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
                  <div className="flex gap-3">
                    <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                    <div className="text-sm">
                      <p className="font-medium text-yellow-800 dark:text-yellow-200">GitHub connection required</p>
                      <p className="mt-1 text-yellow-700 dark:text-yellow-300">
                        Connect your GitHub account to enable Git operations in your environments.
                        This allows you to push, pull, and commit changes to your repositories.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Permissions */}
              <div>
                <h4 className="text-sm font-medium mb-2">Permissions</h4>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Check className="h-3 w-3" />
                    <span>Full repository access (read, write, admin)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="h-3 w-3" />
                    <span>Read user profile and email</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="h-3 w-3" />
                    <span>Create and manage pull requests</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Git Configuration Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Git Configuration
            </CardTitle>
            <CardDescription>
              Default Git settings for new environments
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">
                  Git configuration settings will be available in a future update.
                  Currently, all Git operations use your GitHub account credentials.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Auth Dialog */}
      <Dialog open={showAuthDialog && !isConnected && !!userCode} onOpenChange={setShowAuthDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect GitHub Account</DialogTitle>
            <DialogDescription>
              To connect your GitHub account, visit the URL below and enter the code
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Step 1: Go to this URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-3 py-2 text-sm">
                  {verificationUri}
                </code>
                <Button
                  size="sm"
                  onClick={() => window.open(verificationUri || '', '_blank')}
                >
                  Open
                </Button>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-2">Step 2: Enter this code</p>
              <div className="relative">
                <div className="rounded bg-muted px-4 py-3 text-center">
                  <code className="text-2xl font-bold tracking-wider">{userCode}</code>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={handleCopyCode}
                >
                  <Copy className="h-4 w-4" />
                  <span className="sr-only">Copy code</span>
                </Button>
              </div>
            </div>
            {isPolling && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for authorization...
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}