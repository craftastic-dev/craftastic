import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Link } from 'react-router-dom';

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
    workingDirectory: string;
    sessionType: 'terminal' | 'agent';
    agentId?: string;
  }) => void;
  agents: Agent[];
  isCreating: boolean;
}

export function CreateSessionDialog({ 
  open, 
  onOpenChange, 
  onCreateSession, 
  agents,
  isCreating 
}: CreateSessionDialogProps) {
  const [sessionName, setSessionName] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('/workspace');
  const [sessionType, setSessionType] = useState<'terminal' | 'agent'>('terminal');
  const [selectedAgentId, setSelectedAgentId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    onCreateSession({
      name: sessionName.trim() || undefined,
      workingDirectory: workingDirectory.trim(),
      sessionType,
      agentId: sessionType === 'agent' ? selectedAgentId : undefined,
    });

    // Reset form
    setSessionName('');
    setWorkingDirectory('/workspace');
    setSessionType('terminal');
    setSelectedAgentId('');
  };

  const canSubmit = sessionType === 'terminal' || (sessionType === 'agent' && selectedAgentId);

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
              <option value="terminal">🖥️ Terminal Session</option>
              <option value="agent">🤖 Agent Session</option>
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
            <Label htmlFor="session-name">Name (Optional)</Label>
            <Input
              id="session-name"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="main, feature-branch, etc."
            />
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