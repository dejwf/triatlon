import { Injectable } from '@nestjs/common';
import type { RealtimeMessage } from '@triatlon/shared';
import { filter, map, Observable, Subject } from 'rxjs';

/**
 * Živé změny v rámci jedné instance API (in-process). Při škálování na víc instancí
 * nahradit sdíleným kanálem (např. PostgreSQL LISTEN/NOTIFY).
 */
@Injectable()
export class RealtimeService {
  private readonly bus = new Subject<{ raceId: string; message: RealtimeMessage }>();

  resultsChanged(raceId: string, categoryIds: Iterable<string>): void {
    const ids = [...new Set(categoryIds)];
    if (ids.length) this.bus.next({ raceId, message: { type: 'results', categoryIds: ids } });
  }

  /** Všechny změny (pro invalidaci cache veřejné tabule). */
  all(): Observable<{ raceId: string; message: RealtimeMessage }> {
    return this.bus.asObservable();
  }

  stream(raceId: string): Observable<RealtimeMessage> {
    return this.bus.pipe(
      filter((e) => e.raceId === raceId),
      map((e) => e.message),
    );
  }
}
