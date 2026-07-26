import { Injectable, Logger } from '@nestjs/common';
import { ActionMapping, BOT_COMMAND_MAPPINGS } from './types';

type HandlerFn = (msg: any, match?: RegExpExecArray | null) => Promise<void>;

@Injectable()
export class BotCommandMapperService {
  private readonly logger = new Logger(BotCommandMapperService.name);
  private handlers = new Map<string, HandlerFn>();

  /**
   * Register a handler for an explicit action name.
   * Only registered actions may be executed by `executeCommand`.
   */
  register(actionName: string, fn: HandlerFn) {
    if (this.handlers.has(actionName)) {
      this.logger.warn(`Overwriting existing handler for ${actionName}`);
    }
    this.handlers.set(actionName, fn);
  }

  /**
   * Execute a command string by resolving its mapping to an action name
   * and calling the registered handler. Returns true when executed.
   */
  async executeCommand(
    commandStr: string,
    msg: any,
    match?: RegExpExecArray | null,
  ): Promise<boolean> {
    const baseCommand = commandStr.split(' ')[0];
    const mapping: ActionMapping | undefined =
      BOT_COMMAND_MAPPINGS[baseCommand];
    if (!mapping) {
      this.logger.warn(`No mapping for command: ${commandStr}`);
      return false;
    }

    const handler = this.handlers.get(mapping.actionName);
    if (!handler) {
      this.logger.warn(
        `No handler registered for action ${mapping.actionName}`,
      );
      return false;
    }

    try {
      await handler(msg, match ?? null);
      return true;
    } catch (err) {
      this.logger.error(
        `Error executing handler for ${mapping.actionName}`,
        err,
      );
      return false;
    }
  }
}
