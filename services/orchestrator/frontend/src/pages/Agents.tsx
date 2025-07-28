import React, { useState } from 'react';
import { AgentList } from '../components/AgentList';

export function Agents() {
  // Get userId from localStorage (same pattern as AppSidebar)
  const [userId] = useState(() => {
    const stored = localStorage.getItem('userId');
    if (!stored) {
      const newUserId = `user-${Date.now()}`;
      localStorage.setItem('userId', newUserId);
      return newUserId;
    }
    return stored;
  });

  return <AgentList userId={userId} />;
}