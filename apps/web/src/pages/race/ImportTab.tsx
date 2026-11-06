import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IMPORT_TEMPLATE_HEADER, type ImportResult } from '@triatlon/shared';
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import { ApiError, http } from '../../api';
import { keys, useRaceId } from '../../hooks';
import { GENDER_LABEL, LOCALITY_LABEL } from '../../labels';
import { ErrorBox } from '../../ui';

type Row = Record<string, string | number | null>;

/** Načte CSV (oddělovač se detekuje — Excel v ČR ukládá se středníkem) nebo XLSX do řádků podle hlavičky. */
async function readFile(file: File): Promise<Row[]> {
  if (/\.xlsx$/i.test(file.name)) {
    const [header, ...data] = await readSheet(file);
    if (!header) return [];
    return data
      .filter((cells) => cells.some((c) => c !== null && String(c).trim() !== ''))
      .map((cells) =>
        Object.fromEntries(
          header.map((h, i) => {
            const v: unknown = cells[i] ?? null;
            const value =
              v instanceof Date
                ? v.toISOString().slice(0, 10)
                : typeof v === 'number' || v === null
                  ? v
                  : String(v);
            return [String(h ?? `sloupec ${i + 1}`), value];
          }),
        ),
      );
  }
  const text = await file.text();
  const parsed = Papa.parse<Row>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length) {
    throw new Error(
      `Soubor se nepodařilo přečíst: ${parsed.errors[0]!.message} (řádek ${parsed.errors[0]!.row})`,
    );
  }
  return parsed.data;
}

function downloadTemplate() {
  const example = ['Jan', 'Novák', '1990', 'M', 'místní', ''];
  const csv = `﻿${IMPORT_TEMPLATE_HEADER.join(';')}\n${example.join(';')}\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: 'zavodnici-sablona.csv',
  });
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportTab() {
  const raceId = useRaceId();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileError, setFileError] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');

  const preview = useMutation({
    mutationFn: (r: Row[]) =>
      http.post<ImportResult>(`/races/${raceId}/participants/import/preview`, { rows: r }),
  });
  const commit = useMutation({
    mutationFn: (r: Row[]) =>
      http.post<ImportResult>(`/races/${raceId}/participants/import`, { rows: r }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.participants(raceId) });
      void queryClient.invalidateQueries({ queryKey: keys.race(raceId) });
      void queryClient.invalidateQueries({ queryKey: keys.races });
    },
  });

  async function onFile(file: File | undefined) {
    setFileError(null);
    setRows(null);
    preview.reset();
    commit.reset();
    if (!file) return;
    setFileName(file.name);
    try {
      const r = await readFile(file);
      if (r.length === 0) throw new Error('Soubor neobsahuje žádné řádky se závodníky.');
      setRows(r);
      preview.mutate(r);
    } catch (err) {
      setFileError(err);
    }
  }

  // Při neúspěšném importu vrací API stejný výsledek validace jako náhled.
  const commitResult =
    commit.error instanceof ApiError && commit.error.status === 422
      ? (commit.error.body as ImportResult)
      : undefined;
  const result = commit.data ?? commitResult ?? preview.data;
  const errorCount = result?.rows.filter((r) => r.errors.length).length ?? 0;

  return (
    <div className="stack">
      <p className="muted">
        Nahrajte CSV nebo XLSX s hlavičkou. Rozpoznávané sloupce:{' '}
        <strong>jméno, příjmení, ročník</strong> (nebo datum narození), <strong>pohlaví</strong>{' '}
        (M/Ž), <strong>lokalita</strong> (místní/host) a volitelně <strong>číslo</strong> — bez
        čísla se přidělí další volné v kategorii. Importují se buď všechny řádky, nebo žádný.{' '}
        <button type="button" className="link" onClick={downloadTemplate}>
          Stáhnout šablonu CSV
        </button>
      </p>
      <input
        type="file"
        accept=".csv,.xlsx,text/csv"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <ErrorBox error={fileError ?? preview.error ?? (commitResult ? null : commit.error)} />

      {preview.isPending && <p className="muted">Kontroluji {rows?.length} řádků…</p>}

      {commit.isSuccess && (
        <p className="ok">
          Importováno {commit.data.imported} závodníků ze souboru {fileName}.
        </p>
      )}

      {result && !commit.isSuccess && (
        <>
          <p className={errorCount ? 'error' : 'ok'}>
            {errorCount
              ? `${errorCount} z ${result.rows.length} řádků obsahuje chyby — opravte soubor a nahrajte ho znovu.`
              : `Všech ${result.rows.length} řádků je v pořádku.`}
          </p>
          {!errorCount && rows && (
            <button
              className="primary"
              disabled={commit.isPending}
              onClick={() => commit.mutate(rows)}
            >
              Importovat {result.rows.length} závodníků
            </button>
          )}
          <table>
            <thead>
              <tr>
                <th className="num">Řádek</th>
                <th>Jméno</th>
                <th className="num">Ročník</th>
                <th>Pohlaví / lokalita</th>
                <th>Kategorie</th>
                <th className="num">Číslo</th>
                <th>Chyby</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.row} className={r.errors.length ? 'row-error' : undefined}>
                  <td className="num">{r.row + 1}</td>
                  <td>
                    {r.participant
                      ? `${r.participant.lastName} ${r.participant.firstName}${r.participant.nickname ? ` „${r.participant.nickname}“` : ''}${r.participant.formal === false ? ' (neformálně)' : ''}`
                      : Object.values(rows?.[r.row - 1] ?? {})
                          .slice(0, 2)
                          .join(' ')}
                  </td>
                  <td className="num">{r.participant?.birthYear}</td>
                  <td>
                    {r.participant &&
                      `${GENDER_LABEL[r.participant.gender]}, ${LOCALITY_LABEL[r.participant.locality]}`}
                  </td>
                  <td>{r.participant?.categoryName}</td>
                  <td className="num">{r.participant?.bib}</td>
                  <td className="error">{r.errors.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
