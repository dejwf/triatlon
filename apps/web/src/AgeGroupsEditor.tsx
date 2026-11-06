import type { AgeGroup, Distances, Gender } from '@triatlon/shared';

const autoLabel = (g: AgeGroup) => (g.maxAge === null ? `${g.minAge}+` : `${g.minAge}–${g.maxAge}`);

const DISTANCE_FIELDS: { key: keyof Distances; label: string }[] = [
  { key: 'swim', label: 'Plavání' },
  { key: 'bike', label: 'Kolo' },
  { key: 'run', label: 'Běh' },
];

/**
 * Editor věkových skupin (hranice včetně; „do“ prázdné = bez horní hranice). Skupina může být
 * jen pro jedno pohlaví („Muži do 40“) a volitelná („Super ženy“ — závodník se do ní zařadí
 * jen volbou při registraci). Délky tratí v metrech jsou výchozí pro kategorie skupiny.
 */
export function AgeGroupsEditor({
  value,
  onChange,
  disabled,
}: {
  value: AgeGroup[];
  onChange: (groups: AgeGroup[]) => void;
  disabled?: boolean;
}) {
  function update(i: number, patch: Partial<AgeGroup>) {
    onChange(
      value.map((g, j) => {
        if (j !== i) return g;
        const next = { ...g, ...patch };
        // Popisek se dopočítává, dokud ho admin nezmění ručně.
        return g.label === autoLabel(g) && !('label' in patch)
          ? { ...next, label: autoLabel(next) }
          : next;
      }),
    );
  }

  function setDistance(i: number, key: keyof Distances, raw: string) {
    const g = value[i]!;
    const distances = { ...g.distances, [key]: raw === '' ? null : Number(raw) };
    update(i, { distances });
  }

  return (
    <div className="age-groups">
      <table>
        <thead>
          <tr>
            <th>Od (let)</th>
            <th>Do (let)</th>
            <th>Popisek</th>
            <th>Pohlaví</th>
            <th title="Závodník se do skupiny nezařadí podle věku, ale jen volbou při registraci (např. Super ženy na dlouhé trati).">
              Volitelná
            </th>
            {DISTANCE_FIELDS.map((f) => (
              <th key={f.key} title="Výchozí délka tratě v metrech">
                {f.label} (m)
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {value.map((g, i) => (
            <tr key={i}>
              <td>
                <input
                  type="number"
                  min={0}
                  required
                  className="short"
                  disabled={disabled}
                  value={g.minAge}
                  onChange={(e) => update(i, { minAge: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  className="short"
                  disabled={disabled}
                  placeholder="bez omezení"
                  value={g.maxAge ?? ''}
                  onChange={(e) =>
                    update(i, { maxAge: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
              </td>
              <td>
                <input
                  required
                  disabled={disabled}
                  value={g.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              </td>
              <td>
                <select
                  disabled={disabled}
                  value={g.gender ?? ''}
                  onChange={(e) =>
                    update(i, { gender: e.target.value ? (e.target.value as Gender) : null })
                  }
                >
                  <option value="">muži i ženy</option>
                  <option value="male">jen muži</option>
                  <option value="female">jen ženy</option>
                </select>
              </td>
              <td className="center">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={g.elective ?? false}
                  onChange={(e) => update(i, { elective: e.target.checked })}
                />
              </td>
              {DISTANCE_FIELDS.map((f) => (
                <td key={f.key}>
                  <input
                    type="number"
                    min={0}
                    className="short"
                    disabled={disabled}
                    value={g.distances?.[f.key] ?? ''}
                    onChange={(e) => setDistance(i, f.key, e.target.value)}
                  />
                </td>
              ))}
              <td>
                <button
                  type="button"
                  className="link danger"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  Odebrat
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const last = value.at(-1);
          const minAge = last ? (last.maxAge ?? last.minAge) + 1 : 0;
          onChange([...value, { label: `${minAge}+`, minAge, maxAge: null }]);
        }}
      >
        Přidat skupinu
      </button>
    </div>
  );
}
