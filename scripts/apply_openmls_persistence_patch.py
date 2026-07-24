from pathlib import Path


def replace_once(src: str, old: str, new: str) -> str:
    count = src.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match, found {count}: {old[:120]!r}")
    return src.replace(old, new, 1)


p = Path("desktop/src-tauri/crypto-host/src/backend/openmls_runtime.rs")
s = p.read_text()

s = replace_once(
    s,
    '''        group
            .merge_pending_commit(&self.provider)
            .map_err(|_| CryptoError::internal("merge add commit"))?;

        let welcome_bytes''',
    '''        group
            .merge_pending_commit(&self.provider)
            .map_err(|_| CryptoError::internal("merge add commit"))?;
        group
            .save(self.provider.storage())
            .map_err(|_| CryptoError::internal("group save after add"))?;

        let welcome_bytes''',
)

s = replace_once(
    s,
    '''        let group = staged
            .into_group(&self.provider)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "welcome join"))?;

        let expected_group_id''',
    '''        let group = staged
            .into_group(&self.provider)
            .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "welcome join"))?;
        group
            .save(self.provider.storage())
            .map_err(|_| CryptoError::internal("group save after welcome"))?;

        let expected_group_id''',
)

s = replace_once(
    s,
    '''            ProcessedMessageContent::StagedCommitMessage(staged_commit) => group
                .merge_staged_commit(&self.provider, *staged_commit)
                .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "commit merge")),''',
    '''            ProcessedMessageContent::StagedCommitMessage(staged_commit) => {
                group
                    .merge_staged_commit(&self.provider, *staged_commit)
                    .map_err(|_| CryptoError::new(CryptoErrorCode::BadCiphertext, "commit merge"))?;
                group
                    .save(self.provider.storage())
                    .map_err(|_| CryptoError::internal("group save after commit"))
            },''',
)

s = replace_once(
    s,
    '''        group
            .merge_pending_commit(&self.provider)
            .map_err(|_| CryptoError::internal("merge self update"))?;
        let bytes''',
    '''        group
            .merge_pending_commit(&self.provider)
            .map_err(|_| CryptoError::internal("merge self update"))?;
        group
            .save(self.provider.storage())
            .map_err(|_| CryptoError::internal("group save after self update"))?;
        let bytes''',
)

s = replace_once(
    s,
    '''        if !envelope.message_id.is_empty() {
            metadata.seen_message_ids.push(envelope.message_id.clone());''',
    '''        group
            .save(self.provider.storage())
            .map_err(|_| CryptoError::internal("group save after receive"))?;

        if !envelope.message_id.is_empty() {
            metadata.seen_message_ids.push(envelope.message_id.clone());''',
)

p.write_text(s)
