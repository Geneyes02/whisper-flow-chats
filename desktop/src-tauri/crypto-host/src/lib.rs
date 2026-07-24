//! # whispr-crypto-host
//!
//! The Whispr native crypto host. This crate owns every private key on the
//! device and is the ONLY component allowed to link against a cryptographic
//! messaging protocol implementation.
//!
//! ## Architectural contract
//!
//! * The Whispr application (Tauri app, UI, messaging layer) MUST NOT depend
//!   on any concrete cryptographic library directly. It depends on this
//!   crate's public [`api`] surface and nothing else.
//! * The concrete backend is selected at build time via Cargo features
//!   (`backend-stub`, `backend-libsignal`). The `CryptoBackend` trait is
//!   the seam.
//! * Private keys never cross the crate boundary. Every public type in
//!   [`types`] is safe to send across the Tauri IPC boundary into the
//!   WebView.
//! * Errors are mapped through [`error::CryptoError`] with stable codes.
//!   Backend-specific error internals are erased before crossing the
//!   boundary. Fail-closed: unknown errors become `Unsupported`.
//!
//! ## Data map
//!
//! See `docs/DATA_MAP.md` for the authoritative list of what is stored
//! where (OS keychain, in-memory only, Whispr Cloud, local encrypted state).
//!
//! ## Conformance
//!
//! Every backend (stub, libsignal, MLS, …) MUST pass the backend-agnostic
//! conformance suite defined in [`conformance`]. Whispr will not use a
//! backend that fails the suite.

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod api;
pub mod backend;
pub mod conformance;
pub mod error;
pub mod keychain;
pub mod storage;
pub mod types;

pub use api::{BackendInfo, CryptoHost, HostStatus, LockState, ProvisioningState};
pub use error::{CryptoError, CryptoErrorCode};
pub use types::*;

// Compile-time guard: exactly one backend must be selected. This prevents
// an accidental "no backend" build that would silently be non-functional.
#[cfg(not(any(
    feature = "backend-stub",
    feature = "backend-libsignal",
    feature = "backend-openmls"
)))]
compile_error!(
    "whispr-crypto-host: no backend feature selected. \
     Enable exactly one of `backend-stub`, `backend-libsignal`, or `backend-openmls`."
);
