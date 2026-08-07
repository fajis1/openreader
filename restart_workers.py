import os
import signal
import subprocess

def restart():
    # Find python worker PIDs
    pids = subprocess.check_output(['pgrep', '-f', 'worker\.py']).decode().split()
    for pid in pids:
        print(f"Killing worker {pid}")
        os.kill(int(pid), signal.SIGTERM)
    print("Restarting next server...")
    # The Next.js dev server is running under pnpm dev. We can kill Next.js
    pids = subprocess.check_output(['pgrep', '-f', 'next dev']).decode().split()
    for pid in pids:
        print(f"Killing Next.js {pid}")
        os.kill(int(pid), signal.SIGTERM)

restart()
