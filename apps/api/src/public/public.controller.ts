import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import type { PublicRaceResultsDto, PublicRaceSummaryDto } from '@triatlon/shared';
import { interval, map, merge, type Observable } from 'rxjs';
import { Public } from '../auth/decorators';
import { RealtimeService } from '../realtime/realtime.service';
import { PublicService } from './public.service';

const Uuid = new ParseUUIDPipe({ version: '4' });

/** Veřejná výsledková tabule — bez přihlášení, jen pro čtení, minimum osobních údajů. */
@Public()
@Controller('public/races')
export class PublicController {
  constructor(
    private readonly publicResults: PublicService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  races(): Promise<PublicRaceSummaryDto[]> {
    return this.publicResults.races();
  }

  @Get(':raceId/results')
  @Header('Cache-Control', 'public, max-age=5')
  results(@Param('raceId', Uuid) raceId: string): Promise<PublicRaceResultsDto> {
    return this.publicResults.raceResults(raceId);
  }

  /** Živý kanál pro tabuli (EventSource): zpráva o změně kategorií + heartbeat. */
  @Sse(':raceId/stream')
  async stream(@Param('raceId', Uuid) raceId: string): Promise<Observable<MessageEvent>> {
    await this.publicResults.assertVisible(raceId);
    return merge(
      this.realtime.stream(raceId).pipe(map((data) => ({ type: 'results', data }) as MessageEvent)),
      interval(25_000).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
    );
  }
}
