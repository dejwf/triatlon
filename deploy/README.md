# Provoz — nasazení na server

Celý systém běží na jednom serveru přes Docker Compose. Stačí menší VPS v EU (2 vCPU, 2–4 GB RAM)
u libovolného poskytovatele. Hosting zůstává přenositelný, protože jde jen o Docker image.
Nasazení do Kubernetes (Helm chart) popisuje [`k8s/README.md`](k8s/README.md).

| Služba     | Co dělá                                                                                 |
| ---------- | --------------------------------------------------------------------------------------- |
| `postgres` | databáze (volume `pgdata`)                                                              |
| `api`      | NestJS API; při každém startu provede migrace databáze                                  |
| `web`      | Caddy: web (administrace + veřejná tabule), proxy `/api` → `api`, **automatické HTTPS** |
| `backup`   | `pg_dump` do `deploy/backups/` v nastaveném intervalu, staré zálohy maže                |

## První nasazení

1. Na serveru je potřeba Docker s Compose pluginem a DNS záznam domény mířící na server. Porty 80 a 443 musí být otevřené.
2. Naklonujte repozitář a v adresáři `deploy/` připravte konfiguraci:
   ```sh
   cp .env.prod.example .env.prod
   openssl rand -base64 48    # → AUTH_SECRET
   ```
   Vyplňte doménu, hesla, SMTP, e-mail prvního admina a údaje pořadatele.
3. Spusťte:
   ```sh
   docker compose --env-file .env.prod up -d --build
   docker compose --env-file .env.prod run --rm api node dist/seed.js   # první admin + závod
   ```
4. Otevřete `https://<doména>/zavody`, přihlaste se e-mailem admina a v Uživatelích založte organizátory.

Veřejná tabule je na `https://<doména>/vysledky` a zobrazuje závody ve stavu _probíhá_ nebo _dokončen_.

## Nasazení z GitHubu (doporučeno)

Workflow [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) se spouští ručně
(**Actions → Nasazení → Run workflow**, volba prostředí `test` / `produkce`). Postup:

1. otestuje kód (CI);
2. sestaví image pro amd64 i arm64 do GitHub Container Registry;
3. na server přes SSH nahraje `docker-compose.yml`, `backup.sh` a `images.env` (které image běží);
4. zazálohuje databázi a provede `pull` a `up -d`;
5. ověří `/api/health`.

Server tak nic nestaví a stačí mu méně paměti. Přístupy k serveru jsou v GitHub Environment,
hesla zůstávají jen v `.env.prod` na serveru. **Návrat k dřívější verzi:** spustit workflow
s vyplněným _tag_ (prvních 12 znaků commitu).

Nastavení serveru a GitHubu krok za krokem popisuje
[`HOSTING_V_OBCI_ALADIN.md`](../HOSTING_V_OBCI_ALADIN.md). Pro VPS je postup stejný, jen bez
routeru a s doménou místo sslip.io. Příkazy na serveru se pak spouštějí s oběma soubory:
`docker compose --env-file .env.prod --env-file images.env …`.

## Aktualizace (build na serveru)

```sh
git pull
docker compose --env-file .env.prod up -d --build
```

Migrace databáze proběhnou samy při startu `api`. **Neaktualizujte v den závodu.**

## Zálohy a obnova

- Zálohy jsou v `deploy/backups/triatlon-YYYYMMDD-HHMMSS.sql.gz`.
- Výchozí interval je 1× denně. **V den závodu** nastavte `BACKUP_INTERVAL_SECONDS=900` a spusťte `docker compose … up -d backup`.
- Zálohy kopírujte i mimo server, například `rsync` nebo `rclone` na jiné úložiště v EU. Záloha na stejném disku před ztrátou serveru neochrání.
- Obnova do prázdné databáze:
  ```sh
  docker compose --env-file .env.prod stop api
  gunzip -c backups/triatlon-….sql.gz | docker compose --env-file .env.prod exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  docker compose --env-file .env.prod start api
  ```
- Obnovu si jednou za čas vyzkoušejte, nejpozději na generálce F5.

## E-maily

Přihlašovací kódy chodí e-mailem. Použijte SMTP poskytovatele s doručováním v EU a pro odesílací doménu nastavte **SPF, DKIM a DMARC**, jinak budou kódy padat do spamu. Port 587 používá STARTTLS, port 465 TLS. Přihlášení se nastavuje přes `SMTP_USER` a `SMTP_PASSWORD`.

## Appka

Appka se připojuje k `https://<doména>/api`. Pro build appky nastavte `EXPO_PUBLIC_API_URL`. Distribuce přes EAS zatím není připravená, viz `apps/mobile/README.md`.

## Zkouška nanečisto lokálně

Bez domény a HTTPS na portu 8088:

```sh
# .env.prod: SITE_ADDRESS=:80, WEB_URL=http://localhost:8088, HTTP_PORT=8088, HTTPS_PORT=8443,
#            SMTP_HOST=host.docker.internal, SMTP_PORT=1025 (Mailpit z vývojového docker-compose)
docker compose -p triatlon-test --env-file .env.prod up -d --build
docker compose -p triatlon-test --env-file .env.prod down -v   # úklid
```

## GDPR v provozu

- Na stránce `/ochrana-osobnich-udaju` jsou informace pro závodníky. Pořadatele doplní `ORGANIZER_NAME` a `ORGANIZER_CONTACT` při buildu. **Text nechte zkontrolovat.**
- Závodníkovi, který nechce zveřejnit jméno, admin v Závodnících odškrtne _jméno veřejně_. Na tabuli se pak ukáže jen číslo.
- **Žádost o přístup k údajům** vyřídíte tlačítkem Závodníci → Upravit → _Export údajů_, které stáhne JSON.
- **Žádost o výmaz** vyřídíte tlačítkem _Anonymizovat_. Jméno se nahradí, přezdívka se smaže a kopie údajů zmizí z auditu, ale časy a pořadí ostatních zůstanou.
- Data jsou v EU, tedy na serveru, v zálohách i u SMTP poskytovatele.
