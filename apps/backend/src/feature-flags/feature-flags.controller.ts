import { Controller, Get, Param, Post, Body, Delete } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  list() {
    return this.flags.listFlags();
  }

  @Get('check/:key')
  async check(@Param('key') key: string) {
    const enabled = await this.flags.isEnabled(key);
    return { key, enabled };
  }

  @Get(':key')
  get(@Param('key') key: string) {
    return this.flags.getFlag(key);
  }

  @Post()
  upsert(
    @Body()
    body: {
      key: string;
      enabled: boolean;
      conditions?: Record<string, unknown>;
    },
  ) {
    return this.flags.upsert(
      body.key,
      body.enabled,
      body.conditions ?? undefined,
    );
  }

  @Delete(':key')
  remove(@Param('key') key: string) {
    return this.flags.remove(key);
  }
}
