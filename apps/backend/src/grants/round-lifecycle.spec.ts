import { BadRequestException } from '@nestjs/common';
import {
  assertGrantRoundState,
  canTransitionGrantRound,
  GrantRoundState,
  transitionGrantRound,
} from './round-lifecycle';

describe('grant round lifecycle', () => {
  it.each([
    [GrantRoundState.DRAFT, GrantRoundState.OPEN],
    [GrantRoundState.OPEN, GrantRoundState.MATCHING],
    [GrantRoundState.MATCHING, GrantRoundState.CLOSED],
    [GrantRoundState.CLOSED, GrantRoundState.DISBURSED],
  ])('allows %s -> %s', (current, next) => {
    expect(canTransitionGrantRound(current, next)).toBe(true);
    expect(transitionGrantRound(current, next)).toBe(next);
  });

  it.each([
    [GrantRoundState.DRAFT, GrantRoundState.MATCHING],
    [GrantRoundState.OPEN, GrantRoundState.CLOSED],
    [GrantRoundState.MATCHING, GrantRoundState.DISBURSED],
    [GrantRoundState.CLOSED, GrantRoundState.OPEN],
    [GrantRoundState.DISBURSED, GrantRoundState.DISBURSED],
  ])('rejects %s -> %s', (current, next) => {
    expect(canTransitionGrantRound(current, next)).toBe(false);
    expect(() => transitionGrantRound(current, next)).toThrow(
      new BadRequestException('Invalid grant round state transition'),
    );
  });

  it('uses the same error for invalid transition guards', () => {
    expect(() =>
      assertGrantRoundState(GrantRoundState.CLOSED, [GrantRoundState.OPEN]),
    ).toThrow(new BadRequestException('Invalid grant round state transition'));
  });
});
