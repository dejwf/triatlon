import type { AgeGroup } from '@triatlon/shared';

export const DEFAULT_AGE_GROUPS: AgeGroup[] = [
  { label: '0–5', minAge: 0, maxAge: 5 },
  { label: '6–8', minAge: 6, maxAge: 8 },
  { label: '9–10', minAge: 9, maxAge: 10 },
  { label: '11–15', minAge: 11, maxAge: 15 },
  { label: '16–30', minAge: 16, maxAge: 30 },
  { label: '31–40', minAge: 31, maxAge: 40 },
  { label: '41–50', minAge: 41, maxAge: 50 },
  { label: '51+', minAge: 51, maxAge: null },
];

const autoLabel = (g: AgeGroup) => (g.maxAge === null ? `${g.minAge}+` : `${g.minAge}–${g.maxAge}`);

/** Editor věkových skupin (hranice včetně; „do“ prázdné = bez horní hranice). */
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

  return (
    <div className="age-groups">
      <table>
        <thead>
          <tr>
            <th>Od (let)</th>
            <th>Do (let)</th>
            <th>Popisek</th>
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
                  disabled={disabled}
                  value={g.minAge}
                  onChange={(e) => update(i, { minAge: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
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
