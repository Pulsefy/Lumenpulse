import { GrantRound } from './grants';

export interface RoundMilestone {
  id: string;
  title: string;
  description: string;
  state: 'completed' | 'in-progress' | 'upcoming';
}

export function getFundingProgress(fundedAmount: string, totalPool: string): number {
  const funded = Number(fundedAmount || 0);
  const total = Number(totalPool || 0);
  if (!Number.isFinite(funded) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((funded / total) * 100)));
}

export function getRoundMilestones(round: GrantRound, nowSeconds = Math.floor(Date.now() / 1000)):
  RoundMilestone[] {
  const start = round.startTime;
  const end = round.endTime;

  const isActive = nowSeconds >= start && nowSeconds <= end;
  const isEnded = nowSeconds > end;

  return [
    {
      id: 'announced',
      title: 'Round announced',
      description: 'The round is live and contributors can review eligible projects.',
      state: nowSeconds >= start ? 'completed' : 'upcoming',
    },
    {
      id: 'funding',
      title: 'Funding phase',
      description: isActive
        ? 'The matching pool is currently accepting contributions.'
        : isEnded
          ? 'The funding window has closed.'
          : 'The funding window is still pending.',
      state: isActive ? 'in-progress' : isEnded ? 'completed' : 'upcoming',
    },
    {
      id: 'distribution',
      title: 'Distribution',
      description: round.status === 'FINALIZED' || round.status === 'DISTRIBUTED'
        ? 'Matching decisions have been finalized.'
        : 'Results will be published after the round closes.',
      state: round.status === 'FINALIZED' || round.status === 'DISTRIBUTED'
        ? 'completed'
        : isEnded
          ? 'in-progress'
          : 'upcoming',
    },
  ];
}
