#!/bin/bash
# Read-only macOS checks. No container/image starts, pulls, installs or removals.
# Run from the local folder intended for Gridex test work.
set -u
export LC_ALL=C

printf '%s\n' 'GRIDEX LOCAL PREFLIGHT — READ ONLY'
if [ "$(uname -s)" != 'Darwin' ]; then
  printf '%s\n' 'This check must run on the Mac itself. Current host is not macOS.'
  exit 2
fi

printf '\n%s\n' 'macOS version:'
/usr/bin/sw_vers -productVersion
printf '\n%s\n' 'Process architecture:'
/usr/bin/uname -m
printf '\n%s\n' 'Apple Silicon capability (1 means ARM hardware):'
/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || printf '%s\n' 'Unavailable'
printf '\n%s\n' 'Rosetta process translation (1 means translated):'
/usr/sbin/sysctl -n sysctl.proc_translated 2>/dev/null || printf '%s\n' 'Not reported'
printf '\n%s\n' 'Physical RAM, bytes:'
/usr/sbin/sysctl -n hw.memsize
printf '\n%s\n' 'Free space on the selected working folder filesystem:'
/bin/df -h .

printf '\n%s\n' 'Docker Desktop installed application version, if present:'
if [ -f '/Applications/Docker.app/Contents/Info.plist' ]; then
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' '/Applications/Docker.app/Contents/Info.plist'
else
  printf '%s\n' 'Not found at the standard application path; installation not assumed.'
fi

if ! command -v docker >/dev/null 2>&1; then
  printf '\n%s\n' 'Docker CLI unavailable. No installation or startup attempted.'
  exit 0
fi
printf '\n%s\n' 'Docker CLI version:'
docker --version

# Determine the effective endpoint without printing URLs, credentials or config.
gridex_context=''
gridex_endpoint=''
if [ -n "${DOCKER_CONTEXT:-}" ]; then
  gridex_context=$DOCKER_CONTEXT
  gridex_endpoint=$(docker context inspect "$gridex_context" --format '{{.Endpoints.docker.Host}}' 2>/dev/null) || gridex_endpoint=''
elif [ -n "${DOCKER_HOST:-}" ]; then
  gridex_endpoint=$DOCKER_HOST
else
  gridex_context=$(docker context show 2>/dev/null) || gridex_context=''
  if [ -n "$gridex_context" ]; then
    gridex_endpoint=$(docker context inspect "$gridex_context" --format '{{.Endpoints.docker.Host}}' 2>/dev/null) || gridex_endpoint=''
  fi
fi
case "$gridex_endpoint" in
  unix://*) printf '\n%s\n' 'Selected Docker endpoint is a local Unix socket. Server location still requires verification.' ;;
  *)
    printf '\n%s\n' 'Selected Docker endpoint is not a verified local Unix socket. Server queries skipped.'
    exit 0
    ;;
esac

printf '\n%s\n' 'Selected Docker server — limited, non-secret fields:'
if ! docker info --format 'os={{.OSType}} architecture={{.Architecture}} driver={{.Driver}} cpus={{.NCPU}} memory_bytes={{.MemTotal}} engine_version={{.ServerVersion}} operating_system={{.OperatingSystem}}'; then
  printf '%s\n' 'Docker server could not be read. No startup or repair attempted.'
  exit 0
fi
printf '\n%s\n' 'Docker storage usage summary (not a free-space or VM-capacity proof):'
if ! docker system df; then
  printf '%s\n' 'Docker storage summary unavailable.'
fi
printf '\n%s\n' 'Running container count; no container names or configuration printed:'
if gridex_running_ids=$(docker ps --quiet); then
  if [ -z "$gridex_running_ids" ]; then
    printf '%s\n' '0'
  else
    printf '%s\n' "$gridex_running_ids" | /usr/bin/wc -l
  fi
else
  printf '%s\n' 'Running container count unavailable.'
fi
printf '\n%s\n' 'Preflight complete. Docker VM disk limit/location, Linux runner and migration remain unverified.'
