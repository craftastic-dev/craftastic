import { Link } from "react-router-dom"
import { ChevronDown, Github, User } from "lucide-react"
import { useQuery } from '@tanstack/react-query'
import { useState } from "react"
import { api } from '../api/client'

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function TopNavigation() {
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <span className="ml-2 rounded-full bg-green-500/20 px-1.5 py-0.5 text-xs text-green-600">Running</span>;
      case 'starting':
        return <span className="ml-2 rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-xs text-yellow-600">Starting</span>;
      case 'stopped':
        return <span className="ml-2 rounded-full bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">Stopped</span>;
      default:
        return <span className="ml-2 rounded-full bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">Unknown</span>;
    }
  };

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center gap-4 border-b bg-background px-4 sm:px-6">
      <SidebarTrigger className="shrink-0" />
      <div className="flex items-center gap-2">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Github className="h-5 w-5" />
          <span>Craftastic Orchestrator</span>
        </Link>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <span>Current Environment</span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Switch Environment</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {environments.length > 0 ? (
              environments.map((env) => (
                <DropdownMenuItem key={env.id} asChild>
                  <Link to={`/environment/${env.id}`}>
                    <span>{env.name}</span>
                    {getStatusBadge(env.status)}
                  </Link>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>
                <span>No environments</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarImage src="/placeholder.svg?height=32&width=32" alt="User" />
                <AvatarFallback>
                  <User className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <span className="sr-only">User menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}