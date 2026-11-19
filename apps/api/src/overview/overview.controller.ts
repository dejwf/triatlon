import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { DeviceHeartbeatInput, type RaceOverviewDto } from '@triatlon/shared';
import { CurrentUser, type RequestUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { OverviewService } from './overview.service';

const Uuid = new ParseUUIDPipe({ version: '4' });

@Controller('races/:raceId')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  /** Stav telefonu (appka posílá při synchronizaci): online, odchylka hodin, délka fronty. */
  @Post('devices/heartbeat')
  @HttpCode(204)
  heartbeat(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
    @Body(new ZodPipe(DeviceHeartbeatInput)) body: DeviceHeartbeatInput,
  ): Promise<void> {
    return this.overview.heartbeat(user, raceId, body);
  }

  /** Přehled závodu: telefony na checkpointech a poslední zásahy (audit). */
  @Get('overview')
  get(
    @CurrentUser() user: RequestUser,
    @Param('raceId', Uuid) raceId: string,
  ): Promise<RaceOverviewDto> {
    return this.overview.overview(user, raceId);
  }
}
