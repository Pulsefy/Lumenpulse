import { BadRequestException } from '@nestjs/common';

export enum GrantRoundState {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  MATCHING = 'MATCHING',
  CLOSED = 'CLOSED',
  DISBURSED = 'DISBURSED',
}

const LEGAL_TRANSITIONS: Record<GrantRoundState, readonly GrantRoundState[]> = {
  [GrantRoundState.DRAFT]: [GrantRoundState.OPEN],
  [GrantRoundState.OPEN]: [GrantRoundState.MATCHING],
  [GrantRoundState.MATCHING]: [GrantRoundState.CLOSED],
  [GrantRoundState.CLOSED]: [GrantRoundState.DISBURSED],
  [GrantRoundState.DISBURSED]: [],
};

const INVALID_TRANSITION_MESSAGE = 'Invalid grant round state transition';

export function transitionGrantRound(
  current: GrantRoundState,
  next: GrantRoundState,
): GrantRoundState {
  if (!LEGAL_TRANSITIONS[current].includes(next)) {
    throw new BadRequestException(INVALID_TRANSITION_MESSAGE);
  }
  return next;
}

export function assertGrantRoundState(
  current: GrantRoundState,
  allowed: readonly GrantRoundState[],
): void {
  if (!allowed.includes(current)) {
    throw new BadRequestException(INVALID_TRANSITION_MESSAGE);
  }
}

export function canTransitionGrantRound(
  current: GrantRoundState,
  next: GrantRoundState,
): boolean {
  return LEGAL_TRANSITIONS[current].includes(next);
}
