import { Link } from "react-router-dom"
import { Folder, Terminal, Settings, GitBranch, Container } from "lucide-react"
import { useState, createContext, useContext } from "react"
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

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

  const [userId] = useState(() => {
    const stored = localStorage.getItem('userId');
    if (!stored) {
      const newUserId = `user-${Date.now()}`;
      localStorage.setItem('userId', newUserId);
      return newUserId;
    }
    return stored;
  });

  const { data: environmentsData } = useQuery({
    queryKey: ['environments', userId],
    queryFn: () => api.getUserEnvironments(userId),
  });

  const environments = environmentsData?.environments || [];

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
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {environments.map((env) => (
                <SidebarMenuItem key={env.id}>
                  <SidebarMenuButton asChild>
                    <Link to={`/environment/${env.id}`}>
                      <Container className="mr-2 h-4 w-4" />
                      <span className="truncate">{env.name}</span>
                      {getStatusIndicator(env.status)}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Development</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/terminal">
                    <Terminal className="mr-2 h-4 w-4" />
                    <span>Terminal</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/git">
                    <GitBranch className="mr-2 h-4 w-4" />
                    <span>Git</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
      </SidebarFooter>
    </Sidebar>
  )
}