import { useQuery } from '@tanstack/react-query';
import type {
  AssignmentDto,
  ParticipantDto,
  RaceDetailDto,
  RaceSummaryDto,
  UserDto,
} from '@triatlon/shared';
import { useParams } from 'react-router';
import { auth, http } from './api';

export const keys = {
  races: ['races'] as const,
  race: (id: string) => ['race', id] as const,
  participants: (raceId: string) => ['participants', raceId] as const,
  assignments: (raceId: string) => ['assignments', raceId] as const,
  users: ['users'] as const,
};

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
