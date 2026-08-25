import test from 'node:test';
import assert from 'node:assert/strict';
import { getFundingProgress, getRoundMilestones } from '../grant-detail-utils';

test('computes funding progress from funded pool versus total pool', () => {
  assert.equal(getFundingProgress('500000', '1000000'), 50);
  assert.equal(getFundingProgress('0', '1000000'), 0);
  assert.equal(getFundingProgress('1000000', '0'), 0);
});

test('derives milestone states from round status and timeline', () => {
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

  assert.equal(milestones[0].title, 'Round announced');
  assert.equal(milestones[0].state, 'completed');
  assert.equal(milestones[1].state, 'in-progress');
  assert.equal(milestones[2].state, 'upcoming');
});
