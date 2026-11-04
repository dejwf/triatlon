import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignmentDto,
  RaceResultsDto,
  RealtimeMessage,
  TimeEventHistoryDto,
  ParticipantDto,
  RaceDetailDto,
  RaceSummaryDto,
  UserDto,
} from '@triatlon/shared';
import { useParams } from 'react-router';
import { auth, http, subscribe } from './api';

export const keys = {
  races: ['races'] as const,
  race: (id: string) => ['race', id] as const,
  participants: (raceId: string) => ['participants', raceId] as const,
  assignments: (raceId: string) => ['assignments', raceId] as const,
  users: ['users'] as const,
  results: (raceId: string) => ['results', raceId] as const,
  history: (raceId: string, participantId: string) => ['history', raceId, participantId] as const,
};

export const useResults = (raceId: string) =>
  useQuery({
    queryKey: keys.results(raceId),
    queryFn: () => http.get<RaceResultsDto>(`/races/${raceId}/results`),
  });

export const useHistory = (raceId: string, participantId: string) =>
  useQuery({
    queryKey: keys.history(raceId, participantId),
    queryFn: () =>
      http.get<TimeEventHistoryDto[]>(`/races/${raceId}/participants/${participantId}/history`),
  });

/** Živé aktualizace závodu: při změně výsledků obnoví data. Vrací, zda je kanál připojen. */
export function useRaceStream(raceId: string): boolean {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: keys.results(raceId) });
      void queryClient.invalidateQueries({ queryKey: ['history', raceId] });
      void queryClient.invalidateQueries({ queryKey: keys.participants(raceId) });
    };
    const unsubscribe = subscribe(`/races/${raceId}/stream`, (type, data) => {
      if (type === 'connected') {
        setConnected(true);
        refresh();
      } else if (type === 'disconnected') {
        setConnected(false);
      } else if (type === 'results') {
        const msg = JSON.parse(data) as RealtimeMessage;
        if (msg.categoryIds.length) refresh();
      }
    });
    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [raceId, queryClient]);
  return connected;
}

/** Aktuální čas, obnovovaný každou sekundu (uplynulý čas od startu). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export const useRaces = () =>
  useQuery({ queryKey: keys.races, queryFn: () => http.get<RaceSummaryDto[]>('/races') });

export function useRaceId(): string {
  const { raceId } = useParams();
  if (!raceId) throw new Error('Chybí ID závodu v URL.');
  return raceId;
}

export const useRace = (id: string) =>
  useQuery({ queryKey: keys.race(id), queryFn: () => http.get<RaceDetailDto>(`/races/${id}`) });

export const useParticipants = (raceId: string) =>
  useQuery({
    queryKey: keys.participants(raceId),
    queryFn: () => http.get<ParticipantDto[]>(`/races/${raceId}/participants`),
  });

export const useAssignments = (raceId: string) =>
  useQuery({
    queryKey: keys.assignments(raceId),
    queryFn: () => http.get<AssignmentDto[]>(`/races/${raceId}/assignments`),
  });

export const useUsers = () =>
  useQuery({ queryKey: keys.users, queryFn: () => http.get<UserDto[]>('/users') });

export function useIsAdmin(): boolean {
  const role = auth.user?.role;
  return role === 'admin' || role === 'super_admin';
}
