#!/bin/sh
# Dedicated development daemon; never addresses the distro's default Docker socket.
set -eu
base=${NUVEX_WSL_DOCKER_HOME:-/home/impaul/.cache/nuvex/docker}
export PATH="$base/tools/usr/bin:$PATH"
export DOCKER_CONFIG="$base/client"
export DOCKER_HOST="unix://$base/run/docker.sock"
case "${1:-}" in
  start-daemon)
    if docker info >/dev/null 2>&1; then exit 0; fi
    test -x "$base/tools/usr/bin/dockerd"
    mkdir -p "$base/run" "$base/data" "$base/client"
    chmod 700 "$base"
    if [ ! -f "$base/daemon.json" ]; then
      cat > "$base/daemon.json" <<EOF
{"data-root":"$base/data","exec-root":"$base/run/exec","pidfile":"$base/run/dockerd.pid","hosts":["unix://$base/run/docker.sock"],"group":"root","bip":"172.29.250.1/24","default-address-pools":[{"base":"172.29.252.0/22","size":24}],"storage-driver":"overlay2","log-driver":"local"}
EOF
    fi
    nohup dockerd --config-file "$base/daemon.json" > "$base/daemon.log" 2>&1 < /dev/null &
    attempt=0
    until docker info >/dev/null 2>&1; do
      attempt=$((attempt + 1))
      if [ "$attempt" -ge 40 ]; then echo "Private daemon did not become ready; inspect $base/daemon.log" >&2; exit 1; fi
      sleep 1
    done
    docker version --format '{{.Server.Version}}'
    ;;
  status-daemon)
    docker info --format 'Docker {{.ServerVersion}}; data root {{.DockerRootDir}}; driver {{.Driver}}'
    ;;
  stop-daemon)
    test -f "$base/run/dockerd.pid"
    daemon_pid=$(cat "$base/run/dockerd.pid")
    case "$daemon_pid" in ''|*[!0-9]*) echo 'Invalid private PID file' >&2; exit 1;; esac
    command_line=$(tr '\000' ' ' < "/proc/$daemon_pid/cmdline")
    case "$command_line" in *"dockerd --config-file $base/daemon.json"*) kill -TERM "$daemon_pid";; *) echo 'PID does not belong to this daemon; refusing to stop it' >&2; exit 1;; esac
    ;;
  *) exec docker "$@" ;;
esac
