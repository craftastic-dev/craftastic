import React, { useState } from 'react';
import { Plus, Settings, Trash2, Eye, EyeOff } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Separator } from './ui/separator';
import { api, Agent, AgentCredential } from '../api/client.ts';
import { toast } from './ui/use-toast';
import { InlineTerminal } from './InlineTerminal';

interface AgentListProps {
  userId: string;
}

export function AgentList({ userId }: AgentListProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showCredential, setShowCredential] = useState<Record<string, boolean>>({});
  const [setupAgent, setSetupAgent] = useState<Agent | null>(null);
  const [setupEnvId, setSetupEnvId] = useState<string>('');
  const [setupSessionId, setSetupSessionId] = useState<string>('');
  const [detectedToken, setDetectedToken] = useState<string>('');
  const queryClient = useQueryClient();

  // Fetch user agents
  const { data: agentsData, isLoading } = useQuery({
    queryKey: ['agents', userId],
    queryFn: () => api.getUserAgents(userId),
  });

  // Create agent mutation
  const createAgentMutation = useMutation({
    mutationFn: (data: { name: string; type: 'claude-code' | 'gemini-cli' | 'qwen-coder' | 'cursor-cli'; credential?: AgentCredential }) =>
      api.createAgent(userId, data.name, data.type, data.credential),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', userId] });
      setCreateDialogOpen(false);
      toast({ title: 'Agent created successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to create agent', description: error.message, variant: 'destructive' });
    },
  });

  // Update agent mutation
  const updateAgentMutation = useMutation({
    mutationFn: ({ agentId, updates }: { agentId: string; updates: { name?: string; credential?: AgentCredential } }) =>
      api.updateAgent(agentId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', userId] });
      setEditingAgent(null);
      toast({ title: 'Agent updated successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update agent', description: error.message, variant: 'destructive' });
    },
  });

  // Delete agent mutation
  const deleteAgentMutation = useMutation({
    mutationFn: (agentId: string) => api.deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', userId] });
      toast({ title: 'Agent deleted successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to delete agent', description: error.message, variant: 'destructive' });
    },
  });

  // We don't need to fetch credentials for editing since we'll ask user to enter new ones

  const agents = agentsData?.agents || [];
  const { data: envs } = useQuery({
    queryKey: ['user-envs', userId],
    queryFn: () => api.getUserEnvironments(userId),
  });

  const handleCreateAgent = (formData: FormData) => {
    const name = formData.get('name') as string;
    const type = formData.get('type') as 'claude-code' | 'gemini-cli' | 'qwen-coder' | 'cursor-cli';
    const credentialType = formData.get('credentialType') as string;
    const credentialValue = formData.get('credentialValue') as string;

    const credential = credentialType && credentialValue ? 
      { type: credentialType, value: credentialValue } : undefined;

    createAgentMutation.mutate({ name, type, credential });
  };

  const handleUpdateAgent = (formData: FormData) => {
    if (!editingAgent) return;

    const name = formData.get('name') as string;
    const credentialType = formData.get('credentialType') as string;
    const credentialValue = formData.get('credentialValue') as string;

    const updates: { name?: string; credential?: AgentCredential } = {};
    
    if (name !== editingAgent.name) {
      updates.name = name;
    }
    
    if (credentialType && credentialValue) {
      updates.credential = { type: credentialType, value: credentialValue };
    }

    if (Object.keys(updates).length > 0) {
      updateAgentMutation.mutate({ agentId: editingAgent.id, updates });
    } else {
      setEditingAgent(null);
    }
  };

  const getAgentTypeIcon = (type: string) => {
    switch (type) {
      case 'claude-code': return '🤖';
      case 'gemini-cli': return '💎';
      case 'qwen-coder': return '🧠';
      case 'cursor-cli': return '🖱️';
      default: return '🔧';
    }
  };

  const getCredentialTypeBadge = (type: string | null) => {
    if (!type) return <Badge variant="outline">No Credential</Badge>;
    
    switch (type) {
      case 'anthropic_api_key': return <Badge>API Key</Badge>;
      case 'oauth': return <Badge variant="secondary">OAuth</Badge>;
      case 'gemini_api_key': return <Badge>Gemini Key</Badge>;
      default: return <Badge variant="outline">{type}</Badge>;
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading agents...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-muted-foreground">
            Manage your AI coding agents and their credentials
          </p>
        </div>
        
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Agent
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
               <DialogTitle>Create New Agent</DialogTitle>
               <DialogDescription>
                 Add a new AI coding agent and set up authentication.
               </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget as HTMLFormElement;
                const formData = new FormData(form);
                const name = formData.get('name') as string;
                const type = formData.get('type') as 'claude-code' | 'gemini-cli' | 'qwen-coder' | 'cursor-cli';
                const credentialType = formData.get('credentialType') as string;
                const credentialValue = formData.get('credentialValue') as string;
                const envId = formData.get('setupEnv') as string | null;
                try {
                  const created = await api.createAgent(userId, name, type, credentialType && credentialValue ? { type: credentialType, value: credentialValue } : undefined);
                  // If type is claude-code and an environment is chosen, immediately launch inline setup
                  if (type === 'claude-code' && envId) {
                    setCreateDialogOpen(false);
                    setSetupAgent(created as any);
                    setSetupEnvId(envId);
                    const { sessionId } = await api.startAgentSetup((created as any).id, envId);
                    setSetupSessionId(sessionId);
                  } else {
                    queryClient.invalidateQueries({ queryKey: ['agents', userId] });
                    setCreateDialogOpen(false);
                  }
                } catch (err: any) {
                  toast({ title: 'Failed to create agent', description: err.message, variant: 'destructive' });
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="name">Agent Name</Label>
                <Input 
                  id="name" 
                  name="name" 
                  placeholder="Claude Code Main" 
                  required 
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="type">Agent Type</Label>
                <Select name="type" required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select agent type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-code">🤖 Claude Code</SelectItem>
                    <SelectItem value="gemini-cli">💎 Gemini CLI</SelectItem>
                    <SelectItem value="qwen-coder">🧠 Qwen Coder</SelectItem>
                    <SelectItem value="cursor-cli">🖱️ Cursor CLI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Optional immediate setup environment for Claude */}
              <div className="space-y-2">
                <Label htmlFor="setupEnv">Setup Environment (Claude only)</Label>
                <Select name="setupEnv">
                  <SelectTrigger>
                    <SelectValue placeholder="Skip setup for now" />
                  </SelectTrigger>
                  <SelectContent>
                    {(envs?.environments || []).map((e: any) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="credentialType">Credential Type (Optional)</Label>
                <Select name="credentialType">
                  <SelectTrigger>
                    <SelectValue placeholder="Select credential type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic_api_key">Anthropic API Key</SelectItem>
                    <SelectItem value="gemini_api_key">Gemini API Key</SelectItem>
                    <SelectItem value="oauth">OAuth Token</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="credentialValue">Credential Value</Label>
                <Textarea 
                  id="credentialValue"
                  name="credentialValue"
                  placeholder="Enter API key or OAuth JSON..."
                  className="min-h-[100px]"
                />
              </div>

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createAgentMutation.isPending}>
                  {createAgentMutation.isPending ? 'Creating...' : 'Create Agent'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {agents.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-4xl mb-4">🤖</div>
            <h3 className="text-lg font-semibold mb-2">No agents yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first AI coding agent to get started
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Agent
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent: any) => (
            <Card key={agent.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-2xl">{getAgentTypeIcon(agent.type)}</span>
                    <div>
                      <CardTitle className="text-base">{agent.name}</CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        {agent.type}
                        {agent.credential_type ? (
                          <Badge variant="secondary">Configured</Badge>
                        ) : (
                          <Badge variant="outline">Not configured</Badge>
                        )}
                      </CardDescription>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-1">
                    {!agent.credential_type && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setSetupAgent(agent); setSetupEnvId(''); setSetupSessionId(''); }}
                      >
                        Setup
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingAgent(agent)}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteAgentMutation.mutate(agent.id)}
                      disabled={deleteAgentMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  {getCredentialTypeBadge(agent.credential_type)}
                  
                  {agent.credential_type && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => 
                        setShowCredential(prev => ({
                          ...prev,
                          [agent.id]: !prev[agent.id]
                        }))
                      }
                    >
                      {showCredential[agent.id] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
                
                <div className="text-xs text-muted-foreground mt-2">
                  Created {new Date(agent.created_at).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Setup Panel */}
      <Dialog open={!!setupAgent} onOpenChange={() => { setSetupAgent(null); setSetupSessionId(''); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Setup {setupAgent?.name}</DialogTitle>
            <DialogDescription>Authenticate the agent without leaving this page.</DialogDescription>
          </DialogHeader>

          {!setupSessionId ? (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!setupAgent || !setupEnvId) return;
                try {
                  const { sessionId } = await api.startAgentSetup(setupAgent.id, setupEnvId);
                  setSetupSessionId(sessionId);
                } catch (err: any) {
                  toast({ title: 'Failed to start setup', description: err.message, variant: 'destructive' });
                }
              }}
            >
              <div className="space-y-2">
                <Label>Select Environment</Label>
                <Select value={setupEnvId} onValueChange={setSetupEnvId} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {(envs?.environments || []).map((e: any) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={!setupEnvId}>Start Setup</Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Complete the login in the terminal below. We’ll auto-finish if we detect a token.</p>
              <InlineTerminal
                sessionId={setupSessionId}
                environmentId={setupEnvId}
                height={420}
                onTokenDetected={(t) => setDetectedToken(t)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => { setSetupAgent(null); setSetupSessionId(''); }}
                >
                  Close
                </Button>
                <Button
                  onClick={async () => {
                    if (!setupAgent) return;
                    try {
                      await api.ingestAgentCredentials(setupAgent.id, detectedToken || undefined);
                      toast({ title: 'Agent configured' });
                      setSetupAgent(null);
                      setSetupSessionId('');
                      setDetectedToken('');
                      queryClient.invalidateQueries({ queryKey: ['agents', userId] });
                    } catch (err: any) {
                      toast({ title: 'Finalize failed', description: err.message, variant: 'destructive' });
                    }
                  }}
                >
                  Finalize
                </Button>
                {detectedToken && (
                  <span className="text-xs text-green-600 self-center">Token detected</span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Agent Dialog */}
      <Dialog open={!!editingAgent} onOpenChange={() => setEditingAgent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Agent</DialogTitle>
            <DialogDescription>
              Update agent details and credentials
            </DialogDescription>
          </DialogHeader>
          
          {editingAgent && (
            <form action={handleUpdateAgent} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Agent Name</Label>
                <Input 
                  id="edit-name"
                  name="name" 
                  defaultValue={editingAgent.name}
                  required 
                />
              </div>
              
              <div className="space-y-2">
                <Label>Agent Type</Label>
                <div className="flex items-center space-x-2">
                  <span className="text-xl">{getAgentTypeIcon(editingAgent.type)}</span>
                  <span className="font-medium">{editingAgent.type}</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="edit-credentialType">Credential Type</Label>
                <Select name="credentialType">
                  <SelectTrigger>
                    <SelectValue placeholder="Select credential type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic_api_key">Anthropic API Key</SelectItem>
                    <SelectItem value="gemini_api_key">Gemini API Key</SelectItem>
                    <SelectItem value="oauth">OAuth Token</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-credentialValue">New Credential Value</Label>
                <Textarea 
                  id="edit-credentialValue"
                  name="credentialValue"
                  placeholder="Enter new credential value..."
                  className="min-h-[100px]"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to keep existing credential unchanged
                </p>
              </div>

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setEditingAgent(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateAgentMutation.isPending}>
                  {updateAgentMutation.isPending ? 'Updating...' : 'Update Agent'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}