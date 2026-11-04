/** Webová varianta úložiště (jen pro vývoj v prohlížeči) — localStorage. */
export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // vývojová varianta — bez úložiště appka funguje, jen nepřežije reload
  }
}
