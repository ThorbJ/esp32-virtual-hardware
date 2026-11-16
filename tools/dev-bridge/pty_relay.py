#!/usr/bin/env python3
"""Pseudo-terminal helper of the development bridge (Python standard library only; device independent).

Makes a pty pair and links the slave end to a fixed path, so a computer-side program that only knows serial ports opens it
as the device's USB serial port; bytes of the master end are relayed to and from this process's stdin/stdout (bridge.mjs).

    python3 pty_relay.py <link path>

- stdout: raw bytes read from the master (computer -> device). stdin: raw bytes to write to it (device -> computer).
- stderr: one JSON event per line (ready / dropped / exit).
- This process keeps the slave open, so the program closing and reopening the port does not give the master EOF.
- The kernel buffer of a pty is small (about 1 KB): bytes from the device queue here and are written when there is room,
  never dropped in the middle of a frame (dropping makes framed protocols fail their CRC). If the program does not read for
  long and more than 256 KB pile up, the backlog is dropped whole (like a real USB device with no host reading).
- When stdin closes (the bridge stops) the link is removed and the process exits.
"""
import errno
import json
import os
import select
import signal
import sys
import tty


BACKLOG_LIMIT = 256 * 1024


def event(**kw):
    sys.stderr.write(json.dumps(kw, ensure_ascii=False) + "\n")
    sys.stderr.flush()


def main():
    if len(sys.argv) != 2:
        sys.stderr.write(__doc__)
        return 2
    link = os.path.abspath(sys.argv[1])
    # also remove the link (finally) when terminated (bridge killed, Ctrl+C)
    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(sig, lambda *_: sys.exit(0))
    master, slave = os.openpty()
    tty.setraw(slave)  # raw mode: no echo, no newline translation; binary frames pass unchanged
    name = os.ttyname(slave)
    os.makedirs(os.path.dirname(link), exist_ok=True)
    try:
        os.unlink(link)
    except FileNotFoundError:
        pass
    os.symlink(name, link)
    os.set_blocking(master, False)
    event(event="ready", tty=name, link=link)

    stdin = sys.stdin.fileno()
    stdout = sys.stdout.fileno()
    # pty buffer is about 1 KB: queue device -> computer bytes, write when writable, never drop mid-frame;
    # drop the whole backlog only when it passes the limit (the program resynchronises on frame headers).
    pending = bytearray()
    dropped = 0
    try:
        while True:
            writers = [master] if pending else []
            readable, writable, _ = select.select([master, stdin], writers, [], 1.0)
            if master in readable:
                try:
                    data = os.read(master, 65536)
                except OSError as e:
                    if e.errno not in (errno.EAGAIN, errno.EIO):
                        raise
                    data = b""
                if data:
                    os.write(stdout, data)
            if stdin in readable:
                data = os.read(stdin, 65536)
                if not data:
                    break
                if len(pending) + len(data) > BACKLOG_LIMIT:
                    if dropped == 0:
                        event(event="dropped", reason="the program is not reading the port: dropped the queued device bytes")
                    dropped += len(pending) + len(data)
                    pending.clear()
                else:
                    pending += data
            if master in writable and pending:
                try:
                    n = os.write(master, pending)
                except OSError as e:
                    if e.errno != errno.EAGAIN:
                        raise
                    n = 0
                del pending[:n]
                if n and dropped:
                    event(event="resumed", dropped=dropped)
                    dropped = 0
    finally:
        try:
            if os.path.islink(link) and os.readlink(link) == name:
                os.unlink(link)
        except OSError:
            pass
        event(event="exit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
