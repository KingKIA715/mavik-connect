import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "mavik-connect-theme";

function getSystemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolveIsDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && getSystemPrefersDark());
}

/**
 * Applies (or removes) the `dark` class that index.css's dark-mode design
 * tokens (`--color-*` under `.dark`) are already keyed off of. Exported
 * separately so main.tsx can call it once, synchronously, before React
 * mounts — avoiding a flash of the wrong theme on load.
 */
export function applyStoredTheme(): void {
  const stored =
    (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
  document.documentElement.classList.toggle("dark", resolveIsDark(stored));
}

/**
 * Read/write the user's theme preference (light/dark/system), persisted in
 * localStorage and applied as the `dark` class on <html>. Not wired to
 * next-themes — that package is only present for the (currently unused)
 * Sonner toast default — this is a small self-contained hook instead.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system",
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolveIsDark(theme));

    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      document.documentElement.classList.toggle("dark", media.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
