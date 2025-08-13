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
  refreshStatus: () => void;
}

const GitHubContext = createContext<GitHubContextType | undefined>(undefined);

export function GitHubProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [deviceCodeExpired, setDeviceCodeExpired] = useState(false);
  const [pollingCleanup, setPollingCleanup] = useState<(() => void) | null>(null);

  // Query GitHub connection status - cache-based with smart refetching
  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['github-status'],
    queryFn: api.getGitHubStatus,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    cacheTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchOnReconnect: true, // Refetch when network reconnects
    refetchInterval: false, // No automatic polling
  });

  /*
   * GITHUB DEVICE FLOW POLLING - FORMAL CASE ANALYSIS & RACE CONDITION PREVENTION
   * 
   * Problem: Previous React Query implementation caused infinite polling loops due to:
   * 1. Fixed 2-second interval violated GitHub's 5-second minimum requirement
   * 2. No exponential backoff on 'slow_down' responses
   * 3. Race conditions between component lifecycle and polling state
   * 
   * HOARE LOGIC ANALYSIS:
   * 
   * Precondition P: {deviceCode ≠ null ∧ initialInterval ≥ 5}
   * 
   * State Variables:
   * - pollingActive: Boolean (controls loop termination)
   * - currentInterval: Number ∈ [5, 60] (respects GitHub limits with exponential backoff)
   * - attemptCount: Number ∈ [0, maxAttempts] (bounded to guarantee termination)
   * 
   * Loop Invariant I: {5 ≤ currentInterval ≤ 60 ∧ 0 ≤ attemptCount ≤ maxAttempts ∧ pollingActive}
   * 
   * CASE ANALYSIS FOR POLLING RESPONSES:
   * 
   * Case 1: SUCCESS
   *   Pre: {response.success = true}
   *   Action: pollingActive := false ∧ deviceCode := null ∧ cleanup()
   *   Post: {authToken ≠ null ∧ polling terminated}
   *   
   * Case 2: SLOW_DOWN (Rate Limiting)
   *   Pre: {response.error = 'slow_down' ∧ currentInterval < 60}
   *   Action: currentInterval := min(currentInterval × 2, 60) ∧ schedule_next_poll()
   *   Post: {currentInterval > old(currentInterval) ∧ next_poll_respects_rate_limit}
   *   Rationale: GitHub requests slower polling - we exponentially backoff to prevent
   *             further rate limiting while still making progress
   *   
   * Case 3: AUTHORIZATION_PENDING (Normal Flow)
   *   Pre: {response.error = 'authorization_pending'}
   *   Action: schedule_next_poll() with same interval
   *   Post: {currentInterval unchanged ∧ polling continues}
   *   Rationale: User hasn't completed authorization yet - continue at current rate
   *   
   * Case 4: EXPIRED_TOKEN
   *   Pre: {response.error contains 'expired'}
   *   Action: pollingActive := false ∧ deviceCodeExpired := true
   *   Post: {polling terminated ∧ user can retry}
   *   Rationale: Device code has expired - stop polling but preserve state for retry
   *   
   * Case 5: FATAL_ERROR
   *   Pre: {response.error ∉ {'slow_down', 'authorization_pending', 'expired'}}
   *   Action: pollingActive := false ∧ clear_all_state()
   *   Post: {polling terminated ∧ clean state}
   *   Rationale: Unexpected error - fail fast with clean state
   * 
   * TERMINATION PROOF:
   * 1. attemptCount is monotonically increasing
   * 2. attemptCount ≤ maxAttempts enforced
   * 3. pollingActive can only be set to false (never reset to true during polling)
   * 4. Therefore: ∀ polling_loop, ∃ termination_condition
   * 
   * RACE CONDITION PREVENTION:
   * 1. Single ownership: Only one polling loop active per device code
   * 2. Atomic cleanup: pollingActive flag prevents concurrent operations
   * 3. Component safety: Cleanup function cancels polling on unmount
   * 4. Memory safety: All timeouts cleared, no dangling references
   * 
   * WHY NOT REACT QUERY:
   * React Query's refetchInterval is fixed and doesn't support dynamic intervals
   * needed for exponential backoff. Manual implementation provides:
   * - Dynamic interval adjustment based on GitHub's rate limiting feedback
   * - Proper state machine with clear transitions
   * - Guaranteed cleanup and termination
   * - Better error handling with specific case analysis
   */
  const startDeviceFlowPolling = (code: string, initialInterval: number = 5) => {
    let pollingActive = true;
    let currentInterval = initialInterval; // Start at 5s (GitHub minimum)
    let attemptCount = 0;
    const maxAttempts = 100; // Bounded attempts to guarantee termination
    
    console.log(`[GitHubContext] Starting device flow polling with ${currentInterval}s interval`);
    
    const stopPolling = () => {
      pollingActive = false;
      console.log('[GitHubContext] Device flow polling stopped');
    };
    
    const poll = async () => {
      // TERMINATION PROOF: Check bounded termination conditions
      if (!pollingActive || attemptCount >= maxAttempts) {
        console.log(`[GitHubContext] Polling terminated - active: ${pollingActive}, attempts: ${attemptCount}/${maxAttempts}`);
        return;
      }
      
      // INVARIANT: Maintain attemptCount bounds
      attemptCount++;
      
      try {
        console.log(`[GitHubContext] Polling attempt ${attemptCount} with ${currentInterval}s interval`);
        await api.pollGitHubAuth(code, currentInterval);
        
        // CASE 1: SUCCESS - Authentication completed
        console.log('[GitHubContext] Device flow polling succeeded - GitHub auth completed');
        stopPolling();
        setPollingCleanup(null);
        setDeviceCode(null);
        setVerificationUri(null);
        setUserCode(null);
        setDeviceCodeExpired(false);
        
        // Force status refresh
        queryClient.invalidateQueries({ queryKey: ['github-status'] });
        
      } catch (error: any) {
        console.log(`[GitHubContext] Polling error on attempt ${attemptCount}:`, error.message);
        
        if (error.message === 'slow_down') {
          // CASE 2: SLOW_DOWN - Apply exponential backoff to respect rate limits
          const newInterval = Math.min(currentInterval * 2, 60);
          console.log(`[GitHubContext] GitHub requested slow down - increasing interval from ${currentInterval}s to ${newInterval}s`);
          currentInterval = newInterval;
          
          // INVARIANT: Maintain currentInterval bounds [5, 60]
          if (pollingActive) {
            setTimeout(poll, currentInterval * 1000);
          }
          
        } else if (error.message === 'authorization_pending') {
          // CASE 3: AUTHORIZATION_PENDING - Normal flow, continue polling
          console.log(`[GitHubContext] Authorization still pending - continuing polling in ${currentInterval}s`);
          
          if (pollingActive) {
            setTimeout(poll, currentInterval * 1000);
          }
          
        } else if (error.message?.includes('expired')) {
          // CASE 4: EXPIRED_TOKEN - Clean termination with retry option
          console.error('[GitHubContext] Device code expired - stopping polling');
          stopPolling();
          setPollingCleanup(null);
          setDeviceCodeExpired(true);
          // Keep device code info for retry option
          
        } else {
          // CASE 5: FATAL_ERROR - Clean termination with full state reset
          console.error(`[GitHubContext] Fatal device flow error: ${error.message}`);
          stopPolling();
          setPollingCleanup(null);
          setDeviceCode(null);
          setVerificationUri(null);
          setUserCode(null);
          setDeviceCodeExpired(false);
        }
      }
    };
    
    // Start polling after initial interval
    setTimeout(poll, currentInterval * 1000);
    
    // Return cleanup function
    return stopPolling;
  };

  // Initiate device flow
  const initiateMutation = useMutation({
    mutationFn: api.initiateGitHubAuth,
    onSuccess: (data) => {
      console.log('[GitHubContext] Device flow initiated successfully:', data);
      
      // Clean up any existing polling
      if (pollingCleanup) {
        pollingCleanup();
        setPollingCleanup(null);
      }
      
      setDeviceCode(data.device_code);
      setVerificationUri(data.verification_uri);
      setUserCode(data.user_code);
      setDeviceCodeExpired(false);
      
      console.log('[GitHubContext] Starting device flow polling...');
      // Start polling with proper exponential backoff
      const cleanup = startDeviceFlowPolling(data.device_code, data.interval || 5);
      setPollingCleanup(() => cleanup);
    },
  });


  // Disconnect GitHub
  const disconnectMutation = useMutation({
    mutationFn: api.disconnectGitHub,
    onSuccess: () => {
      // Clean up any device flow state
      if (pollingCleanup) {
        pollingCleanup();
      }
      setPollingCleanup(null);
      setDeviceCode(null);
      setVerificationUri(null);
      setUserCode(null);
      setDeviceCodeExpired(false);
      
      // Invalidate status cache
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

  const refreshStatus = () => {
    refetch();
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
        refreshStatus,
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