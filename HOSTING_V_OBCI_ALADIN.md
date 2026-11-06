# Hosting v obci: testovací server u souseda (Aladin)

Návod, jak na počítači u souseda se statickou IP rozběhnout **testovací** server triatlonu: web,
API pro appku, veřejnou tabuli a databázi. Nasazuje se automaticky z GitHubu.

> **Jen na testování a generálku, s vymyšlenými daty.** Na ostrý závod patří VPS
> (např. Forpsi) a subdoména obce. Výpadek proudu nebo internetu ve vsi by v den závodu shodil
> web i tabuli; appka díky offline frontě zapisuje dál, ale bez serveru se nic nesynchronizuje.
> Skutečné osobní údaje závodníků na soukromém počítači doma nemají být (GDPR).

## Co bude potřeba

| Co                           | Poznámka                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Veřejná statická IPv4**    | Ověření v kroku 1.                                                                                                           |
| **Počítač běžící nonstop**   | Mini PC, starší notebook, nebo Raspberry Pi 5 se 4–8 GB RAM a **SSD** (ne SD kartou). Stačí 2 jádra, 4 GB RAM a 32 GB disku. |
| **Přístup do routeru**       | Přesměrování portů a pevná adresa v místní síti.                                                                             |
| **Účet v GitHub repozitáři** | Má ho správce projektu, nastaví nasazení (krok 7).                                                                           |
| **SMTP schránka**            | Přes ni chodí přihlašovací kódy. Stačí běžná schránka s SMTP, např. u Forpsi nebo Seznamu.                                   |

Rozdělení práce: **Aladin** dělá kroky 1–5 (počítač a router). **Správce projektu** dělá kroky 6–9
(konfigurace a nasazení). Kroky 6–9 může dělat i Aladin, pokud chce.

## 1. Ověřit veřejnou IP

1. V administraci routeru najděte **WAN / internetovou IP adresu**.
2. Na libovolném počítači v síti otevřete <https://ifconfig.me>.
3. **Obě adresy musí být stejné.**
   - Pokud se liší, nebo router ukazuje adresu `100.64.x.x`–`100.127.x.x`, `10.x.x.x` či
     `192.168.x.x`, připojení je za NAT poskytovatele. Server zvenku nebude dostupný a je potřeba
     požádat poskytovatele o veřejnou IP.
4. Ve smlouvě s poskytovatelem ověřte, že provoz serveru na domácím připojení nezakazuje.

Dál v návodu je tato adresa jako `1.2.3.4`, nahraďte ji skutečnou.

## 2. Nainstalovat systém

- Doporučeno **Ubuntu Server 24.04 LTS**. Pro Raspberry Pi přes Raspberry Pi Imager zvolte
  „Ubuntu Server 24.04 (64-bit)“.
- Při instalaci zapněte **OpenSSH server**. Založte uživatele, třeba `aladin`, se silným heslem.
- V routeru nastavte počítači **pevnou adresu v místní síti** (rezervace DHCP), např.
  `192.168.1.50`.

Pak se z jiného počítače přihlaste: `ssh aladin@192.168.1.50`.

## 3. Zabezpečení a aktualizace

```sh
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades fail2ban ufw
sudo dpkg-reconfigure -plow unattended-upgrades      # automatické bezpečnostní aktualizace → Ano

# Firewall: jen SSH, web a HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

**SSH jen přes klíč, bez hesla:**

1. Na svém počítači si vytvořte klíč: `ssh-keygen -t ed25519`.
2. Nahrajte ho na server: `ssh-copy-id aladin@192.168.1.50`.
3. Ověřte, že přihlášení funguje bez hesla.
4. Pak na serveru vypněte přihlašování heslem:

```sh
echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/99-jen-klice.conf
sudo systemctl restart ssh
```

## 4. Docker a uživatel pro nasazení

```sh
curl -fsSL https://get.docker.com | sudo sh            # oficiální instalace Dockeru
sudo adduser --disabled-password --gecos '' triatlon    # uživatel jen pro nasazování
sudo usermod -aG docker triatlon
sudo mkdir -p /opt/triatlon && sudo chown triatlon: /opt/triatlon
```

> Člen skupiny `docker` má na počítači v praxi práva správce. Proto má být počítač určený jen
> pro tento server, ne rodinný počítač s dalšími daty.

Klíč pro GitHub vytvořte **na svém počítači**, ne na serveru:

```sh
ssh-keygen -t ed25519 -f triatlon-deploy -N '' -C 'github-deploy'
```

Veřejnou část (`triatlon-deploy.pub`) přidejte uživateli `triatlon` na serveru:

```sh
sudo -u triatlon mkdir -p /home/triatlon/.ssh
sudo -u triatlon tee -a /home/triatlon/.ssh/authorized_keys < triatlon-deploy.pub
```

Soukromou část (`triatlon-deploy`) předejte správci projektu do GitHubu (krok 7) a pak ji smažte.

## 5. Router: přesměrování portů

| Venkovní port | Na počítač   | Vnitřní port | Proč                                                        |
| ------------- | ------------ | ------------ | ----------------------------------------------------------- |
| 80            | 192.168.1.50 | 80           | HTTP a získání HTTPS certifikátu                            |
| 443           | 192.168.1.50 | 443          | web, API pro appku, tabule                                  |
| **2222**      | 192.168.1.50 | 22           | SSH pro nasazení z GitHubu (nestandardní port = méně útoků) |

- Umí-li router **DMZ, VLAN nebo oddělenou síť**, dejte server tam, ať není ve stejné síti jako
  rodinné počítače a telefony.
- **Bezpečnější varianta SSH:** místo otevírání portu 2222 použít Tailscale (VPN zdarma, GitHub
  se připojí přes něj). Port 22 pak nemusí být otevřený do internetu. Stačí říct správci, workflow
  se doplní.

Kontrola zvenku, třeba z mobilu na datech: `ssh -p 2222 aladin@1.2.3.4`.

## 6. Konfigurace serveru (`.env.prod`)

Bez domény se použije adresa **sslip.io**. Ta z IP adresy udělá jméno, např.
`triatlon.1-2-3-4.sslip.io` → `1.2.3.4`, a Caddy na něj sám získá HTTPS certifikát.

Na serveru jako uživatel `triatlon` (`sudo -iu triatlon`) vytvořte `/opt/triatlon/.env.prod`
podle [`deploy/.env.prod.example`](deploy/.env.prod.example):

```sh
SITE_ADDRESS=triatlon.1-2-3-4.sslip.io
WEB_URL=https://triatlon.1-2-3-4.sslip.io

POSTGRES_USER=triatlon
POSTGRES_PASSWORD=<openssl rand -base64 24>
POSTGRES_DB=triatlon
AUTH_SECRET=<openssl rand -base64 48>

SMTP_HOST=smtp.example.cz
SMTP_PORT=587
SMTP_USER=…
SMTP_PASSWORD=…
MAIL_FROM="Vlkančický triatlon (test) <…>"

SEED_ADMIN_EMAIL=<e-mail prvního admina>
BACKUP_INTERVAL_SECONDS=86400
BACKUP_KEEP_DAYS=14
```

```sh
chmod 600 /opt/triatlon/.env.prod
```

`ORGANIZER_NAME` a `ORGANIZER_CONTACT` se tu nevyplňují. Při nasazení z GitHubu se nastavují
v GitHubu (krok 7).

## 7. GitHub: prostředí `test`

V repozitáři otevřete **Settings → Environments → New environment** a zadejte `test`.

**Secrets:**

| Název                | Hodnota                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| `DEPLOY_HOST`        | `1.2.3.4`                                                                             |
| `DEPLOY_PORT`        | `2222`                                                                                |
| `DEPLOY_USER`        | `triatlon`                                                                            |
| `DEPLOY_SSH_KEY`     | celý obsah souboru `triatlon-deploy` (soukromý klíč z kroku 4)                        |
| `DEPLOY_KNOWN_HOSTS` | výstup `ssh-keyscan -p 2222 1.2.3.4` (otisk serveru; chrání před podvrženým serverem) |

**Variables:**

| Název               | Hodnota                                           |
| ------------------- | ------------------------------------------------- |
| `DEPLOY_URL`        | `https://triatlon.1-2-3-4.sslip.io`               |
| `DEPLOY_PATH`       | `/opt/triatlon` (výchozí, nemusí se zadávat)      |
| `ORGANIZER_NAME`    | např. `Testovací provoz – nejde o skutečné údaje` |
| `ORGANIZER_CONTACT` | kontaktní e-mail                                  |

## 8. Nasazení

1. Na GitHubu otevřete **Actions → Nasazení → Run workflow**.
2. Zvolte prostředí `test` a spusťte.
3. Workflow:
   - otestuje kód (stejně jako CI);
   - sestaví image pro Intel/AMD i ARM (Raspberry Pi);
   - na serveru zazálohuje databázi;
   - stáhne nové image a restartuje.

   První běh trvá déle (zhruba 10–20 minut), další jsou rychlejší díky cache.

4. Po prvním nasazení založte prvního admina a závod (na serveru jako `triatlon`):

```sh
cd /opt/triatlon
docker compose --env-file .env.prod --env-file images.env run --rm api node dist/seed.js
```

5. Otevřete `https://triatlon.1-2-3-4.sslip.io/zavody` a přihlaste se e-mailem admina.

**Návrat ke starší verzi:** spusťte workflow znovu a do pole _tag_ zadejte tag dřívější verze.
Je to prvních 12 znaků commitu a najdete ho ve výpisu předchozího nasazení. Nic se nesestavuje
a server se jen přepne.

## 9. Appka proti testovacímu serveru

Adresa serveru se do appky zapéká při buildu. Pro testovací build appky (EAS) se nastaví
`EXPO_PUBLIC_API_URL=https://triatlon.1-2-3-4.sslip.io/api`. Při vývoji přes Expo jde použít
stejná proměnná v `apps/mobile/.env`. Jakou adresu appka používá, ukazuje v sekci Zařízení.

## Provoz a údržba

| Kdy                 | Co dělat                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Průběžně            | Na serveru `cd /opt/triatlon && docker compose --env-file .env.prod --env-file images.env ps` → všechny služby `running` / `healthy`. |
| Výpadek proudu      | Po startu počítače se vše spustí samo (`restart: unless-stopped`). Pomůže malá UPS.                                                   |
| Hlídání dostupnosti | Zdarma například UptimeRobot na `https://…sslip.io/api/health`, při výpadku pošle e-mail.                                             |
| Zálohy              | `pg_dump` 1× denně do `/opt/triatlon/backups/` a navíc před každým nasazením. Kopii občas stáhněte jinam.                             |
| Logy                | `docker compose --env-file .env.prod --env-file images.env logs -f api`                                                               |
| Konec testování     | `docker compose … down -v` smaže i databázi. Pak zavřít porty v routeru a smazat GitHub environment `test`.                           |

## Řešení potíží

- **Certifikát se nevydá:** port 80 musí být zvenku dostupný. Sledujte `docker compose … logs web`.
  Při mnoha neúspěšných pokusech Let's Encrypt na hodinu zablokuje další pokusy, takže je potřeba
  počkat.
- **Workflow selže na SSH:** zkontrolujte port 2222 v routeru, `DEPLOY_KNOWN_HOSTS` (po
  reinstalaci serveru se otisk změní) a jestli je klíč v `authorized_keys` uživatele `triatlon`.
- **Nechodí přihlašovací e-maily:** zkontrolujte SMTP údaje v `.env.prod` a `docker compose … logs api`.
  Pak restartujte: `docker compose --env-file .env.prod --env-file images.env up -d`.
- **Chybí `.env.prod`:** workflow skončí chybou a nic nezmění. Viz krok 6.
