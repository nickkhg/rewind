use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Column roles. Every board has one column of each role.
pub const ROLE_PREVIOUS_ACTIONS: &str = "previous_actions";
pub const ROLE_ACTIONS: &str = "actions";

/// Column names that only the two role columns can use.
pub const RESERVED_COLUMN_NAMES: [&str; 4] = [
    "actions",
    "action items",
    "action item",
    "previous actions",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Board {
    pub id: String,
    pub title: String,
    pub columns: Vec<Column>,
    pub is_blurred: bool,
    pub is_anonymous: bool,
    pub hide_votes: bool,
    pub created_at: DateTime<Utc>,
    pub facilitator_token: String,
    pub facilitator_id: Option<String>,
    pub participants: Vec<Participant>,
    pub vote_limit_per_column: Option<i32>,
    pub timer_end: Option<DateTime<Utc>>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Column {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    pub tickets: Vec<Ticket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ticket {
    pub id: String,
    pub content: String,
    pub author_id: String,
    pub author_name: String,
    pub votes: HashSet<String>,
    pub created_at: DateTime<Utc>,
    pub carried_from_board_id: Option<String>,
    pub carried_from_board_title: Option<String>,
    pub comments: Vec<Comment>,
    pub gif: Option<Gif>,
}

/// A remark on one card. It changes neither the text of the card nor its votes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: String,
    pub content: String,
    pub author_id: String,
    pub author_name: String,
    pub created_at: DateTime<Utc>,
    pub gif: Option<Gif>,
}

/// The most characters that one comment can hold.
pub const MAX_COMMENT_LENGTH: usize = 500;

/// One GIF from GIPHY, attached to a card or to a comment.
///
/// The board keeps enough of the picture to draw it on its own: the two URLs, the natural size,
/// and the title. It keeps the id as well, because the attribution link points at the GIPHY page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gif {
    pub id: String,
    pub url: String,
    pub still_url: String,
    pub width: i32,
    pub height: i32,
    pub title: String,
}

/// The most characters that a GIF title can hold. A longer title is cut, not refused.
const MAX_GIF_TITLE_LENGTH: usize = 200;

/// The most characters that a GIF URL can hold.
const MAX_GIF_URL_LENGTH: usize = 500;

/// Tells whether a URL points at GIPHY over HTTPS.
///
/// The client chooses the URL, so the server must not take it on trust: an open field here would
/// let anyone put a picture of their choice, or a tracking pixel, onto someone else's board. Only
/// `giphy.com` and its subdomains pass.
fn is_giphy_url(raw: &str) -> bool {
    let Some(rest) = raw.strip_prefix("https://") else {
        return false;
    };

    // The authority runs to the first path, query, or fragment mark.
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();

    // `https://evil.com@media.giphy.com/` reads as GIPHY to a careless check but asks the browser
    // for evil.com. A backslash confuses some parsers the same way. Neither belongs in a media URL.
    if authority.contains('@') || authority.contains('\\') || authority.is_empty() {
        return false;
    }

    // Drop the port, then match the host. The leading dot on the suffix keeps out `notgiphy.com`.
    let host = authority.split(':').next().unwrap_or_default().to_lowercase();
    host == "giphy.com" || host.ends_with(".giphy.com")
}

/// Checks a GIF that a client sent and puts it into the form the database keeps.
/// Gives None if any part of it does not hold up, so that a bad GIF drops rather than
/// taking the whole card or comment down with it.
pub fn sanitize_gif(gif: Gif) -> Option<Gif> {
    let id = gif.id.trim();
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }

    if gif.url.len() > MAX_GIF_URL_LENGTH || gif.still_url.len() > MAX_GIF_URL_LENGTH {
        return None;
    }
    if !is_giphy_url(&gif.url) || !is_giphy_url(&gif.still_url) {
        return None;
    }

    // A picture with no size cannot hold its place on the card before it arrives.
    if gif.width <= 0 || gif.height <= 0 || gif.width > 10_000 || gif.height > 10_000 {
        return None;
    }

    let mut title: String = gif.title.trim().chars().take(MAX_GIF_TITLE_LENGTH).collect();
    if title.is_empty() {
        title = "GIF".to_string();
    }

    Some(Gif {
        id: id.to_string(),
        url: gif.url,
        still_url: gif.still_url,
        width: gif.width,
        height: gif.height,
        title,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Participant {
    pub id: String,
    pub name: String,
}

/// Public view of a board — excludes facilitator_token
#[derive(Debug, Clone, Serialize)]
pub struct BoardView {
    pub id: String,
    pub title: String,
    pub columns: Vec<Column>,
    pub is_blurred: bool,
    pub is_anonymous: bool,
    pub hide_votes: bool,
    pub created_at: DateTime<Utc>,
    pub participant_count: usize,
    pub vote_limit_per_column: Option<i32>,
    pub timer_end: Option<DateTime<Utc>>,
    pub editors: Vec<EditorView>,
    pub editor_requests: Vec<EditorRequestView>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EditorView {
    pub participant_id: String,
    pub participant_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EditorRequestView {
    pub participant_id: String,
    pub participant_name: String,
}

impl Board {
    pub fn to_view_with_participants(
        &self,
        count: usize,
        editors: Vec<EditorView>,
        editor_requests: Vec<EditorRequestView>,
    ) -> BoardView {
        BoardView {
            id: self.id.clone(),
            title: self.title.clone(),
            columns: self.columns.clone(),
            is_blurred: self.is_blurred,
            is_anonymous: self.is_anonymous,
            hide_votes: self.hide_votes,
            created_at: self.created_at,
            participant_count: count,
            vote_limit_per_column: self.vote_limit_per_column,
            timer_end: self.timer_end,
            editors,
            editor_requests,
            labels: self.labels.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MyBoardSummary {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub column_count: i64,
    pub ticket_count: i64,
    pub is_anonymous: bool,
    pub labels: Vec<String>,
}

/// A board that can supply actions to another board.
#[derive(Debug, Clone, Serialize)]
pub struct ActionSourceBoard {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub action_count: i64,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LabelCount {
    pub label: String,
    pub board_count: i64,
}

/// The result of a copy from one board to another.
#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: String,
    pub columns: Vec<String>,
}

// --- Teams ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    pub id: String,
    pub name: String,
    pub members: Vec<TeamMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateBoardRequest {
    pub title: String,
    pub columns: Vec<String>,
    #[serde(default)]
    pub is_anonymous: bool,
    #[serde(default)]
    pub labels: Vec<String>,
}

/// The most labels that one board can carry.
pub const MAX_LABELS_PER_BOARD: usize = 6;

/// Puts a label into the form that the database keeps: lower case, one space between words.
pub fn normalize_label(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Cleans a list of labels: normalizes each one, removes the empty and the double entries,
/// and keeps at most `MAX_LABELS_PER_BOARD`.
pub fn normalize_labels(raw: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for label in raw {
        let label = normalize_label(label);
        if label.is_empty() || label.len() > 40 || out.contains(&label) {
            continue;
        }
        out.push(label);
        if out.len() == MAX_LABELS_PER_BOARD {
            break;
        }
    }
    out
}

#[derive(Debug, Serialize)]
pub struct CreateBoardResponse {
    pub board: BoardView,
    pub facilitator_token: String,
}

/// What the frontend must learn from the server before it draws the board.
/// The GIPHY key lives in a Kubernetes secret, so the browser can only get it from here.
#[derive(Debug, Serialize)]
pub struct ClientConfig {
    /// None when no key is set. The frontend then leaves out the GIF controls.
    pub giphy_api_key: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gif(url: &str) -> Gif {
        Gif {
            id: "abc123".into(),
            url: url.into(),
            still_url: url.into(),
            width: 200,
            height: 150,
            title: "a cat".into(),
        }
    }

    #[test]
    fn giphy_hosts_pass() {
        assert!(is_giphy_url("https://media3.giphy.com/media/abc/200w.gif?cid=x"));
        assert!(is_giphy_url("https://i.giphy.com/abc.gif"));
        assert!(is_giphy_url("https://giphy.com/gifs/abc"));
    }

    #[test]
    fn other_hosts_fail() {
        // Plain HTTP, a look-alike host, a suffix trick, and credentials that redirect the request.
        assert!(!is_giphy_url("http://media.giphy.com/a.gif"));
        assert!(!is_giphy_url("https://notgiphy.com/a.gif"));
        assert!(!is_giphy_url("https://media.giphy.com.evil.test/a.gif"));
        assert!(!is_giphy_url("https://evil.test@media.giphy.com/a.gif"));
        assert!(!is_giphy_url("data:image/gif;base64,AAAA"));
        assert!(!is_giphy_url(""));
    }

    #[test]
    fn sanitize_refuses_a_foreign_url() {
        assert!(sanitize_gif(gif("https://evil.test/a.gif")).is_none());
    }

    #[test]
    fn sanitize_refuses_a_bad_size() {
        let mut g = gif("https://media.giphy.com/a.gif");
        g.width = 0;
        assert!(sanitize_gif(g).is_none());
    }

    #[test]
    fn sanitize_gives_an_empty_title_a_value() {
        let mut g = gif("https://media.giphy.com/a.gif");
        g.title = "   ".into();
        assert_eq!(sanitize_gif(g).unwrap().title, "GIF");
    }
}
