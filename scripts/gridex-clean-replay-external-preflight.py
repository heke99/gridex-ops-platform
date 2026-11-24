#!/usr/bin/env python3
"""Admit only a local, empty database to the external clean replay."""
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from urllib.parse import parse_qsl, urlsplit, urlunsplit


def refuse(reason):
    print(reason, file=sys.stderr)
    raise SystemExit(1)


def verified_url(raw):
    try:
        if any(char in raw for char in ("\r", "\n", "\t")):
            refuse("external_replay_invalid_connection_url")
        parsed = urlsplit(raw)
        fields = parse_qsl(parsed.query, strict_parsing=True, keep_blank_values=True)
        parameters = dict(fields)
        if (
            parsed.scheme not in {"postgres", "postgresql"}
            or parsed.fragment
            or not re.fullmatch(r"/[^/]+", parsed.path)
            or len(fields) != len(parameters)
            or not parameters.keys() <= {"host", "port", "sslmode"}
        ):
            refuse("external_replay_invalid_connection_url")

        hostname = parsed.hostname
        port = parsed.port
        if "port" in parameters:
            if port is not None or not re.fullmatch(r"[0-9]{1,5}", parameters["port"]):
                refuse("external_replay_invalid_connection_url")
            port = int(parameters["port"])
        if port is not None and not 1 <= port <= 65535:
            refuse("external_replay_invalid_connection_url")

        if "host" in parameters:
            socket_dir = Path(parameters["host"])
            if hostname is not None or "," in parameters["host"] or not socket_dir.is_absolute():
                refuse("external_replay_local_database_required")
            socket = socket_dir / (".s.PGSQL." + str(port or 5432))
            if not stat.S_ISSOCK(socket.stat().st_mode):
                refuse("external_replay_local_database_required")
            return raw

        if hostname in {"127.0.0.1", "::1"}:
            return raw
        if hostname != "localhost":
            refuse("external_replay_local_database_required")
        # Pin localhost to loopback without consulting an external resolver.
        query = "&".join(filter(None, [parsed.query, "hostaddr=127.0.0.1"]))
        return urlunsplit(parsed._replace(query=query))
    except (ValueError, OSError):
        refuse("external_replay_invalid_connection_url")


def main():
    url = verified_url(os.environ.get("GRIDEX_REPLAY_DB_URL", ""))
    sql = """
        BEGIN READ ONLY;
        SET LOCAL search_path = pg_catalog;
        SELECT CASE WHEN
          NOT EXISTS(SELECT FROM pg_namespace
            WHERE nspname NOT IN ('public','pg_catalog','information_schema','pg_toast')
              AND NOT starts_with(nspname,'pg_temp_')
              AND NOT starts_with(nspname,'pg_toast_temp_'))
          AND NOT EXISTS(SELECT FROM pg_class WHERE relnamespace='public'::regnamespace)
          AND NOT EXISTS(SELECT FROM pg_proc WHERE pronamespace='public'::regnamespace)
          AND NOT EXISTS(SELECT FROM pg_type WHERE typnamespace='public'::regnamespace)
          THEN 'empty' ELSE 'occupied' END;
        ROLLBACK;
    """
    try:
        result = subprocess.run(
            ["psql", url, "-XAtqw", "-v", "ON_ERROR_STOP=1", "-c", sql],
            capture_output=True, text=True, timeout=10, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        refuse("external_replay_catalogue_unavailable")
    if result.returncode != 0:
        refuse("external_replay_catalogue_unavailable")
    if result.stdout.strip() != "empty":
        refuse("external_replay_application_catalogue_not_empty")
    # The caller reads this value into a variable. Never write it to the log.
    print(url)


if __name__ == "__main__":
    main()
