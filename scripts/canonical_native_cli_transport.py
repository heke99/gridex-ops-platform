"""Run the native lifecycle's finite CLI commands inside its owned network.

An internal Docker network deliberately has no operational published host port.
The official CLI therefore connects by the exact database container DNS name.
No repository checkout, hosted credentials or arbitrary command is mounted.
The historical entry admits first43 and the exact atomic44-52 and53-56 unit shapes.
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
        ('--network-id', network, 'gen', 'types', '--local', '--lang', 'typescript', '--schema', 'public'),
        ('migration', 'new', 'native_lifecycle_proof'),
        ('migration', 'new', 'native_rollback_proof'),
        ('migration', 'up', '--local'),
        ('stop', '--project-id', project, '--no-backup'),
    }
    historical_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                       and re.fullmatch(r'gridex_native_f(?:000[1-9]|00[1-3][0-9]|004[0-3])_[a-f0-9]{12}', arguments[2]))
    legacy_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                   and re.fullmatch(r'gridex_native_f0044_0052_[a-f0-9]{12}', arguments[2]))
    repair_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                   and re.fullmatch(r'gridex_native_f0053_0056_[a-f0-9]{12}', arguments[2]))
    dedupe_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                   and re.fullmatch(r'gridex_native_f0057_[a-f0-9]{12}', arguments[2]))
    fixed_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                  and re.fullmatch(r'gridex_native_(?:f00(?:58|59|60|61|62|63)|fixed_constructor)_[a-f0-9]{12}', arguments[2]))
    alignment_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                      and re.fullmatch(r'gridex_native_f0064_0068_[a-f0-9]{12}', arguments[2]))
    operations_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                       and re.fullmatch(r'gridex_native_f(?:0069_0071|0072_0074|0075_0077)_[a-f0-9]{12}', arguments[2]))
    foundation_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                       and re.fullmatch(r'gridex_native_foundation_0[1-7]_[a-f0-9]{12}', arguments[2]))
    timestamp_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                      and re.fullmatch(r'gridex_native_t(?:000[1-9]|00[1-9][0-9]|0[1-4][0-9]{2}|050[0-9]|051[0-4])_(?:p0[12]|prerequisite|cleanup)_[a-f0-9]{12}', arguments[2]))
    forward_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                    and re.fullmatch(r'gridex_native_forward_0[1-9]_[a-f0-9]{12}', arguments[2]))
    cleanup_name = (len(arguments) == 3 and tuple(arguments[:2]) == ('migration', 'new')
                    and re.fullmatch(r'gridex_native_probe_cleanup_[a-f0-9]{12}', arguments[2]))
    if tuple(arguments) not in allowed and not historical_name and not legacy_name and not repair_name and not dedupe_name and not fixed_name and not alignment_name and not operations_name and not foundation_name and not timestamp_name and not forward_name and not cleanup_name:
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
