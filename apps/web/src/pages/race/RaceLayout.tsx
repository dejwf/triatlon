import { NavLink, Outlet } from 'react-router';
import { useIsAdmin, useRace, useRaceId } from '../../hooks';
import { formatDate, RACE_STATUS_LABEL } from '../../labels';
import { ErrorBox, Loading } from '../../ui';

export function RaceLayout() {
  const raceId = useRaceId();
  const race = useRace(raceId);
  const isAdmin = useIsAdmin();

  if (race.isPending) return <Loading />;
  if (race.error) return <ErrorBox error={race.error} />;

  const r = race.data;
  return (
    <>
      <div className="page-head">
        <h1>
          {r.name} {r.year}
        </h1>
        <span className="muted">
          {formatDate(r.date)} · {RACE_STATUS_LABEL[r.status]} · {r.participantCount} závodníků
        </span>
      </div>
      <nav className="tabs">
        <NavLink to="prehled">Přehled</NavLink>
        <NavLink to="vysledky">Výsledky</NavLink>
        <NavLink to="zavodnici">Závodníci</NavLink>
        {isAdmin && <NavLink to="import">Import</NavLink>}
        <NavLink to="kategorie">Kategorie</NavLink>
        <NavLink to="checkpointy">Checkpointy</NavLink>
        {isAdmin && <NavLink to="organizatori">Organizátoři</NavLink>}
        {isAdmin && <NavLink to="nastaveni">Nastavení</NavLink>}
      </nav>
      <Outlet />
    </>
  );
}
