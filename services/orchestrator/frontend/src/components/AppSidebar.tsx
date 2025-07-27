import { Link } from "react-router-dom"
import { ChevronRight, Code, GitBranch, GitFork, Home, Plus, Terminal } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

// This will be replaced with dynamic data from the API
const environments: any[] = []

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-between px-2">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Terminal className="h-5 w-5" />
            <span>Environments</span>
          </Link>
          <Button variant="ghost" size="icon" asChild>
            <Link to="/environments/new">
              <Plus className="h-4 w-4" />
              <span className="sr-only">New Environment</span>
            </Link>
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/">
                    <Home className="h-4 w-4" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Environments</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {environments.map((env) => (
                <SidebarMenuItem key={env.id}>
                  <Collapsible className="w-full">
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton>
                        <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                        <Code className="h-4 w-4" />
                        <span>{env.name}</span>
                        <StatusBadge status={env.status} />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <Link to={`/environment/${env.id}`}>
                              <span>Environment Details</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <Link to={`/environment/${env.id}`}>
                              <span>Terminal</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton>
                            <GitBranch className="h-3.5 w-3.5" />
                            <span>{env.branch}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton>
                            <GitFork className="h-3.5 w-3.5" />
                            <span>{env.repo}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="p-2">
          <Button className="w-full" asChild>
            <Link to="/environments/new">
              <Plus className="mr-2 h-4 w-4" />
              New Environment
            </Link>
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function StatusBadge({ status }: { status: string }) {
  const statusMap = {
    running: { color: "bg-green-500", text: "text-green-600" },
    stopped: { color: "bg-gray-200", text: "text-gray-600" },
    starting: { color: "bg-yellow-500", text: "text-yellow-600" },
  }

  const style = statusMap[status as keyof typeof statusMap] || statusMap.stopped

  return (
    <Badge variant="outline" className={`ml-auto ${style.color}/20 ${style.text} border-0`}>
      {status}
    </Badge>
  )
}