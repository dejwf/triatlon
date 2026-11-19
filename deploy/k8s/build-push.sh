#!/bin/sh
# Sestaví image `api` a `web` a pošle je do registry clusteru.
#   deploy/k8s/build-push.sh                       # registry homelabu 192.168.0.250:32000, tag = commit
#   REGISTRY=ghcr.io/spolek TAG=v1 PLATFORM=linux/arm64 deploy/k8s/build-push.sh
# INSECURE=true (výchozí pro adresu s portem 32000) = registry bez TLS v domácí síti.
# ORGANIZER_NAME / ORGANIZER_CONTACT se zapečou do webu (stránka o osobních údajích).
set -eu
cd "$(dirname "$0")/../.."

REGISTRY=${REGISTRY:-192.168.0.250:32000}
TAG=${TAG:-$(git rev-parse --short=12 HEAD)$(git diff --quiet HEAD || echo -dirty)}
PLATFORM=${PLATFORM:-linux/amd64}
case "$REGISTRY" in *:32000*) INSECURE=${INSECURE:-true} ;; *) INSECURE=${INSECURE:-false} ;; esac
BUILDER=${BUILDER:-triatlon}

# Builder s ovladačem docker-container umí pushovat i do registry bez TLS (bez úprav Dockeru).
docker buildx inspect "$BUILDER" >/dev/null 2>&1 ||
  docker buildx create --name "$BUILDER" --driver docker-container >/dev/null

for target in api web; do
  echo "→ $REGISTRY/triatlon-$target:$TAG ($PLATFORM)"
  docker buildx build --builder "$BUILDER" --platform "$PLATFORM" --target "$target" \
    --build-arg VITE_ORGANIZER_NAME="${ORGANIZER_NAME:-}" \
    --build-arg VITE_ORGANIZER_CONTACT="${ORGANIZER_CONTACT:-}" \
    --output "type=image,name=$REGISTRY/triatlon-$target:$TAG,push=true,registry.insecure=$INSECURE" \
    .
done
echo "Hotovo. Nasazení: helm upgrade … --set image.tag=$TAG"
