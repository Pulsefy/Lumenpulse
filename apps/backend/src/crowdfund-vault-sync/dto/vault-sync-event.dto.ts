export interface VaultSyncEventInput {
  txHash: string;
  eventIndex: number;
  contractId: string;
  eventType: string;
  rawPayload: Record<string, unknown>;
  ledgerSeq?: number;
}

export const VAULT_EVENT_TYPES = {
  PROJECT_CREATED: 'projectcreatedevent',
  DEPOSIT: 'depositevent',
  WITHDRAW: 'withdrawevent',
  MILESTONE_APPROVED: 'milestoneapprovedevent',
  MILESTONE_APPROVED_BY_VOTE: 'milestoneapprovedbyvoteevent',
  PROJECT_CANCELED: 'projectcanceledevent',
  PROJECT_EXPIRED: 'projectexpiredevent',
  CONTRIBUTION_REFUNDED: 'contributionrefundedevent',
  CONTRIBUTION_CLAWED_BACK: 'contributionclawedbackevent',
  CONTRIBUTOR_PAYOUT: 'contributorpayoutevent',
} as const;
