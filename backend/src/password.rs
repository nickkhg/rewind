//! Argon2 hashing for the two secrets a person types: the admin token and a board password.
//!
//! Both take the same treatment, because the reason is the same — what the database keeps must
//! not read back as the word someone typed. The work happens on a blocking thread: Argon2 spends
//! tens of milliseconds of CPU on purpose, and a board password is checked at every join, so the
//! async runtime must not sit and wait for it.

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, SaltString};
use argon2::{Argon2, PasswordHasher, PasswordVerifier};

use crate::error::AppError;

fn internal() -> AppError {
    AppError::Internal("Internal server error".to_string())
}

/// Hashes a secret into the string the database keeps. The salt is new every time, so the same
/// password on two boards gives two hashes.
pub async fn hash(secret: String) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(secret.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| {
                tracing::error!("could not hash a secret: {e}");
                internal()
            })
    })
    .await
    .map_err(|e| {
        tracing::error!("hash task failed: {e}");
        internal()
    })?
}

/// Tells whether a secret matches a stored hash. A wrong secret gives `false`; only a hash that
/// will not parse is an error, because that one is our fault and not the caller's.
pub async fn verify(secret: String, stored: String) -> Result<bool, AppError> {
    tokio::task::spawn_blocking(move || {
        let parsed = PasswordHash::new(&stored).map_err(|e| {
            tracing::error!("stored hash will not parse: {e}");
            internal()
        })?;
        Ok(Argon2::default()
            .verify_password(secret.as_bytes(), &parsed)
            .is_ok())
    })
    .await
    .map_err(|e| {
        tracing::error!("verify task failed: {e}");
        internal()
    })?
}
