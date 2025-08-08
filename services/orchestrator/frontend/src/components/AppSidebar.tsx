import { Link } from "react-router-dom"
import { Folder, Settings, Container, Bot, GitBranch, ChevronRight, ChevronDown, Terminal } from "lucide-react"
import { useState, createContext, useContext, useEffect } from "react"
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client.ts'
import { useAuth } from '../contexts/AuthContext'

import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"

// Create context for sharing create environment dialog state
export const CreateEnvironmentContext = createContext<{
  showCreateDialog: boolean;
  setShowCreateDialog: (show: boolean) => void;
}>({
  showCreateDialog: false,
  setShowCreateDialog: () => {},
});

export const useCreateEnvironment = () => useContext(CreateEnvironmentContext);

export function AppSidebar() {
  const { setShowCreateDialog } = useCreateEnvironment();
  const [expandedEnvs, setExpandedEnvs] = useState<Set<string>>(new Set());
  const { user } = useAuth();
  const userId = user?.id;

  const { data: environmentsData } = useQuery({
    queryKey: ['environments', userId],
    queryFn: () => userId ? api.getUserEnvironments(userId) : Promise.resolve({ environments: [] }),
    enabled: !!userId,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['agents', userId],
    queryFn: () => userId ? api.getUserAgents(userId) : Promise.resolve({ agents: [] }),
    enabled: !!userId,
  });

  const environments = environmentsData?.environments || [];
  const agents = agentsData?.agents || [];

  // Automatically expand all environments by default when they load
  useEffect(() => {
    if (environments.length > 0) {
      const allEnvIds = new Set(environments.map(env => env.id));
      setExpandedEnvs(allEnvIds);
    }
  }, [environments]);

  // Query sessions for expanded environments
  const expandedEnvIds = Array.from(expandedEnvs);
  const sessionQueries = useQuery({
    queryKey: ['sidebar-sessions', expandedEnvIds],
    queryFn: async () => {
      const sessionsByEnv: Record<string, any[]> = {};
      await Promise.all(
        expandedEnvIds.map(async (envId) => {
          try {
            const result = await api.getEnvironmentSessions(envId);
            sessionsByEnv[envId] = result.sessions || [];
          } catch (error) {
            console.error(`Failed to fetch sessions for environment ${envId}:`, error);
            sessionsByEnv[envId] = [];
          }
        })
      );
      return sessionsByEnv;
    },
    enabled: expandedEnvIds.length > 0,
  });

  const sessionsByEnv = sessionQueries.data || {};

  const toggleEnvironment = (envId: string) => {
    setExpandedEnvs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(envId)) {
        newSet.delete(envId);
      } else {
        newSet.add(envId);
      }
      return newSet;
    });
  };

  const getStatusIndicator = (status: string) => {
    switch (status) {
      case 'running':
        return <span className="ml-auto h-2 w-2 rounded-full bg-green-500"></span>;
      case 'starting':
        return <span className="ml-auto h-2 w-2 rounded-full bg-yellow-500"></span>;
      case 'stopped':
        return <span className="ml-auto h-2 w-2 rounded-full bg-gray-400"></span>;
      default:
        return <span className="ml-auto h-2 w-2 rounded-full bg-red-500"></span>;
    }
  };

  const getAgentIcon = (type: string) => {
    switch (type) {
      case 'claude-code':
        return '🤖';
      case 'gemini-cli':
        return '💎';
      case 'qwen-coder':
        return '🧠';
      default:
        return <Bot className="mr-2 h-4 w-4" />;
    }
  };

  const getSessionTypeIcon = (sessionType?: string, agentId?: string | null) => {
    if (sessionType === 'agent' && agentId && agents.length > 0) {
      const agent = agents.find((a: any) => a.id === agentId);
      if (agent) {
        switch (agent.type) {
          case 'claude-code': return '🤖';
          case 'gemini-cli': return '💎';
          case 'qwen-coder': return '🧠';
          default: return <Bot className="h-3 w-3" />;
        }
      }
      return <Bot className="h-3 w-3" />;
    }
    return <Terminal className="h-3 w-3" />;
  };

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Environments</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/">
                    <Folder className="mr-2 h-4 w-4" />
                    <span>Manage Environments</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {environments.map((env) => {
                const isExpanded = expandedEnvs.has(env.id);
                const sessions = sessionsByEnv[env.id] || [];
                
                return (
                  <div key={env.id}>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <div className="flex items-center w-full">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              toggleEnvironment(env.id);
                            }}
                            className="flex items-center justify-center w-5 h-5 mr-1 hover:bg-accent rounded-sm"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </button>
                          <Link to={`/environment/${env.id}`} className="flex items-center flex-1 min-w-0">
                            <Container className="mr-2 h-4 w-4 flex-shrink-0" />
                            <span className="truncate">{env.name}</span>
                            {getStatusIndicator(env.status)}
                          </Link>
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    
                    {isExpanded && sessions.length > 0 && (
                      <div className="ml-6 border-l border-border pl-2 mb-2">
                        {sessions.map((session: any) => (
                          <SidebarMenuItem key={session.id}>
                            <SidebarMenuButton asChild>
                              <Link 
                                to={`/terminal/${session.id}?environmentId=${env.id}`}
                                className="text-sm text-muted-foreground hover:text-foreground"
                              >
                                <span className="mr-2">
                                  {getSessionTypeIcon(session.sessionType || 'terminal', session.agentId)}
                                </span>
                                <span className="truncate">
                                  {session.name || `Session ${session.id.substring(0, 8)}`}
                                </span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Agents</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/agents">
                    <Bot className="mr-2 h-4 w-4" />
                    <span>Manage Agents</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {agents.map((agent) => (
                <SidebarMenuItem key={agent.id}>
                  <SidebarMenuButton asChild>
                    <Link to={`/agents/${agent.id}`}>
                      <span className="mr-2 text-base">{getAgentIcon(agent.type)}</span>
                      <span className="truncate">{agent.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/settings/git">
                    <GitBranch className="mr-2 h-4 w-4" />
                    <span>Git</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
      </SidebarFooter>
    </Sidebar>
  )
}