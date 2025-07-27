import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeProvider';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './components/AppSidebar';
import { TopNavigation } from './components/TopNavigation';
import { DashboardNew } from './pages/DashboardNew';
import { Environment } from './pages/Environment';
import { Terminal } from './pages/Terminal';
import './App.css';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <BrowserRouter>
          <SidebarProvider>
            <div className="flex min-h-screen flex-col">
              <TopNavigation />
              <div className="flex flex-1">
                <AppSidebar />
                <main className="flex-1">
                  <Routes>
                    <Route path="/" element={<DashboardNew />} />
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
                  <div className="h-4 w-px bg-border"></div>
                  <div>No active session</div>
                </div>
              </div>
            </div>
          </SidebarProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App