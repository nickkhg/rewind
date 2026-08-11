//! Entra sign-in, for the deployments that ask for it.
//!
//! A board is reachable by whoever holds its link. That is right for a team that runs a retro in a
//! room, and wrong for a company that wants the tool behind the same door as everything else. So a
//! deployment can name an Entra app registration, and the server then puts the whole of itself
//! behind a work account: the REST routes, the socket, and the built frontend it serves. Name
//! nothing and the server stays as open as it was, which is what `cargo run` and the desktop app
//! rely on.
//!
//! **The server runs the flow, not the browser.** This is the OIDC authorization code flow with
//! PKCE, driven from here: the client secret belongs to a confidential client and never reaches the
//! page. What the browser holds is one cookie this server wrote, encrypted and signed with a key
//! only this server has, so a reader can neither read their own name out of it nor write someone
//! else's in.
//!
//! **Authentication, not authorisation.** Anyone in the tenant gets in — the same bar as the other
//! internal tools. Once past the door, the board decides what a person may do exactly as it did
//! before: the facilitator token, the editor list, the board password. Signing in tells Rewind who
//! you are; it does not make you the facilitator of anything.

use std::sync::Arc;
use std::time::{Duration as StdDuration, Instant};

use axum::extract::{Query, Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, Key, PrivateCookieJar, SameSite};
use chrono::Utc;
use openidconnect::core::{
    CoreAuthenticationFlow, CoreClient, CoreIdTokenClaims, CoreProviderMetadata,
};
use openidconnect::reqwest;
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha512};
use time::Duration as CookieDuration;
use tokio::sync::RwLock;
use url::Url;

use crate::error::AppError;
use crate::state::AppState;

/// The cookie that says who you are.
const SESSION_COOKIE: &str = "rewind_session";

/// The cookie that holds the one-time values of a sign-in in flight — the CSRF state, the nonce,
/// the PKCE verifier, and where the person was going before the door stopped them.
const LOGIN_COOKIE: &str = "rewind_login";

/// How long a sign-in lasts. A working day, so that nobody is sent to Entra twice in one.
const SESSION_HOURS: i64 = 12;

/// How long a sign-in has to finish before the values it started with are thrown away.
const LOGIN_MINUTES: i64 = 15;

/// How long the discovery document is kept. Entra rotates the keys that sign an id_token, and the
/// keys arrive with the document, so a process that asked once at startup and never again would one
/// day stop being able to read one.
const METADATA_TTL: StdDuration = StdDuration::from_secs(60 * 60);

/// Where the browser is sent to start a sign-in. The frontend uses the same path.
pub const LOGIN_PATH: &str = "/api/auth/login";

/// Who the person signed in as.
///
/// It lives in the session cookie, and the gate puts it on every request it lets through, so a
/// handler that wants the caller's name asks for `Extension<Identity>` and never re-reads a cookie.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Identity {
    /// The subject of the id_token — the account, not the person's name, which can change. Nothing
    /// keys off it yet; it is here so that a later change can tie a board to an account.
    pub sub: String,
    /// What a board shows: the display name from Entra.
    pub name: String,
    /// The user principal name. Entra leaves `email` out of a v2 id_token unless the app
    /// registration adds it as an optional claim, so `preferred_username` stands in — that one is
    /// always there.
    pub email: Option<String>,
    /// When the sign-in runs out. The cookie carries a Max-Age as well, but that one is the
    /// browser's to honour or ignore, so the time is inside the cookie too and read from there.
    pub expires_at: i64,
}

/// What the frontend is told about the door. `user` is always there when `enabled` is true, because
/// the request that asked came through the gate.
#[derive(Debug, Serialize)]
pub struct AuthConfig {
    pub enabled: bool,
    pub user: Option<Identity>,
}

/// The one-time values of a sign-in in flight, kept in a cookie rather than in server memory so
/// that a restart mid-sign-in costs one retry and not a session, and so that two replicas need
/// share nothing.
#[derive(Serialize, Deserialize)]
struct LoginState {
    csrf: String,
    nonce: String,
    pkce_verifier: String,
    /// Where to send the browser once it is back. A path on this server, never a URL.
    redirect_to: String,
}

/// The app registration this server signs people in with.
pub struct EntraAuth {
    client_id: ClientId,
    client_secret: ClientSecret,
    tenant_id: String,
    issuer: IssuerUrl,
    /// The origin the browser reaches this server on, when the deployment names it. Left out, each
    /// request names its own.
    public_url: Option<String>,
    http: reqwest::Client,
    metadata: RwLock<Option<(Instant, CoreProviderMetadata)>>,
    /// The key the two cookies are encrypted with.
    key: Key,
}

impl EntraAuth {
    /// Reads the deployment's three values. `None` — all three unset — leaves the server open.
    ///
    /// Half a configuration stops the server instead. An operator who set a client id meant to put
    /// a door on this deployment, and starting anyway would serve every board to anyone while
    /// looking configured.
    pub fn from_env() -> Option<Arc<Self>> {
        let client_id = env_value("ENTRA_CLIENT_ID");
        let client_secret = env_value("ENTRA_CLIENT_SECRET");
        let tenant_id = env_value("ENTRA_TENANT_ID");

        match (client_id, client_secret, tenant_id) {
            (None, None, None) => None,
            (Some(client_id), Some(client_secret), Some(tenant_id)) => {
                let issuer = IssuerUrl::new(format!(
                    "https://login.microsoftonline.com/{tenant_id}/v2.0"
                ))
                .expect("ENTRA_TENANT_ID does not make a usable issuer URL");

                // Following redirects on a server-side HTTP client is how an SSRF starts, and the
                // token endpoint has no reason to redirect us.
                let http = reqwest::ClientBuilder::new()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .expect("could not build the HTTP client for Entra sign-in");

                // The cookie key is derived from the client secret, so it needs no fourth value and
                // it is the same on every replica and across a restart — a rolling deployment does
                // not sign the room out. Rotating the secret in Entra ends the open sessions, which
                // is what rotating a secret is for. `derive_from` wants 64 bytes and a client
                // secret is shorter, so the digest of it is what goes in.
                let key = Key::derive_from(&Sha512::digest(client_secret.as_bytes()));

                tracing::info!("Entra sign-in enabled for tenant {tenant_id}");

                Some(Arc::new(Self {
                    client_id: ClientId::new(client_id),
                    client_secret: ClientSecret::new(client_secret),
                    tenant_id,
                    issuer,
                    public_url: env_value("PUBLIC_URL").map(|u| u.trim_end_matches('/').to_string()),
                    http,
                    metadata: RwLock::new(None),
                    key,
                }))
            }
            _ => panic!(
                "Entra sign-in is half configured. ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET and \
                 ENTRA_TENANT_ID must all be set, or all be empty. Refusing to start rather than \
                 serving every board to anyone on a deployment that asked for a door."
            ),
        }
    }

    /// The discovery document, from the cache when it is fresh enough.
    async fn metadata(&self) -> Result<CoreProviderMetadata, AppError> {
        {
            let cached = self.metadata.read().await;
            if let Some((fetched, metadata)) = cached.as_ref() {
                if fetched.elapsed() < METADATA_TTL {
                    return Ok(metadata.clone());
                }
            }
        }

        let metadata = CoreProviderMetadata::discover_async(self.issuer.clone(), &self.http)
            .await
            .map_err(|e| {
                tracing::error!("could not read the Entra discovery document: {e}");
                AppError::Internal("Sign-in is not available right now".to_string())
            })?;

        *self.metadata.write().await = Some((Instant::now(), metadata.clone()));
        Ok(metadata)
    }

    /// The origin the browser reached this server on.
    ///
    /// `PUBLIC_URL` settles it when the deployment says so. Otherwise the request does, from the
    /// headers the ingress sets. Reading a header here is safe in the one place it matters: Entra
    /// refuses any redirect URI that is not on the app registration, so a forged Host buys an error
    /// from Entra and nothing else. Nothing else in this file reads them.
    fn origin(&self, headers: &HeaderMap) -> Result<String, AppError> {
        if let Some(url) = &self.public_url {
            return Ok(url.clone());
        }

        let host = first_value(headers, "x-forwarded-host")
            .or_else(|| headers.get(header::HOST).and_then(|v| v.to_str().ok()))
            .map(str::trim)
            .filter(|h| !h.is_empty())
            .ok_or_else(|| {
                AppError::BadRequest(
                    "This request names no host, so a sign-in has nowhere to come back to"
                        .to_string(),
                )
            })?;

        let scheme = first_value(headers, "x-forwarded-proto")
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| {
                if host.starts_with("localhost") || host.starts_with("127.0.0.1") {
                    "http".to_string()
                } else {
                    "https".to_string()
                }
            });

        Ok(format!("{scheme}://{host}"))
    }

    /// Where Entra sends the browser back. This exact string has to be on the app registration.
    fn redirect_uri(&self, headers: &HeaderMap) -> Result<RedirectUrl, AppError> {
        let uri = format!("{}/api/auth/callback", self.origin(headers)?);
        RedirectUrl::new(uri).map_err(|e| {
            tracing::error!("the redirect URI will not parse: {e}");
            AppError::Internal("Sign-in is not available right now".to_string())
        })
    }
}

/// The value of an environment variable, with an empty one counting as unset. The chart writes an
/// empty string when the operator leaves a value out, as it does for the GIPHY key.
fn env_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// The first entry of a header that a chain of proxies may have made into a list.
fn first_value<'h>(headers: &'h HeaderMap, name: &str) -> Option<&'h str> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
}

// --- The gate ---

/// Stands in front of everything and asks for a work account, when the deployment asked for one.
///
/// A browser that has not signed in is sent to Entra, because it is asking for a page and a page is
/// what it should get back. Anything else — a `fetch`, the socket handshake, the desktop app — is
/// answered 401 with the path to the door in the body, because a redirect to Microsoft is not
/// something a `fetch` can do anything useful with.
pub async fn gate(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let Some(entra) = state.entra.clone() else {
        return next.run(req).await;
    };

    // The door itself is never behind the door. The health route is open as well, so that the
    // Kubernetes probes and the desktop app's connection test do not need an account.
    let path = req.uri().path();
    if path.starts_with("/api/auth/") || path == "/api/health" {
        return next.run(req).await;
    }

    match identity_from(req.headers(), &entra.key) {
        Some(identity) => {
            req.extensions_mut().insert(identity);
            next.run(req).await
        }
        None => challenge(&req),
    }
}

/// Reads the session cookie. An expired one counts as no cookie: the Max-Age on it is a request to
/// the browser, and the time inside it is the answer.
fn identity_from(headers: &HeaderMap, key: &Key) -> Option<Identity> {
    let jar = PrivateCookieJar::from_headers(headers, key.clone());
    let identity: Identity = serde_json::from_str(jar.get(SESSION_COOKIE)?.value()).ok()?;
    (identity.expires_at > Utc::now().timestamp()).then_some(identity)
}

/// What an unsigned-in caller gets.
fn challenge(req: &Request) -> Response {
    let wants_page = req.method() == Method::GET
        && req
            .headers()
            .get(header::ACCEPT)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|accept| accept.contains("text/html"));

    if wants_page {
        let target = req
            .uri()
            .path_and_query()
            .map(|p| p.as_str())
            .unwrap_or("/");
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("redirect", target)
            .finish();
        return Redirect::to(&format!("{LOGIN_PATH}?{query}")).into_response();
    }

    (
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "error": "Sign in with your work account to use Rewind",
            "login_url": LOGIN_PATH,
        })),
    )
        .into_response()
}

// --- The three routes of a sign-in ---

#[derive(Debug, Deserialize)]
pub struct LoginQuery {
    /// Where the person was going. A path on this server; anything else is dropped for `/`.
    #[serde(default)]
    pub redirect: Option<String>,
}

/// Starts a sign-in: keeps the one-time values in a cookie and sends the browser to Entra.
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<LoginQuery>,
) -> Result<Response, AppError> {
    let entra = enabled(&state)?;
    let redirect_uri = entra.redirect_uri(&headers)?;
    let secure = redirect_uri.as_str().starts_with("https://");

    let client = CoreClient::from_provider_metadata(
        entra.metadata().await?,
        entra.client_id.clone(),
        Some(entra.client_secret.clone()),
    )
    .set_redirect_uri(redirect_uri);

    // PKCE, even though a confidential client holds a secret: it costs one round of hashing and it
    // means an intercepted code is worth nothing on its own.
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();

    let (auth_url, csrf, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        // `openid` is added for us. These two are what carry the name back.
        .add_scope(Scope::new("profile".to_string()))
        .add_scope(Scope::new("email".to_string()))
        .set_pkce_challenge(challenge)
        .url();

    let login_state = LoginState {
        csrf: csrf.secret().clone(),
        nonce: nonce.secret().clone(),
        pkce_verifier: verifier.secret().clone(),
        redirect_to: safe_redirect(query.redirect.as_deref()),
    };

    let jar = PrivateCookieJar::from_headers(&headers, entra.key.clone()).add(session_cookie(
        LOGIN_COOKIE,
        serde_json::to_string(&login_state).map_err(|_| internal())?,
        CookieDuration::minutes(LOGIN_MINUTES),
        secure,
    ));

    Ok((jar, Redirect::to(auth_url.as_str())).into_response())
}

#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub error_description: Option<String>,
}

/// Finishes a sign-in: trades the code for an id_token, and the id_token for a session.
///
/// Every failure here answers with a page rather than a bare line of text, because a browser
/// arrives at this route by following a redirect and a person is looking at the result.
pub async fn callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CallbackQuery>,
) -> Response {
    match complete_sign_in(&state, &headers, query).await {
        Ok(response) => response,
        Err(message) => sign_in_failed(&message),
    }
}

async fn complete_sign_in(
    state: &AppState,
    headers: &HeaderMap,
    query: CallbackQuery,
) -> Result<Response, String> {
    let entra = state
        .entra
        .clone()
        .ok_or_else(|| "This server does not ask anyone to sign in.".to_string())?;

    // Entra says no by sending the browser back with a reason rather than a code.
    if let Some(error) = query.error {
        let description = query.error_description.unwrap_or_default();
        tracing::warn!("Entra refused a sign-in: {error} {description}");
        return Err(if description.is_empty() {
            format!("Entra refused the sign-in: {error}")
        } else {
            description
        });
    }

    let code = query
        .code
        .ok_or_else(|| "No code came back from Entra.".to_string())?;
    let returned_state = query
        .state
        .ok_or_else(|| "No state came back from Entra.".to_string())?;

    let jar = PrivateCookieJar::from_headers(headers, entra.key.clone());
    let login_state: LoginState = jar
        .get(LOGIN_COOKIE)
        .and_then(|c| serde_json::from_str(c.value()).ok())
        .ok_or_else(|| "This sign-in took too long, or it started in another tab.".to_string())?;

    // The state ties this answer to the request this browser made. Without the check, a page
    // elsewhere could walk a signed-in person through a sign-in as somebody else.
    if returned_state != login_state.csrf {
        tracing::warn!("a sign-in came back with a state this browser did not send");
        return Err("This sign-in did not match the one this browser started.".to_string());
    }

    let redirect_uri = entra
        .redirect_uri(headers)
        .map_err(|_| "Sign-in is not available right now.".to_string())?;
    let secure = redirect_uri.as_str().starts_with("https://");

    let metadata = entra
        .metadata()
        .await
        .map_err(|_| "Sign-in is not available right now.".to_string())?;
    let client = CoreClient::from_provider_metadata(
        metadata,
        entra.client_id.clone(),
        Some(entra.client_secret.clone()),
    )
    .set_redirect_uri(redirect_uri);

    let token = client
        .exchange_code(AuthorizationCode::new(code))
        .map_err(|e| {
            tracing::error!("the Entra client has no token endpoint: {e}");
            "Sign-in is not available right now.".to_string()
        })?
        .set_pkce_verifier(PkceCodeVerifier::new(login_state.pkce_verifier))
        .request_async(&entra.http)
        .await
        .map_err(|e| {
            tracing::warn!("the code could not be exchanged for a token: {e}");
            "Entra would not trade the code for a token.".to_string()
        })?;

    let id_token = token
        .id_token()
        .ok_or_else(|| "Entra sent no id_token, so there is no name to read.".to_string())?;

    // This is the check that makes the whole thing worth anything: the signature against the keys
    // the discovery document named, the issuer, the audience, and the nonce against the one this
    // browser was sent away with.
    let claims: &CoreIdTokenClaims = id_token
        .claims(&client.id_token_verifier(), &Nonce::new(login_state.nonce))
        .map_err(|e| {
            tracing::warn!("an id_token did not pass verification: {e}");
            "The token Entra sent did not pass verification.".to_string()
        })?;

    let name = claims
        .name()
        .and_then(|localized| localized.get(None))
        .map(|name| name.to_string())
        .or_else(|| claims.preferred_username().map(|u| u.to_string()))
        .unwrap_or_else(|| "Signed in".to_string());

    let email = claims
        .email()
        .map(|e| e.to_string())
        .or_else(|| claims.preferred_username().map(|u| u.to_string()));

    let identity = Identity {
        sub: claims.subject().to_string(),
        name,
        email,
        expires_at: (Utc::now() + chrono::Duration::hours(SESSION_HOURS)).timestamp(),
    };
    tracing::info!("signed in {}", identity.email.as_deref().unwrap_or("a user"));

    let jar = jar
        .remove(Cookie::build(LOGIN_COOKIE).path("/").build())
        .add(session_cookie(
            SESSION_COOKIE,
            serde_json::to_string(&identity).map_err(|_| "Internal error.".to_string())?,
            CookieDuration::hours(SESSION_HOURS),
            secure,
        ));

    Ok((jar, Redirect::to(&login_state.redirect_to)).into_response())
}

/// Ends the session here, and then at Entra.
///
/// Clearing our own cookie alone would look like nothing happened: the next page asks Entra, Entra
/// still holds the browser's own session, and the person is back in without a word. So the browser
/// goes on to Entra's logout, which is the only place that can really let go.
///
/// The origin has to be a redirect URI on the app registration for Entra to send the browser back
/// to it; if it is not, Entra says so on its own page instead, and the person is still signed out
/// of Rewind.
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let entra = enabled(&state)?;

    // The plain jar, not the private one, for the removal. A private jar drops a cookie it cannot
    // decrypt as it reads the request, and then has nothing to write a removal for — so a session
    // cookie left over from a rotated client secret would sit in the browser for its full twelve
    // hours. Clearing one takes a name and a path, and neither is secret.
    let jar = CookieJar::from_headers(&headers).remove(Cookie::build(SESSION_COOKIE).path("/").build());

    let mut url = Url::parse(&format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/logout",
        entra.tenant_id
    ))
    .map_err(|_| internal())?;
    url.query_pairs_mut()
        .append_pair("post_logout_redirect_uri", &entra.origin(&headers)?);

    Ok((jar, Redirect::to(url.as_str())).into_response())
}

/// Who the caller is, and whether the session is still there.
///
/// This is the one route a signed-in page can ask when the socket stops answering, so the three
/// cases have to stay apart: 200 while the session holds, 401 once it has run out, and 404 on a
/// server that asks nobody to sign in. Reading a 404 as an expired session would send a board on an
/// open deployment to a door that is not there.
/// It reads the cookie itself rather than the extension the gate leaves behind, because this route
/// is one of the few the gate steps over — it has to be, or a browser with no session could never
/// ask the question.
pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Identity>, AppError> {
    let entra = enabled(&state)?;
    identity_from(&headers, &entra.key)
        .map(Json)
        .ok_or_else(|| AppError::Unauthorized("Not signed in".to_string()))
}

// --- Small pieces ---

fn enabled(state: &AppState) -> Result<Arc<EntraAuth>, AppError> {
    state
        .entra
        .clone()
        .ok_or_else(|| AppError::NotFound("Sign-in is not enabled on this server".to_string()))
}

fn internal() -> AppError {
    AppError::Internal("Internal server error".to_string())
}

/// One of the two cookies, built the same way both times.
///
/// `Lax` rather than `None`: the browser comes back from Entra by a top-level navigation, which
/// `Lax` allows, and everything a page does on its own is same-site anyway. `Secure` follows the
/// origin, so that a sign-in works over plain HTTP on a laptop and never leaves the cookie
/// readable on the wire anywhere else.
fn session_cookie(
    name: &'static str,
    value: String,
    max_age: CookieDuration,
    secure: bool,
) -> Cookie<'static> {
    Cookie::build((name, value))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .max_age(max_age)
        .build()
}

/// Where a sign-in may send the browser afterwards: a path on this server and nothing else.
///
/// The value arrives in a query string, so without this an emailed link could carry a person
/// through a real sign-in and out onto someone else's site.
fn safe_redirect(requested: Option<&str>) -> String {
    let fallback = "/".to_string();
    let Some(target) = requested else {
        return fallback;
    };

    let is_path = target.starts_with('/')
        // `//host` is a URL, not a path.
        && !target.starts_with("//")
        // A backslash is a slash to some browsers.
        && !target.starts_with("/\\")
        && !target.contains(|c: char| c.is_control());

    if is_path {
        target.to_string()
    } else {
        fallback
    }
}

/// A sign-in that did not finish, as a page. Plain HTML, because there is no frontend to reach for:
/// the person is not signed in yet, so the bundle is still behind the gate.
fn sign_in_failed(message: &str) -> Response {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Sign-in did not finish</title>\
         <div style=\"font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1rem\">\
         <h1 style=\"font-size:1.25rem\">Sign-in did not finish</h1>\
         <p style=\"color:#666\">{}</p>\
         <p><a href=\"{LOGIN_PATH}\">Try again</a></p></div>",
        html_escape(message)
    );
    (StatusCode::UNAUTHORIZED, Html(body)).into_response()
}

/// Some of the messages above carry text from Entra, which is not ours to trust in a page.
fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A key of the shape `from_env` builds, from a secret standing in for a client secret.
    fn test_key(secret: &str) -> Key {
        Key::derive_from(&Sha512::digest(secret.as_bytes()))
    }

    /// The request headers a browser would send back after being handed this session — the cookie
    /// through the same encryption the real one goes through, so the round trip is the real one.
    fn headers_holding(identity: &Identity, key: &Key) -> HeaderMap {
        let response = PrivateCookieJar::from_headers(&HeaderMap::new(), key.clone())
            .add(session_cookie(
                SESSION_COOKIE,
                serde_json::to_string(identity).unwrap(),
                CookieDuration::hours(SESSION_HOURS),
                true,
            ))
            .into_response();

        let mut headers = HeaderMap::new();
        for value in response.headers().get_all(header::SET_COOKIE) {
            // A browser sends back the name and the value, and none of the attributes.
            let pair = value.to_str().unwrap().split(';').next().unwrap();
            headers.append(header::COOKIE, pair.parse().unwrap());
        }
        headers
    }

    fn identity_expiring_in(hours: i64) -> Identity {
        Identity {
            sub: "an-account".to_string(),
            name: "Alex Rivers".to_string(),
            email: Some("alex@example.com".to_string()),
            expires_at: (Utc::now() + chrono::Duration::hours(hours)).timestamp(),
        }
    }

    #[test]
    fn a_session_this_server_wrote_reads_back() {
        let key = test_key("a-client-secret");
        let headers = headers_holding(&identity_expiring_in(1), &key);

        let read = identity_from(&headers, &key).expect("the session should read back");
        assert_eq!(read.name, "Alex Rivers");
        assert_eq!(read.email.as_deref(), Some("alex@example.com"));
    }

    #[test]
    fn a_session_that_has_run_out_reads_as_none() {
        let key = test_key("a-client-secret");
        let headers = headers_holding(&identity_expiring_in(-1), &key);

        assert!(identity_from(&headers, &key).is_none());
    }

    /// Rotating the client secret rotates the key, and the sessions of the old one stop opening.
    #[test]
    fn a_session_written_under_another_secret_reads_as_none() {
        let headers = headers_holding(&identity_expiring_in(1), &test_key("the-old-secret"));

        assert!(identity_from(&headers, &test_key("the-new-secret")).is_none());
    }

    #[test]
    fn a_cookie_the_browser_wrote_itself_reads_as_none() {
        let key = test_key("a-client-secret");
        let mut headers = HeaderMap::new();
        let forged = serde_json::to_string(&identity_expiring_in(1)).unwrap();
        headers.insert(
            header::COOKIE,
            format!("{SESSION_COOKIE}={forged}").parse().unwrap(),
        );

        assert!(identity_from(&headers, &key).is_none());
    }

    #[test]
    fn a_path_on_this_server_is_kept() {
        assert_eq!(safe_redirect(Some("/board/abc123")), "/board/abc123");
        assert_eq!(safe_redirect(Some("/?q=1")), "/?q=1");
    }

    #[test]
    fn anything_that_leaves_this_server_is_dropped() {
        assert_eq!(safe_redirect(None), "/");
        assert_eq!(safe_redirect(Some("//evil.example.com")), "/");
        assert_eq!(safe_redirect(Some("/\\evil.example.com")), "/");
        assert_eq!(safe_redirect(Some("https://evil.example.com")), "/");
        assert_eq!(safe_redirect(Some("board/abc")), "/");
        assert_eq!(safe_redirect(Some("/board\nSet-Cookie: x=1")), "/");
    }

    #[test]
    fn a_message_from_entra_cannot_write_markup() {
        assert_eq!(
            html_escape("<script>alert(1)</script>"),
            "&lt;script&gt;alert(1)&lt;/script&gt;"
        );
    }
}

