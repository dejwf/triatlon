# Nasazení do Kubernetes (cookbook)

Ruční nasazení Helm chartem [`deploy/helm/triatlon`](../helm/triatlon) bez GitOps (Flux, Argo CD).
Postup je ozkoušený na microk8s v homelabu a dá se použít na libovolném clusteru. Rozdíly mezi
clustery shrnuje sekce [Jiné clustery](#jiné-clustery). Alternativa bez Kubernetes je
[Docker Compose na jednom serveru](../README.md).

## Co se nasadí

| Objekt              | Co dělá                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `triatlon-api`      | NestJS API; při startu počká na databázi a provede migrace           |
| `triatlon-web`      | Caddy se statickým webem (administrace + veřejná tabule) na portu 80 |
| `triatlon-postgres` | Postgres 17 (StatefulSet, PVC `data-triatlon-postgres-0`)            |
| `triatlon-backup`   | CronJob `pg_dump` do PVC `triatlon-backup`, staré zálohy maže        |
| `triatlon-mailpit`  | volitelně: testovací SMTP, e-maily se jen zobrazí v UI               |
| Ingress `triatlon`  | `/api` → API, `/` → web; HTTPS volitelně přes cert-manager           |
| Secret `triatlon`   | hesla; **nevytváří ho chart**, zakládá se ručně (viz níže)           |

API běží v **jedné replice**: živý kanál výsledků (SSE) drží stav v paměti procesu.

## Předpoklady

- `kubectl` s kontextem cílového clusteru, `helm` 3, Docker s `buildx` (Docker Desktop stačí).
- V clusteru: ingress controller, výchozí (nebo známá) StorageClass, volitelně cert-manager.
- Registry, ze které cluster tahá image (viz [Image](#image)).

Ve všech příkazech níže volte kontext explicitně (`--context` / `--kube-context`), ať se omylem
nenasadí do jiného clusteru:

```sh
export KCTX=microk8s NS=triatlon
k() { kubectl --context "$KCTX" -n "$NS" "$@"; }
h() { helm --kube-context "$KCTX" -n "$NS" "$@"; }
```

## Homelab: microk8s (první nasazení)

Cluster `microk8s` (jeden uzel `192.168.0.250`, ingress-nginx třídy `public`, StorageClass
`microk8s-hostpath`). Přístup jen z domácí sítě přes HTTP, e-maily do Mailpitu. Hodnoty jsou v
[`values-homelab.yaml`](values-homelab.yaml).

1. **Registry v clusteru** (jednou). Microk8s tahá z `localhost:32000` bez TLS už ve výchozím
   nastavení:
   ```sh
   kubectl --context "$KCTX" apply -f deploy/k8s/registry.yaml
   curl http://192.168.0.250:32000/v2/    # → {}
   ```
2. **Image** z aktuálního commitu (amd64). Na konci skript vypíše tag:
   ```sh
   deploy/k8s/build-push.sh
   ```
3. **Namespace a Secret** (jednou):
   ```sh
   kubectl --context "$KCTX" create namespace "$NS"
   k create secret generic triatlon \
     --from-literal=AUTH_SECRET="$(openssl rand -base64 48)" \
     --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)"
   ```
   Heslo databáze musí mít jen znaky bezpečné v URL (proto `-hex`). Secret si zazálohujte mimo
   cluster: bez `POSTGRES_PASSWORD` se ke stávajícím datům nepřipojíte a nový `AUTH_SECRET`
   odhlásí všechny uživatele.
4. **Instalace:**
   ```sh
   h upgrade --install triatlon deploy/helm/triatlon \
     -f deploy/k8s/values-homelab.yaml --set image.tag=<tag>
   k rollout status deploy/triatlon-api
   ```
   `helm --wait` nepoužívejte: PVC záloh se při `WaitForFirstConsumer` naváže až první zálohou,
   takže by čekání skončilo timeoutem.
5. **První admin a závod** (jen poprvé, e-mail je `api.env.SEED_ADMIN_EMAIL`):
   ```sh
   k exec deploy/triatlon-api -- node dist/seed.js
   ```
6. **DNS netřeba:** jména `triatlon.192-168-0-250.sslip.io` a `mailpit.192-168-0-250.sslip.io`
   přeloží veřejná služba [sslip.io](https://sslip.io) na IP uvedenou ve jméně. Funguje v celé
   domácí síti včetně telefonů. Kdyby router blokoval DNS odpovědi s privátní IP („DNS rebind
   protection“, `dig +short triatlon.192-168-0-250.sslip.io` nic nevrátí), povolte na něm výjimku
   pro `sslip.io`, nebo na počítači přidejte do `/etc/hosts`:
   ```
   192.168.0.250 triatlon.192-168-0-250.sslip.io mailpit.192-168-0-250.sslip.io
   ```
7. Otevřete `http://triatlon.192-168-0-250.sslip.io/zavody` a přihlaste se e-mailem admina. Kód z
   e-mailu najdete na `http://mailpit.192-168-0-250.sslip.io`.

Appka se připojí přes `EXPO_PUBLIC_API_URL=http://triatlon.192-168-0-250.sslip.io/api`. Telefon
musí být v domácí Wi-Fi.

## Aktualizace

```sh
deploy/k8s/build-push.sh                       # → nový tag
h upgrade triatlon deploy/helm/triatlon -f deploy/k8s/values-homelab.yaml --set image.tag=<tag>
k rollout status deploy/triatlon-api
```

- Migrace databáze proběhnou při startu API. Před větší změnou spusťte ruční zálohu (níže).
- **Návrat k předchozí verzi:** `h rollback triatlon` (nebo `--set image.tag=<starší tag>`).
  Starší migrace databáze se tím nevrátí. Pokud nová verze změnila schéma, obnovte zálohu.
- **V den závodu nenasazujte.**

## Zálohy a obnova

```sh
# ruční záloha (např. před aktualizací)
k create job --from=cronjob/triatlon-backup zaloha-$(date +%s)

# stažení záloh do počítače přes pomocný pod s PVC záloh
k run zalohy --restart=Never --image=busybox:1.37 --overrides='{"spec":{"volumes":[{"name":"b",
  "persistentVolumeClaim":{"claimName":"triatlon-backup"}}],"containers":[{"name":"zalohy",
  "image":"busybox:1.37","command":["sleep","3600"],"volumeMounts":[{"name":"b","mountPath":"/backups"}]}]}}'
k wait --for=condition=ready pod/zalohy
k exec zalohy -- ls -l /backups
k cp zalohy:/backups/triatlon-….sql.gz ./triatlon-….sql.gz
k delete pod zalohy
```

Zálohy na stejném disku jako databáze před ztrátou disku neochrání, proto je pravidelně
stahujte nebo kopírujte jinam.

**Den závodu:** zálohy každých 15 minut:
`h upgrade … --reuse-values --set backup.schedule='*/15 * * * *'`.

**Obnova** do prázdné databáze:

```sh
k scale deploy/triatlon-api --replicas=0
gunzip -c triatlon-….sql.gz | k exec -i triatlon-postgres-0 -- \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
k scale deploy/triatlon-api --replicas=1
```

## Image

Chart skládá adresu image jako `<image.registry>/triatlon-api:<image.tag>` (a stejně
`triatlon-web`). `build-push.sh` řídí proměnné:

| Proměnná                              | Výchozí                 | Poznámka                                                     |
| ------------------------------------- | ----------------------- | ------------------------------------------------------------ |
| `REGISTRY`                            | `192.168.0.250:32000`   | adresa pro push z počítače                                   |
| `TAG`                                 | commit (`-dirty`)       | `-dirty` = necommitované změny                               |
| `PLATFORM`                            | `linux/amd64`           | `linux/arm64` pro Raspberry Pi / ARM uzly, obojí oddělit `,` |
| `INSECURE`                            | `true` pro port `32000` | registry bez TLS                                             |
| `ORGANIZER_NAME`, `ORGANIZER_CONTACT` | prázdné                 | zapečou se do webu (stránka o osobních údajích)              |

Adresa pro push (`REGISTRY`) a pro pull v clusteru (`image.registry`) se mohou lišit. V homelabu
je to `192.168.0.250:32000` a `localhost:32000`.

**GHCR / jiná registry:**

```sh
docker login ghcr.io
REGISTRY=ghcr.io/<owner> deploy/k8s/build-push.sh
k create secret docker-registry ghcr --docker-server=ghcr.io \
  --docker-username=<owner> --docker-password=<token s read:packages>
# values: image.registry=ghcr.io/<owner>, imagePullSecrets: [{name: ghcr}]
```

Image z workflow [Nasazení](../../.github/workflows/deploy.yml) mají tag `<commit>` (API) a
`<commit>-<prostředí>` (web). Chart používá pro oba stejný tag, proto pro Kubernetes stavějte
přes `build-push.sh`.

## Jiné clustery

Pro každé prostředí založte vlastní values soubor podle `values-homelab.yaml`. Měnit je potřeba:

| Co                 | Kde ve values                                      | Příklady                                                                                                                                     |
| ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Doména             | `host`                                             | `vysledky.vlkancice.cz`                                                                                                                      |
| Ingress controller | `ingress.className`, `ingress.annotations`         | **ingress-nginx:** anotace z homelabu (bez nich se živé výsledky zdrží v bufferu). **Traefik (k3s):** `className: traefik`, anotace netřeba. |
| HTTPS              | `ingress.tls.enabled`, `ingress.tls.clusterIssuer` | cert-manager s ClusterIssuerem (níže). Bez cert-manageru: Secret s certifikátem pod `ingress.tls.secretName`.                                |
| Úložiště           | `postgres.storageClass`, `backup.storageClass`     | `''` = výchozí StorageClass. k3s: `local-path`, cloud: `standard` / `gp3` / `managed-csi`.                                                   |
| Databáze           | `postgres.enabled: false`                          | spravovaný Postgres. Do Secretu přidejte `DATABASE_URL`. Zálohy CronJobem se pak nevytvoří, řeší je poskytovatel.                            |
| E-maily            | `mailpit.enabled: false`, `api.env.SMTP_*`         | `SMTP_HOST`, `SMTP_PORT: '587'`, `MAIL_FROM`; do Secretu `SMTP_USER` a `SMTP_PASSWORD`. Doména odesílatele potřebuje SPF, DKIM a DMARC.      |
| Architektura       | `PLATFORM` v `build-push.sh`                       | ARM uzly: `linux/arm64`                                                                                                                      |

**Veřejný přístup s HTTPS (Let's Encrypt přes cert-manager):**

```yaml
# cluster-issuer.yaml — jednou na cluster
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <kontaktní e-mail>
    privateKeySecretRef: { name: letsencrypt-account }
    solvers:
      - http01:
          ingress: { ingressClassName: public } # třída ingressu clusteru
```

```yaml
# values-<prostředí>.yaml
host: vysledky.vlkancice.cz
ingress:
  className: public
  tls: { enabled: true, clusterIssuer: letsencrypt }
```

DNS domény musí mířit na veřejnou IP clusteru. U homelabu je potřeba na routeru přesměrovat porty
80 a 443 na uzel. `host` zároveň určuje `WEB_URL` (odkazy v e-mailech), proto po změně domény
nasaďte znovu.

## Řešení potíží

| Příznak                                    | Příčina / řešení                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `ErrImagePull` / `ImagePullBackOff`        | špatný `image.registry` nebo tag; u privátní registry chybí `imagePullSecrets`                              |
| API visí v `Init:0/1`                      | Postgres neběží: `k logs triatlon-postgres-0`                                                               |
| API restartuje, `P1001` / `P1000`          | špatné heslo v Secretu vůči už inicializované databázi (heslo se nastavuje jen při prvním startu Postgresu) |
| PVC `Pending`                              | u `triatlon-backup` je to normální, než proběhne první záloha; jinak chybí StorageClass                     |
| živé výsledky se zpožďují o desítky sekund | ingress bufferuje odpovědi: anotace `proxy-buffering: 'off'` (ingress-nginx)                                |
| přihlašovací e-mail nepřijde               | `k logs deploy/triatlon-api`; v testu zkontrolujte Mailpit                                                  |

Stav a logy: `k get pods`, `k logs deploy/triatlon-api`, `h status triatlon`, `h history triatlon`.

## Odinstalace

```sh
h uninstall triatlon
```

Data zůstanou: PVC databáze (StatefulSet) i záloh (`resource-policy: keep`). Smazat je musíte
ručně (`k delete pvc …`). Namespace se Secretem také zůstane.
