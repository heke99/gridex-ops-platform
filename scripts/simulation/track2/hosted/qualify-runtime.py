#!/usr/bin/env python3
"""Host observations and pure capacity contracts; never a native admission authority."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess

GIB = 1024 ** 3
DRIVERS = {"overlay2": 15 * GIB, "overlayfs": 15 * GIB, "vfs": 40 * GIB}


def positive_integer(value):
    return type(value) is int and value > 0


def capacity_errors(observation):
    """Evaluate measured inputs only. Passing does not authenticate their origin."""
    errors = []
    driver = observation.get("driver")
    if driver not in DRIVERS:
        errors.append("unknown-driver")
    ram = observation.get("effectiveRAMBytes")
    if not positive_integer(ram) or ram < 8 * GIB:
        errors.append("insufficient-or-unknown-ram")
    free = observation.get("dockerRootFreeBytes")
    if not positive_integer(free) or (driver in DRIVERS and free < DRIVERS[driver]):
        errors.append("insufficient-or-unknown-docker-root-free")
    if not observation.get("dockerRootDir") or observation.get("rootNamespaceVerified") is not True:
        errors.append("docker-root-namespace-unverified")
    if not observation.get("daemonId") or not observation.get("socketIdentity"):
        errors.append("daemon-or-socket-identity-missing")
    if not observation.get("cpuQuota"):
        errors.append("cpu-quota-unrecorded")
    return errors


def read_text(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None


def observe_host():
    physical = os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
    limits = [physical]
    # Walk visible cgroup ancestors, preserving every finite inherited limit.
    cgroup = Path("/sys/fs/cgroup")
    membership = read_text("/proc/self/cgroup") or ""
    relative = next((line[3:] for line in membership.splitlines() if line.startswith("0::")), "/")
    current = cgroup / relative.lstrip("/")
    while current == cgroup or cgroup in current.parents:
        raw = read_text(current / "memory.max")
        if raw and raw.isdigit():
            limits.append(int(raw))
        if current == cgroup:
            break
        current = current.parent
    result = {"schema": "gridex-t2-host-observation-v1", "state": "OBSERVED_NOT_ADMITTED",
              "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "effectiveRAMBytes": min(limits), "cpuQuota": read_text("/sys/fs/cgroup/cpu.max"),
              "cpuCount": os.cpu_count(), "rootNamespaceVerified": False}
    # Select only non-secret fields; never emit environment, Docker config or full info.
    try:
        info = subprocess.run(["docker", "info", "--format", "{{json .}}"],
                              capture_output=True, text=True, timeout=15, check=True)
        data = json.loads(info.stdout)
        result.update(driver=data.get("Driver"), daemonId=data.get("ID"),
                      dockerRootDir=data.get("DockerRootDir"), serverVersion=data.get("ServerVersion"))
        daemon_memory = data.get("MemTotal")
        if positive_integer(daemon_memory):
            result["effectiveRAMBytes"] = min(result["effectiveRAMBytes"], daemon_memory)
        # A daemon can be remote or in another mount namespace: no statvfs guess.
        result["dockerRootFreeBytes"] = None
    except (OSError, subprocess.SubprocessError, ValueError):
        result["dockerObservationError"] = "docker-info-unavailable"
    try:
        stat = Path("/var/run/docker.sock").stat()
        result["socketIdentity"] = {"device": stat.st_dev, "inode": stat.st_ino}
    except OSError:
        result["socketIdentity"] = None
    result["capacityErrors"] = capacity_errors(result)
    return result


def admission_errors(profile):
    # No amount of caller-authored JSON constitutes authenticated native proof.
    errors = ["native-admission-not-implemented"]
    if profile.get("state") != "SOURCE_ONLY_NOT_ADMITTED" or profile.get("provisioned") is not False:
        errors.append("profile-must-not-claim-active-or-provisioned")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observe-host", action="store_true")
    args = parser.parse_args()
    if args.observe_host:
        print(json.dumps(observe_host(), sort_keys=True))
        return 78  # observation is not admission, even on a sufficiently large host
    profile = json.loads(Path(__file__).with_name("profile.requirements.json").read_text())
    print(json.dumps({"state": "HOLD", "errors": admission_errors(profile),
                      "missingGates": profile["unimplementedGates"]}, sort_keys=True))
    return 78


if __name__ == "__main__":
    raise SystemExit(main())
