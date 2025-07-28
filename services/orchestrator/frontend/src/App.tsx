import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useState } from 'react';
import { ThemeProvider } from './components/ThemeProvider';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar, CreateEnvironmentContext } from './components/AppSidebar';
import { TopNavigation } from './components/TopNavigation';
import { DashboardNew } from './pages/DashboardNew';
import { Environment } from './pages/Environment';
import { Terminal } from './pages/Terminal';
import { Agents } from './pages/Agents';
import { Toaster } from './components/ui/toaster';
import './App.css';

const queryClient = new QueryClient();

function App() {
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <CreateEnvironmentContext.Provider value={{ showCreateDialog, setShowCreateDialog }}>
          <BrowserRouter>
            <SidebarProvider>
              <div className="flex h-screen flex-col">
                <TopNavigation />
                <div className="flex flex-1 overflow-hidden">
                  <AppSidebar />
                  <main className="flex-1 overflow-auto">
                    <Routes>
                      <Route path="/" element={<DashboardNew />} />
                      <Route path="/agents" element={<Agents />} />
                      <Route path="/environment/:environmentId" element={<Environment />} />
                      <Route path="/terminal/:sessionId" element={<Terminal />} />
                    </Routes>
                  </main>
                </div>
                <div className="border-t bg-background px-4 py-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-green-500"></span>
                      <span>Connected</span>
                    </div>
                  </div>
                </div>
              </div>
            </SidebarProvider>
            <Toaster />
          </BrowserRouter>
        </CreateEnvironmentContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App