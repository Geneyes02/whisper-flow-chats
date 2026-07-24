from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


runtime_path = Path("desktop/src-tauri/crypto-host/src/backend/openmls_runtime.rs")
runtime = runtime_path.read_text()

old_control = '''        let processed = group
            .process_message(&self.provider, protocol)
            .map_err(|_| {
                CryptoError::new(CryptoErrorCode::BadCiphertext, "control message validation")
            })?;
'''
new_control = '''        // OpenMLS 0.8.1 can panic internally when hostile ciphertext reaches
        // private-message decryption. Treat every inbound packet as attacker
        // controlled and contain that panic at Whispr's protocol boundary.
        let processed = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            group.process_message(&self.provider, protocol)
        })) {
            Ok(Ok(processed)) => processed,
            Ok(Err(_)) => {
                return Err(CryptoError::new(
                    CryptoErrorCode::BadCiphertext,
                    "control message validation",
                ))
            }
            Err(_) => {
                // Discard any in-memory provider mutation that may have happened
                // before the upstream panic. The last atomic snapshot is the
                // authoritative state and is restored fail-closed.
                self.restore_runtime()?;
                return Err(CryptoError::new(
                    CryptoErrorCode::BadCiphertext,
                    "control message authentication",
                ));
            }
        };
'''
runtime = replace_once(runtime, old_control, new_control, "control process_message")

old_application = '''        let processed = group
            .process_message(&self.provider, protocol)
            .map_err(|_| {
                CryptoError::new(CryptoErrorCode::BadCiphertext, "application validation")
            })?;
'''
new_application = '''        // Contain upstream OpenMLS panics caused by malformed/authentication-
        // failing private messages. A network peer must never be able to crash
        // the native Whispr process with ciphertext alone.
        let processed = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            group.process_message(&self.provider, protocol)
        })) {
            Ok(Ok(processed)) => processed,
            Ok(Err(_)) => {
                return Err(CryptoError::new(
                    CryptoErrorCode::BadCiphertext,
                    "application validation",
                ))
            }
            Err(_) => {
                self.restore_runtime()?;
                return Err(CryptoError::new(
                    CryptoErrorCode::BadCiphertext,
                    "application authentication",
                ));
            }
        };
'''
runtime = replace_once(runtime, old_application, new_application, "application process_message")

# Revocation must take precedence over argument validation so CryptoHost::status
# can reliably observe the backend's terminal DeviceRevoked state.
runtime = replace_once(
    runtime,
    '''        let _lock = self.mutation_lock.lock();
        if count == 0 || count > MAX_PREKEYS {
            return Err(CryptoError::new(
                CryptoErrorCode::InvalidBundle,
                "prekey count",
            ));
        }

        let id = self.require_identity()?;
''',
    '''        let _lock = self.mutation_lock.lock();
        let id = self.require_identity()?;
        if count == 0 || count > MAX_PREKEYS {
            return Err(CryptoError::new(
                CryptoErrorCode::InvalidBundle,
                "prekey count",
            ));
        }
''',
    "revocation precedence",
)
runtime_path.write_text(runtime)

seal_path = Path("desktop/src-tauri/crypto-host/src/local_seal.rs")
seal = seal_path.read_text()
seal = replace_once(
    seal,
    "    let nonce = Nonce::from_slice(&nonce_bytes);\n",
    '''    let nonce = Nonce::try_from(&nonce_bytes[..]).map_err(|_| {
        CryptoError::new(CryptoErrorCode::Internal, "local seal nonce length")
    })?;
''',
    "seal nonce",
)
seal = replace_once(
    seal,
    "        .encrypt(nonce, Payload { msg: plaintext, aad })\n",
    "        .encrypt(&nonce, Payload { msg: plaintext, aad })\n",
    "seal nonce borrow",
)
seal = replace_once(
    seal,
    "    let nonce = Nonce::from_slice(&blob[1..1 + NONCE_LEN]);\n",
    '''    let nonce = Nonce::try_from(&blob[1..1 + NONCE_LEN]).map_err(|_| {
        CryptoError::new(CryptoErrorCode::BadCiphertext, "local sealed nonce length")
    })?;
''',
    "open nonce",
)
seal = replace_once(
    seal,
    "            nonce,\n",
    "            &nonce,\n",
    "open nonce borrow",
)
seal_path.write_text(seal)

cargo_path = Path("desktop/src-tauri/Cargo.toml")
cargo = cargo_path.read_text()
cargo = replace_once(
    cargo,
    'panic = "abort"\n',
    '''# OpenMLS 0.8.1 contains private-message paths that can panic on hostile
# authentication failures. Whispr contains those panics at the crypto-host
# boundary, which requires unwind semantics in production builds.
panic = "unwind"
''',
    "release panic strategy",
)
cargo_path.write_text(cargo)

harness_path = Path("desktop/src-tauri/crypto-host/tests/harness.rs")
harness = harness_path.read_text()
for fn_name in [
    "stub_backend_refuses_to_encrypt",
    "stub_backend_refuses_to_establish_session",
    "stub_backend_passes_host_invariants",
]:
    marker = f"#[test]\nfn {fn_name}()"
    replacement = f'#[cfg(feature = "backend-stub")]\n#[test]\nfn {fn_name}()'
    if replacement not in harness:
        harness = replace_once(harness, marker, replacement, f"cfg {fn_name}")

openmls_test = '''
#[cfg(feature = "backend-openmls")]
#[test]
fn openmls_backend_passes_host_invariants() {
    let report = run_host_invariants(Capability::Messaging);
    if !report.all_passed() {
        for c in &report.checks {
            if !c.passed {
                eprintln!("FAIL {}: {} — {:?}", c.id, c.description, c.detail);
            }
        }
        panic!("OpenMLS backend failed host invariant conformance");
    }
    assert!(!report.backend.is_empty());
}
'''
if "fn openmls_backend_passes_host_invariants()" not in harness:
    harness += openmls_test
harness_path.write_text(harness)
