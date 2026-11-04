import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import './index.css';
import { Layout } from './Layout';
import { RacesPage } from './pages/RacesPage';
import { UsersPage } from './pages/UsersPage';
import { RaceLayout } from './pages/race/RaceLayout';
import { RaceSettings } from './pages/race/RaceSettings';
import { CheckpointsTab } from './pages/race/CheckpointsTab';
import { CategoriesTab } from './pages/race/CategoriesTab';
import { ParticipantsTab } from './pages/race/ParticipantsTab';
import { ImportTab } from './pages/race/ImportTab';
import { OrganizersTab } from './pages/race/OrganizersTab';
import { OverviewTab } from './pages/race/OverviewTab';
import { ResultsTab } from './pages/race/ResultsTab';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/zavody" replace /> },
      { path: 'prihlaseni', element: <Navigate to="/zavody" replace /> },
      { path: 'zavody', element: <RacesPage /> },
      {
        path: 'zavody/:raceId',
        element: <RaceLayout />,
        children: [
          { index: true, element: <Navigate to="prehled" replace /> },
          { path: 'prehled', element: <OverviewTab /> },
          { path: 'vysledky', element: <ResultsTab /> },
          { path: 'nastaveni', element: <RaceSettings /> },
          { path: 'checkpointy', element: <CheckpointsTab /> },
          { path: 'kategorie', element: <CategoriesTab /> },
          { path: 'zavodnici', element: <ParticipantsTab /> },
          { path: 'import', element: <ImportTab /> },
          { path: 'organizatori', element: <OrganizersTab /> },
        ],
      },
      { path: 'uzivatele', element: <UsersPage /> },
      { path: '*', element: <p>Stránka nenalezena.</p> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
