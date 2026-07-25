export enum BotActionType {
  READ = 'READ',
  MUTATION = 'MUTATION',
  PRIVILEGED = 'PRIVILEGED',
}

export interface ActionMapping {
  actionName: string;
  type: BotActionType;
  requiresAdmin?: boolean;
}

// Explicit mapping of commands to their respective actions and permissions
export const BOT_COMMAND_MAPPINGS: Record<string, ActionMapping> = {
  '/start': { actionName: 'SUBSCRIBE', type: BotActionType.MUTATION },
  '/status': { actionName: 'CHECK_STATUS', type: BotActionType.READ },
  '/price': { actionName: 'GET_PRICE', type: BotActionType.READ },
  '/sentiment': { actionName: 'GET_SENTIMENT', type: BotActionType.READ },
  '/trend': { actionName: 'GET_TREND', type: BotActionType.READ },
  '/subscribe': { actionName: 'SUBSCRIBE_ALERT', type: BotActionType.MUTATION },
  '/unsubscribe': { actionName: 'UNSUBSCRIBE_ALERT', type: BotActionType.MUTATION },
  '/silence': { actionName: 'SILENCE_ALERTS', type: BotActionType.MUTATION },
  '/unsilence': { actionName: 'UNSILENCE_ALERTS', type: BotActionType.MUTATION },
  '/subscriptions': { actionName: 'LIST_SUBSCRIPTIONS', type: BotActionType.READ },
  '/help': { actionName: 'HELP', type: BotActionType.READ },
  // Example of a privileged command
  '/broadcast': { actionName: 'ADMIN_BROADCAST', type: BotActionType.PRIVILEGED, requiresAdmin: true },
};
