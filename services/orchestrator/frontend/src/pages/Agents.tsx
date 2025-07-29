import React from 'react';
import { AgentList } from '../components/AgentList';
import { useAuth } from '../contexts/AuthContext';

export function Agents() {
  const { user } = useAuth();
  const userId = user?.id;

  if (!userId) {
    return <div>Please log in to view agents.</div>;
  }

  return <AgentList userId={userId} />;
}