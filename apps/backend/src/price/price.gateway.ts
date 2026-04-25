import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, forwardRef, Logger } from '@nestjs/common';
import { PriceService } from './price.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class PriceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PriceGateway.name);

  constructor(
    @Inject(forwardRef(() => PriceService))
    private readonly priceService: PriceService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody() data: { pair: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ event: string; data: { room: string } }> {
    const room = data.pair.replace('/', '_');

    await client.join(room); // ✅ FIX

    return {
      event: 'subscribed',
      data: { room },
    };
  }

  // Used by service to push updates
  sendPriceUpdate(
    pair: string,
    payload: { pair: string; price: string; timestamp: number },
  ): void {
    const room = pair.replace('/', '_');
    this.server.to(room).emit('priceUpdate', payload);
  }
}
