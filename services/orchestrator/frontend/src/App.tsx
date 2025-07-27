import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { Environment } from './pages/Environment';
import { Terminal } from './pages/Terminal';
import './App.css';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/environment/:environmentId" element={<Environment />} />
          <Route path="/terminal/:sessionId" element={<Terminal />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App
