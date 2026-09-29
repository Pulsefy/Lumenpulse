import { getFundingProgress, getRoundMilestones } from '../grant-detail-utils';

describe('grant detail utilities', () => {
  it('computes funding progress from funded pool versus total pool', () => {
    expect(getFundingProgress('500000', '1000000')).toBe(50);
    expect(getFundingProgress('0', '1000000')).toBe(0);
    expect(getFundingProgress('1000000', '0')).toBe(0);
  });

  it('derives milestone states from round status and timeline', () => {
    const milestones = getRoundMilestones({
      id: 1,
      name: 'Spring Round',
      tokenAddress: 'test',
      startTime: 1_700_000_000,
      endTime: 1_700_000_600,
      totalPool: '1000000',
      isFinalized: false,
      isDistributed: false,
      status: 'ACTIVE',
    }, 1_700_000_300);

    expect(milestones[0].title).toBe('Round announced');
    expect(milestones[0].state).toBe('completed');
    expect(milestones[1].state).toBe('in-progress');
    expect(milestones[2].state).toBe('upcoming');
  });
});
