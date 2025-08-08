import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { api } from '../api/client.ts';

interface Agent {
  id: string;
  name: string;
  type: string;
}

interface CreateSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateSession: (data: {
    name?: string;
    branch?: string;
    workingDirectory: string;
    sessionType: 'terminal' | 'agent';
    agentId?: string;
  }) => void;
  agents: Agent[];
  isCreating: boolean;
  environmentId: string;
  defaultBranch?: string;
  defaultName?: string;
}

export function CreateSessionDialog({ 
  open, 
  onOpenChange, 
  onCreateSession, 
  agents,
  isCreating,
  environmentId,
  defaultBranch,
  defaultName,
}: CreateSessionDialogProps) {
  const [sessionName, setSessionName] = useState('');
  const [branch, setBranch] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('/workspace');
  const [sessionType, setSessionType] = useState<'terminal' | 'agent'>('terminal');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  
  // Validation states
  const [nameValidation, setNameValidation] = useState<{
    status: 'idle' | 'checking' | 'available' | 'taken';
    message: string;
  }>({
    status: 'idle',
    message: ''
  });
  
  const [branchValidation, setBranchValidation] = useState<{
    status: 'idle' | 'checking' | 'available' | 'taken';
    message: string;
  }>({
    status: 'idle',
    message: ''
  });

  // Check name availability
  const checkNameAvailability = useCallback(async (nameToCheck: string) => {
    if (!nameToCheck.trim()) {
      setNameValidation({ status: 'idle', message: '' });
      return;
    }

    setNameValidation({ status: 'checking', message: 'Checking availability...' });

    try {
      const result = await api.checkSessionName(environmentId, nameToCheck.trim());
      setNameValidation({
        status: result.available ? 'available' : 'taken',
        message: result.message
      });
    } catch (error) {
      console.error('Error checking name availability:', error);
      setNameValidation({ 
        status: 'idle', 
        message: 'Unable to check name availability'
      });
    }
  }, [environmentId]);

  // Check branch availability
  const checkBranchAvailability = useCallback(async (branchToCheck: string) => {
    if (!branchToCheck.trim()) {
      setBranchValidation({ status: 'idle', message: '' });
      return;
    }

    setBranchValidation({ status: 'checking', message: 'Checking availability...' });

    try {
      const result = await api.checkBranchAvailability(environmentId, branchToCheck.trim());
      setBranchValidation({
        status: result.available ? 'available' : 'taken',
        message: result.message
      });
    } catch (error) {
      console.error('Error checking branch availability:', error);
      setBranchValidation({ 
        status: 'idle', 
        message: 'Unable to check branch availability'
      });
    }
  }, [environmentId]);

  // Debounce name checking
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkNameAvailability(sessionName);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [sessionName, checkNameAvailability]);

  // Debounce branch checking
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkBranchAvailability(branch);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [branch, checkBranchAvailability]);

  // Reset or initialize state when dialog opens/closes
  useEffect(() => {
    if (open) {
      // Prefill defaults when opening
      if (defaultBranch !== undefined) {
        setBranch(defaultBranch);
        if (!sessionName) {
          setSessionName(defaultBranch);
        }
      }
      if (defaultName !== undefined) {
        setSessionName(defaultName);
      }
    } else {
      setSessionName('');
      setBranch('');
      setWorkingDirectory('/workspace');
      setSessionType('terminal');
      setSelectedAgentId('');
      setNameValidation({ status: 'idle', message: '' });
      setBranchValidation({ status: 'idle', message: '' });
    }
  }, [open, defaultBranch, defaultName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (nameValidation.status === 'taken' || branchValidation.status === 'taken') {
      return;
    }
    
    onCreateSession({
      name: sessionName.trim() || undefined,
      branch: branch.trim() || undefined,
      workingDirectory: workingDirectory.trim(),
      sessionType,
      agentId: sessionType === 'agent' ? selectedAgentId : undefined,
    });

    // Reset form
    setSessionName('');
    setBranch('');
    setWorkingDirectory('/workspace');
    setSessionType('terminal');
    setSelectedAgentId('');
  };

  const canSubmit = (sessionType === 'terminal' || (sessionType === 'agent' && selectedAgentId)) && 
                    nameValidation.status !== 'taken' && 
                    branchValidation.status !== 'taken';
                    
  const getValidationIcon = (validation: { status: string }) => {
    switch (validation.status) {
      case 'checking':
        return <Clock className="h-4 w-4 text-muted-foreground animate-spin" />;
      case 'available':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'taken':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Session</DialogTitle>
          <DialogDescription>
            Create a new terminal or agent session in this environment.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="session-type">Session Type</Label>
            <select 
              id="session-type"
              value={sessionType} 
              onChange={(e) => setSessionType(e.target.value as 'terminal' | 'agent')}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="terminal">🖥️ Terminal</option>
              <option value="agent">🤖 Agent</option>
            </select>
          </div>

          {sessionType === 'agent' && (
            <div className="space-y-2">
              <Label htmlFor="agent-select">Select Agent</Label>
              {agents.length > 0 ? (
                <select 
                  id="agent-select"
                  value={selectedAgentId} 
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Choose an agent...</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.type === 'claude-code' ? '🤖' : 
                       agent.type === 'gemini-cli' ? '💎' : '🧠'} {agent.name} ({agent.type})
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No agents available. <Link to="/agents" className="text-primary underline">Create one first</Link>.
                </p>
              )}
            </div>
          )}

          <hr className="border-t" />

          <div className="space-y-2">
            <Label htmlFor="branch">Branch/Worktree</Label>
            <div className="relative">
              <Input
                id="branch"
                value={branch}
                onChange={(e) => {
                  const newBranch = e.target.value;
                  setBranch(newBranch);
                  // Auto-fill session name with branch name if user hasn't manually edited it
                  // or if the current session name matches the previous branch value
                  if (!sessionName || sessionName === branch) {
                    setSessionName(newBranch);
                  }
                }}
                placeholder="main, feature-branch, bugfix-123..."
                required
                className={branchValidation.status === 'taken' ? 'border-destructive pr-10' : 'pr-10'}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                {getValidationIcon(branchValidation)}
              </div>
            </div>
            {branchValidation.message && branchValidation.status !== 'idle' && (
              <p className={`text-xs ${branchValidation.status === 'taken' ? 'text-destructive' : 'text-muted-foreground'}`}>
                {branchValidation.message}
              </p>
            )}
            {!branchValidation.message && (
              <p className="text-xs text-muted-foreground">
                Enter the branch name to work on. If it doesn't exist, it will be created from the default branch.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="session-name">Session Name (Optional)</Label>
            <div className="relative">
              <Input
                id="session-name"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="Defaults to branch name"
                className={nameValidation.status === 'taken' ? 'border-destructive pr-10' : 'pr-10'}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                {getValidationIcon(nameValidation)}
              </div>
            </div>
            {nameValidation.message && nameValidation.status !== 'idle' && (
              <p className={`text-xs ${nameValidation.status === 'taken' ? 'text-destructive' : 'text-muted-foreground'}`}>
                {nameValidation.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="working-dir">Working Directory</Label>
            <Input
              id="working-dir"
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              placeholder="/workspace"
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              type="submit"
              disabled={isCreating || !canSubmit}
            >
              {isCreating ? 'Creating...' : 'Create Session'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}