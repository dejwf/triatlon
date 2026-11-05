# Mobilní appka (Expo)

Appka pro organizátory na checkpointech: grid čísel, poznámky a vrácení akce, check-in, registrace na místě, hromadný start kategorie, offline fronta a synchronizace hodin. Rozhodnutí viz `CLAUDE.md` (sekce 7a), diagramy v `docs/diagramy.md`.

## Spuštění při vývoji

1. Běží API (`pnpm --filter @triatlon/api dev`) a `@triatlon/shared` je zbuildovaný (`pnpm --filter @triatlon/shared build`).
2. Adresa API: appka ve vývoji sama použije počítač, na kterém běží Expo dev server (stejná IP jako v QR kódu), port 3000 — telefon musí být ve stejné Wi-Fi. Jiný server nastavíte v `.env.local` přes `EXPO_PUBLIC_API_URL` (viz `.env.example`).
3. `pnpm --filter @triatlon/mobile start` a pak:
   - **telefon**: appka používá nativní moduly (SQLite, SecureStore), proto potřebuje development build (`npx expo run:ios` / `run:android`, nebo `eas build --profile development`),
   - **prohlížeč** (rychlé zkoušení UI): klávesa `w`. Data se ukládají do localStorage; API musí povolit origin (`CORS_ORIGINS=http://localhost:8081` v `.env`).

Přihlášení: e-mail → 6místný kód z e-mailu (v dev v Mailpitu na http://localhost:8025).

## Testy

`pnpm --filter @triatlon/mobile test` — logika fronty, gridu, hromadného startu a hodin (bez React Native).
