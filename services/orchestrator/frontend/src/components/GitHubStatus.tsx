import { Github, Check, X, Loader2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useGitHub } from '../contexts/GitHubContext';
import { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';

export function GitHubStatus() {
  const { isConnected, username, isLoading, connect, disconnect, verificationUri, userCode } = useGitHub();
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <Github className="h-4 w-4" />
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : isConnected ? (
              <>
                <span className="text-sm">{username}</span>
                <Check className="h-3 w-3 text-green-500" />
              </>
            ) : (
              <>
                <span className="text-sm">GitHub</span>
                <X className="h-3 w-3 text-muted-foreground" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {isConnected ? (
            <>
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">Connected as</p>
                <p className="text-sm text-muted-foreground">{username}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleDisconnect} className="text-red-600">
                Disconnect GitHub
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <div className="px-2 py-1.5">
                <p className="text-sm text-muted-foreground">Not connected</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleConnect}>
                <Github className="mr-2 h-4 w-4" />
                Connect GitHub
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
            {userCode && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for authorization...
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}