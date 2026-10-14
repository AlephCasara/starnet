#!/usr/bin/env node
// One-shot guarded follow-up for external-sidecar ownership. Every replacement must
// match exactly once; the workflow refuses to commit on drift. Removed after use.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src-tauri/src/main.rs';
let source = readFileSync(file, 'utf8');

function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`patch ${label}: source anchor not found`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`patch ${label}: source anchor is not unique`);
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
}

replaceOnce(
`// ---- Tauri commands (called from the frontend Harness seam) ----

/// Store (or, for an empty value, clear) the BYOK key in the OS keychain, then push it`,
`// ---- Tauri commands (called from the frontend Harness seam) ----

fn require_desktop_owned_credentials(state: &AppState) -> Result<(), String> {
    if state.sidecar_ownership.is_external() {
        return Err("this StarNet station is externally managed; configure its credentials through the station supervisor rather than this desktop shell".to_string());
    }
    Ok(())
}

/// Store (or, for an empty value, clear) the BYOK key in the OS keychain, then push it`,
'credential ownership helper');

replaceOnce(
`fn harness_store_key(key: String, state: State<AppState>) -> Result<(), String> {
    let entry = keychain_entry().map_err(|e| e.to_string())?;`,
`fn harness_store_key(key: String, state: State<AppState>) -> Result<(), String> {
    require_desktop_owned_credentials(state.inner())?;
    let entry = keychain_entry().map_err(|e| e.to_string())?;`,
'BYOK guard');

replaceOnce(
`) -> Result<(), String> {
    let provider_id = normalize_provider(&provider);
    let key_trimmed = key.as_ref().map(|k| k.trim().to_string());`,
`) -> Result<(), String> {
    require_desktop_owned_credentials(state.inner())?;
    let provider_id = normalize_provider(&provider);
    let key_trimmed = key.as_ref().map(|k| k.trim().to_string());`,
'provider config guard');

replaceOnce(
`) -> Result<usize, String> {
    let provider_id = normalize_provider(&provider);
    if !KEYCHAIN_PROVIDERS.contains(&provider_id) {`,
`) -> Result<usize, String> {
    require_desktop_owned_credentials(state.inner())?;
    let provider_id = normalize_provider(&provider);
    if !KEYCHAIN_PROVIDERS.contains(&provider_id) {`,
'provider pool guard');

replaceOnce(
`fn harness_adopt_credits_token(state: State<AppState>) -> bool {
    migrate_credits_token_from_plaintext(&state.workspaces)
}`,
`fn harness_adopt_credits_token(state: State<AppState>) -> bool {
    if state.sidecar_ownership.is_external() {
        return false;
    }
    migrate_credits_token_from_plaintext(&state.workspaces)
}`,
'credits adoption guard');

replaceOnce(
`#[tauri::command]
fn harness_clear_credits_token() -> Result<(), String> {
    let entry = credits_keychain_entry().map_err(|e| e.to_string())?;`,
`#[tauri::command]
fn harness_clear_credits_token(state: State<AppState>) -> Result<(), String> {
    require_desktop_owned_credentials(state.inner())?;
    let entry = credits_keychain_entry().map_err(|e| e.to_string())?;`,
'credits clear guard');

replaceOnce(
`) -> Result<(), String> {
    let channel = channel.trim().to_ascii_lowercase();
    let trimmed = token.trim();`,
`) -> Result<(), String> {
    require_desktop_owned_credentials(state.inner())?;
    let channel = channel.trim().to_ascii_lowercase();
    let trimmed = token.trim();`,
'channel token guard');

writeFileSync(file, source);
console.log('external-sidecar credential ownership guards applied');
