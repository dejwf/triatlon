/** Webová varianta (jen vývoj v prohlížeči). */
export const secure = {
  get: async (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: async (key: string, value: string | null) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // ignorovat
    }
  },
};
