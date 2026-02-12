use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHasher};
use std::io::{self, Write};

fn main() {
    print!("Enter admin token: ");
    io::stdout().flush().unwrap();

    let mut token = String::new();
    io::stdin().read_line(&mut token).unwrap();
    let token = token.trim();

    if token.is_empty() {
        eprintln!("Token cannot be empty");
        std::process::exit(1);
    }

    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(token.as_bytes(), &salt)
        .expect("Failed to hash token");

    println!("\nADMIN_TOKEN_HASH={hash}");
}
