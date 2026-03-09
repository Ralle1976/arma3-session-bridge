//! native_ping.rs — Native Windows ICMP ping using the IcmpSendEcho API.
//!
//! Replaces a `ping.exe` subprocess with a direct call to the Windows IP
//! Helper API (`iphlpapi.dll`).  Does **not** require administrator elevation.
//!
//! Platform behaviour
//! ------------------
//! - **Windows**: calls `IcmpCreateFile` / `IcmpSendEcho` / `IcmpCloseHandle`
//!   via `windows-sys`.
//! - **Other platforms**: all functions are no-ops that return `None`.

use std::net::Ipv4Addr;

// ── Windows implementation ────────────────────────────────────────────────────

#[cfg(windows)]
use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;

#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::IpHelper::{
    IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY,
};

/// Perform a native ICMP ping to an IPv4 address.
///
/// Returns the round-trip time in **milliseconds**, or `None` if the host is
/// unreachable or the timeout expires.
///
/// # Parameters
/// * `addr`       — Target IPv4 address.
/// * `timeout_ms` — How long to wait for a reply, in milliseconds.
///
/// # Safety
/// This function is `safe` from the caller's perspective.  Internally it uses
/// `unsafe` Windows API calls guarded by `#[cfg(windows)]`.
#[cfg(windows)]
pub fn ping(addr: Ipv4Addr, timeout_ms: u32) -> Option<u64> {
    unsafe {
        // Open an ICMP handle (one per ping sequence; cheap to create/close).
        let handle = IcmpCreateFile();
        if handle == INVALID_HANDLE_VALUE {
            return None;
        }

        // IcmpSendEcho expects the destination as a 32-bit integer in
        // **network byte order** (big-endian).
        let ip_addr: u32 = u32::from(addr).to_be();

        // 32-byte payload — same default as ping.exe.
        let send_data = [b'a'; 32];

        // Reply buffer must hold at least one ICMP_ECHO_REPLY plus the
        // echoed data plus 8 bytes of ICMP overhead.
        let reply_size =
            std::mem::size_of::<ICMP_ECHO_REPLY>() + send_data.len() + 8;
        let mut reply_buf = vec![0u8; reply_size];

        let ret = IcmpSendEcho(
            handle,
            ip_addr,
            send_data.as_ptr() as *mut _,
            send_data.len() as u16,
            std::ptr::null_mut(), // IP options (none)
            reply_buf.as_mut_ptr() as *mut _,
            reply_size as u32,
            timeout_ms,
        );

        IcmpCloseHandle(handle);

        if ret > 0 {
            // Interpret the first bytes of reply_buf as ICMP_ECHO_REPLY.
            let reply = &*(reply_buf.as_ptr() as *const ICMP_ECHO_REPLY);
            // Status == 0 means IP_SUCCESS.
            if reply.Status == 0 {
                Some(reply.RoundTripTime as u64)
            } else {
                None
            }
        } else {
            None
        }
    }
}

// ── Non-Windows stub ──────────────────────────────────────────────────────────

/// No-op stub for non-Windows targets.  Always returns `None`.
#[cfg(not(windows))]
pub fn ping(_addr: Ipv4Addr, _timeout_ms: u32) -> Option<u64> {
    None
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/// Ping with a default 3-second timeout.
///
/// Equivalent to `ping(addr, 3000)`.
pub fn ping_default(addr: Ipv4Addr) -> Option<u64> {
    ping(addr, 3_000)
}

/// Ping up to `attempts` times, returning the lowest RTT observed.
///
/// Returns `None` if all attempts time out or fail.
pub fn ping_best_of(addr: Ipv4Addr, timeout_ms: u32, attempts: u8) -> Option<u64> {
    (0..attempts)
        .filter_map(|_| ping(addr, timeout_ms))
        .reduce(u64::min)
}
