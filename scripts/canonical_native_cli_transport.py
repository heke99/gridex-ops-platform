"""Run only the synthetic native lifecycle's fixed CLI commands inside its network.

An internal Docker network deliberately has no operational published host port.
The official CLI therefore connects by the exact database container DNS name.
No repository checkout, hosted credentials or arbitrary command is mounted.
"""
import os
from pathlib import Path
import re
import stat


def cli_command(cli, work, project, arguments):
    if not re.fullmatch(r'gridex-sb-[a-f0-9]{12}-[a-f0-9]{16}', project):
        raise ValueError('EXACT_NATIVE_OWNER_REQUIRED')
    network = project+'-network'
    allowed = {
        ('--network-id', network, 'db', 'start'),
        ('migration', 'new', 'native_lifecycle_proof'),
        ('migration', 'new', 'native_rollback_proof'),
        ('migration', 'up', '--local'),
        ('stop', '--project-id', project, '--no-backup'),
    }
    if tuple(arguments) not in allowed:
        raise ValueError('FIXED_NATIVE_CLI_COMMAND_REQUIRED')
    work = Path(work)
    if (not work.is_absolute() or work.resolve() != work or not work.is_dir()
            or not work.name.startswith(project+'-') or work.stat().st_mode & 0o077):
        raise ValueError('PRIVATE_NATIVE_WORKSPACE_REQUIRED')
    executable = Path(cli).resolve(strict=True)
    backend = executable.with_name('supabase-go')
    if not executable.is_file() or not backend.is_file() or backend.is_symlink():
        raise ValueError('COMPLETE_OFFICIAL_CLI_BUNDLE_REQUIRED')
    socket = Path('/var/run/docker.sock')
    metadata = socket.stat()
    if not stat.S_ISSOCK(metadata.st_mode):
        raise ValueError('LOCAL_DOCKER_SOCKET_REQUIRED')
    args = ['docker', 'run', '--rm', '--name', project+'-cli',
            '--label', 'gridex.native.cli.owner='+project, '--network', network,
            '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
            '--user', f'{os.getuid()}:{os.getgid()}', '--group-add', str(metadata.st_gid),
            '--workdir', str(work)]
    for source, destination, readonly in (
            (executable, '/usr/local/bin/supabase', True),
            (backend, '/usr/local/bin/supabase-go', True),
            (work, str(work), False), (socket, str(socket), True)):
        args += ['--mount', f'type=bind,src={source},dst={destination}'+(',readonly' if readonly else '')]
    for key, value in {'HOME':str(work/'home'), 'XDG_CONFIG_HOME':str(work/'home/config'),
                       'CI':'true', 'SUPABASE_SERVICES_HOSTNAME':'supabase_db_'+project}.items():
        args += ['--env', key+'='+value]
    # The transport image supplies only glibc for the two official CLI binaries.
    # It never receives the historical SQL checkout or an external target.
    return args+['ubuntu:24.04', '/usr/local/bin/supabase', '--workdir', str(work), *arguments]
