from __future__ import annotations

import socket
import time
from dataclasses import dataclass

A2S_INFO_PACKET = b"\xFF\xFF\xFF\xFFTSource Engine Query\x00"


@dataclass(slots=True)
class HostProbeResult:
    reachable: bool
    latency_ms: int | None = None
    error: str | None = None


def probe_udp(host: str, port: int, timeout_seconds: float = 1.2) -> HostProbeResult:
    started = time.perf_counter()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.settimeout(timeout_seconds)
        sock.sendto(A2S_INFO_PACKET, (host, port))
        payload, _addr = sock.recvfrom(4096)
        if not payload:
            return HostProbeResult(reachable=False, error="empty response")

        latency = int((time.perf_counter() - started) * 1000)
        return HostProbeResult(reachable=True, latency_ms=latency)
    except socket.timeout:
        return HostProbeResult(reachable=False, error="timeout")
    except OSError as exc:
        return HostProbeResult(reachable=False, error=str(exc))
    finally:
        sock.close()
