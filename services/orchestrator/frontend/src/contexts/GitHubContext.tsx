import React, { createContext, useContext, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.ts';

interface GitHubContextType {
  isConnected: boolean;
  username: string | null;
  isLoading: boolean;
  connect: () => void;
  disconnect: () => void;
  deviceCode: string | null;
  verificationUri: string | null;
  userCode: string | null;
  deviceCodeExpired: boolean;
  enablePolling: () => void;
  disablePolling: () => void;
}

const GitHubContext = createContext<GitHubContextType | undefined>(undefined);

export function GitHubProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [deviceCodeExpired, setDeviceCodeExpired] = useState(false);
  const [pollingCleanup, setPollingCleanup] = useState<(() => void) | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(false);

  // Query GitHub connection status - controlled by polling state
  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['github-status'],
    queryFn: api.getGitHubStatus,
    enabled: deviceCode !== null || pollingEnabled, // Only run during device flow or when explicitly enabled
    refetchInterval: deviceCode ? 2000 : (pollingEnabled ? 10000 : false), // Poll every 2s during device flow, 10s when enabled, never otherwise
    staleTime: 30000, // Consider data fresh for 30 seconds
  });

  // Initiate device flow
  const initiateMutation = useMutation({
    mutationFn: api.initiateGitHubAuth,
    onSuccess: (data) => {
      console.log('[GitHubContext] Device flow initiated successfully:', data);
      
      // Clean up any existing polling
      if (pollingCleanup) {
        pollingCleanup();
      }
      
      setDeviceCode(data.device_code);
      setVerificationUri(data.verification_uri);
      setUserCode(data.user_code);
      setDeviceCodeExpired(false);
      
      console.log('[GitHubContext] Starting simple polling...');
      // Start simple polling with GitHub's recommended interval and store cleanup function
      const cleanup = startPolling(data.device_code, data.interval);
      setPollingCleanup(() => cleanup);
    },
  });

  // Simple polling function with proper interval handling
  const startPolling = (code: string, initialInterval: number = 5) => {
    let pollingActive = true;
    let currentInterval = initialInterval;
    
    const stopPolling = () => {
      pollingActive = false;
      console.log('[GitHubContext] Polling stopped');
    };
    
    const poll = async () => {
      // Check if polling should continue
      if (!pollingActive) {
        console.log('[GitHubContext] Polling stopped - no longer active');
        return;
      }
      
      try {
        console.log(`[GitHubContext] Polling GitHub with device code: ${code.substring(0, 8)}... (interval: ${currentInterval}s)`);
        await api.pollGitHubAuth(code, currentInterval);
        
        // Success! Clear device code and stop polling
        console.log('[GitHubContext] GitHub auth successful! Clearing device code...');
        stopPolling();
        setPollingCleanup(null);
        setDeviceCode(null);
        setVerificationUri(null);
        setUserCode(null);
        setDeviceCodeExpired(false);
        
        // Force status refresh
        queryClient.invalidateQueries({ queryKey: ['github-status'] });
        refetch();
        
      } catch (error: any) {
        if (error.message === 'authorization_pending') {
          console.log(`[GitHubContext] Authorization pending - continuing polling in ${currentInterval}s...`);
          // Continue polling with current interval
          setTimeout(poll, currentInterval * 1000);
        } else if (error.message === 'slow_down') {
          // GitHub wants us to slow down - increase interval significantly
          const newInterval = Math.min(currentInterval * 2, 60); // Double interval, max 60s
          console.log(`[GitHubContext] GitHub rate limiting - slowing down from ${currentInterval}s to ${newInterval}s`);
          currentInterval = newInterval;
          setTimeout(poll, currentInterval * 1000);
        } else if (error.message?.includes('expired')) {
          console.error(`[GitHubContext] Device code expired - stopping polling`);
          // Device code expired - stop polling but keep state for retry option
          stopPolling();
          setPollingCleanup(null);
          setDeviceCodeExpired(true);
          // Keep device code info so user can see what expired and retry
        } else {
          console.error(`[GitHubContext] Fatal polling error: ${error.message}`);
          // Stop polling on other fatal errors
          stopPolling();
          setPollingCleanup(null);
          setDeviceCode(null);
          setVerificationUri(null);
          setUserCode(null);
          setDeviceCodeExpired(false);
        }
      }
    };
    
    // Store stop function for cleanup
    const cleanup = () => stopPolling();
    
    // Start polling after initial interval
    console.log(`[GitHubContext] Starting polling for device code: ${code.substring(0, 8)}... with ${currentInterval}s interval`);
    setTimeout(poll, currentInterval * 1000);
    
    // Return cleanup function
    return cleanup;
  };

  // Disconnect GitHub
  const disconnectMutation = useMutation({
    mutationFn: api.disconnectGitHub,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-status'] });
    },
  });

  // Clean up device code when connected
  useEffect(() => {
    if (status?.connected && deviceCode) {
      console.log('[GitHubContext] Status shows connected, cleaning up polling and device code...');
      if (pollingCleanup) {
        pollingCleanup();
        setPollingCleanup(null);
      }
      setDeviceCode(null);
      setVerificationUri(null);
      setUserCode(null);
    }
  }, [status?.connected, deviceCode, pollingCleanup]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingCleanup) {
        pollingCleanup();
      }
    };
  }, [pollingCleanup]);

  const connect = () => {
    initiateMutation.mutate();
  };

  const disconnect = () => {
    disconnectMutation.mutate();
  };

  const enablePolling = () => {
    setPollingEnabled(true);
  };

  const disablePolling = () => {
    setPollingEnabled(false);
  };

  return (
    <GitHubContext.Provider
      value={{
        isConnected: status?.connected || false,
        username: status?.username || null,
        isLoading,
        connect,
        disconnect,
        deviceCode,
        verificationUri,
        userCode,
        deviceCodeExpired,
        enablePolling,
        disablePolling,
      }}
    >
      {children}
    </GitHubContext.Provider>
  );
}

export function useGitHub() {
  const context = useContext(GitHubContext);
  if (context === undefined) {
    throw new Error('useGitHub must be used within a GitHubProvider');
  }
  return context;
}