use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Column roles. Every board has one column of each role.
pub const ROLE_PREVIOUS_ACTIONS: &str = "previous_actions";
pub const ROLE_ACTIONS: &str = "actions";

/// The Rocks column of a Level 10 board. Only a card in it can carry a rock status.
/// Every other board has no column of this role, which keeps the feature where it belongs.
pub const ROLE_ROCKS: &str = "rocks";

/// The template that turns the Level 10 parts on: the scorecard, the rock status, the rating.
pub const TEMPLATE_LEVEL10: &str = "level10";

/// The two marks that a rock can carry. Anything else is refused.
pub fn valid_rock_status(status: &str) -> bool {
    status == "on_track" || status == "off_track"
}

/// The columns whose cards carry a done mark: the actions of this retro and the actions carried
/// over from the last one. A card anywhere else is an observation, which is never finished.
pub const DONE_COLUMN_ROLES: [&str; 2] = [ROLE_ACTIONS, ROLE_PREVIOUS_ACTIONS];

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
    /// The template the board started from, kept as a format tag. None for a custom board.
    pub template_id: Option<String>,
    /// Empty on every board that is not a Level 10 board.
    pub scorecard: Vec<ScorecardMetric>,
    pub meeting_ratings: Vec<MeetingRatingView>,
    /// Whether the board asks for a password. The hash itself never leaves the database layer.
    pub has_password: bool,
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
    /// `on_track` or `off_track` on a card in the Rocks column. None everywhere else.
    pub rock_status: Option<String>,
    /// When the action was marked done. None on an open action and on every card outside the
    /// two action columns.
    pub done_at: Option<DateTime<Utc>>,
}

/// One line of the scorecard: a number the team reads each week, and how it stands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScorecardMetric {
    pub id: String,
    pub name: String,
    /// Free text, because an EOS goal reads ">= 95%" or "$120k".
    pub goal: String,
    pub actual: String,
    /// None until someone marks the line, then true or false.
    pub on_track: Option<bool>,
}

/// The mark that one participant gave the meeting, from 1 to 10.
/// The raw pairs go out, as votes do; the frontend works out the average.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingRatingView {
    pub participant_id: String,
    pub rating: i32,
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

/// The most characters that one field of a scorecard line can hold.
pub const MAX_SCORECARD_FIELD_LENGTH: usize = 200;

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
    pub template_id: Option<String>,
    pub scorecard: Vec<ScorecardMetric>,
    pub meeting_ratings: Vec<MeetingRatingView>,
    /// Whether the board asks a newcomer for a password. Says that a lock is there, and nothing
    /// about the word itself.
    pub has_password: bool,
}

/// The letters that stand in for the words of a card that the reader may not read yet.
/// They are in order of how often English uses them, so that the filler under the blur has
/// the colour of text.
const MASK_ALPHABET: [u8; 26] = *b"etaoinshrdlcumwfgypbvkjxqz";

/// Gives text of the same shape as the original and none of its meaning: every letter, digit and
/// mark becomes a filler letter, and every space and line break stays where it was.
///
/// The card keeps its width, its line count and its height, so the board looks the same under
/// the blur as it always did.
pub fn mask_text(text: &str) -> String {
    text.chars()
        .enumerate()
        .map(|(i, c)| {
            if c.is_whitespace() {
                c
            } else {
                MASK_ALPHABET[i % MASK_ALPHABET.len()] as char
            }
        })
        .collect()
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
            template_id: self.template_id.clone(),
            scorecard: self.scorecard.clone(),
            meeting_ratings: self.meeting_ratings.clone(),
            has_password: self.has_password,
        }
    }
}

impl BoardView {
    /// Replaces the words of every card this reader may not read yet with filler of the same
    /// shape, and does the same to the comments under it.
    ///
    /// The blur in the browser is a picture, not a lock: anyone can read a hidden card in the
    /// network panel. So the words of a hidden card do not leave the server at all. What the
    /// reader is allowed to see stays as it was — an unblurred board, their own cards, the
    /// carried actions, and everything a facilitator or an editor sees.
    ///
    /// GIFs stay as they are. The picture is hidden in the browser, and a card that lost its
    /// picture here would change shape when the board opens.
    pub fn redact_hidden_for(&mut self, participant_id: &str, is_facilitator: bool) {
        if !self.is_blurred {
            return;
        }
        let is_privileged = is_facilitator
            || self
                .editors
                .iter()
                .any(|e| e.participant_id == participant_id);
        if is_privileged {
            return;
        }

        for column in &mut self.columns {
            // A carried action is a record of the last retro, not fresh input. It never blurs.
            let carried_column = column.role.as_deref() == Some(ROLE_PREVIOUS_ACTIONS);
            for ticket in &mut column.tickets {
                let readable = carried_column
                    || ticket.carried_from_board_title.is_some()
                    || ticket.author_id == participant_id;
                if readable {
                    continue;
                }
                ticket.content = mask_text(&ticket.content);
                ticket.author_name = mask_text(&ticket.author_name);
                // A card you cannot read yet carries no discussion either, so the remarks under
                // it go the same way. The count stays, because the card keeps its comment mark.
                for comment in &mut ticket.comments {
                    comment.content = mask_text(&comment.content);
                    comment.author_name = mask_text(&comment.author_name);
                }
            }
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

/// A board that can supply cards to another board.
#[derive(Debug, Clone, Serialize)]
pub struct ActionSourceBoard {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub action_count: i64,
    /// Every card on the board, in every column. A board with no action can still supply the
    /// items of a discussion column, so the list names it as well.
    pub card_count: i64,
    pub labels: Vec<String>,
    /// True when the board asks for a password. The copy then asks for it as well, unless the
    /// caller can open that board already.
    pub is_locked: bool,
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

/// What an apply run did to the boards already made from a template.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ApplyTemplateResult {
    pub boards_examined: i64,
    pub boards_changed: i64,
    pub columns_renamed: i64,
    pub columns_added: i64,
    /// The boards that changed, so that the clients holding one open can be told. The admin
    /// reads the counts above and has no use for the ids.
    #[serde(skip_serializing)]
    pub changed_board_ids: Vec<String>,
}

/// A format a board can start from, and the settings it starts with.
#[derive(Debug, Clone, Serialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: String,
    pub columns: Vec<String>,
    /// Whether a board made from this template starts with its cards hidden. True for a retro,
    /// where the team writes before it reads. False for a meeting that works a list together.
    /// It sets the first state of the board and nothing after it: the facilitator still decides.
    pub default_blurred: bool,
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
    /// The template the caller picked. An old client leaves it out and gets a board with no tag.
    #[serde(default)]
    pub template_id: Option<String>,
    /// The word the board asks for. Absent, or empty, leaves the board open to anyone who
    /// holds the link.
    #[serde(default)]
    pub password: Option<String>,
}

/// The shortest and the longest password a board takes. The floor keeps out a password of one
/// character, which is no lock at all; the ceiling keeps a long paste from reaching Argon2.
pub const MIN_BOARD_PASSWORD_LENGTH: usize = 4;
pub const MAX_BOARD_PASSWORD_LENGTH: usize = 128;

/// Reads a password the way the board will keep it, or says what is wrong with it.
///
/// The ends are trimmed, because a password that came from a form carries whatever the paste
/// brought with it, and a space no one can see is a lock no one can open. What is inside stays
/// as it was typed. An empty value gives `Ok(None)`, which means the board asks for nothing.
pub fn read_password(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(password) = raw.map(str::trim).filter(|p| !p.is_empty()) else {
        return Ok(None);
    };

    if password.chars().count() < MIN_BOARD_PASSWORD_LENGTH {
        return Err(format!(
            "The password must have at least {MIN_BOARD_PASSWORD_LENGTH} characters"
        ));
    }
    if password.len() > MAX_BOARD_PASSWORD_LENGTH {
        return Err(format!(
            "The password must have at most {MAX_BOARD_PASSWORD_LENGTH} characters"
        ));
    }

    Ok(Some(password.to_string()))
}

/// What a person learns about a board before they are let in: enough to draw the gate, and
/// nothing that is on the board.
#[derive(Debug, Clone, Serialize)]
pub struct BoardAccessView {
    pub id: String,
    pub title: String,
    /// True when the board asks for a password that this caller has not yet given.
    pub is_locked: bool,
    /// The gate asks for a name after the password, so the client has to know this here.
    pub is_anonymous: bool,
}

/// The answer to the right password: the key for the rest of the meeting.
#[derive(Debug, Clone, Serialize)]
pub struct UnlockResponse {
    pub access_token: String,
}

/// The answer to a change of password. The token is new, so the facilitator keeps reading.
#[derive(Debug, Clone, Serialize)]
pub struct PasswordResponse {
    pub has_password: bool,
    pub access_token: String,
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
    /// The key to a locked board. The facilitator holds it from the start, so that the person who
    /// set the password never has to type it, and never depends on a cookie to read their board.
    pub access_token: String,
}

/// What the frontend must learn from the server before it draws the board.
/// The GIPHY key lives in a Kubernetes secret, so the browser can only get it from here.
#[derive(Debug, Serialize)]
pub struct ClientConfig {
    /// None when no key is set. The frontend then leaves out the GIF controls.
    pub giphy_api_key: Option<String>,
    /// The version of the server, which the release sets in `backend/Cargo.toml`. The web app
    /// has no version of its own — `frontend/package.json` stays at 0.0.0 — so the label it
    /// shows comes from here.
    pub version: String,
    /// Whether this deployment asks for a work account, and who the reader signed in as. Both are
    /// off and absent on a deployment that named no Entra app registration.
    pub auth: crate::auth::AuthConfig,
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

    fn ticket(id: &str, content: &str, author_id: &str) -> Ticket {
        Ticket {
            id: id.into(),
            content: content.into(),
            author_id: author_id.into(),
            author_name: "Rita".into(),
            votes: HashSet::new(),
            created_at: Utc::now(),
            carried_from_board_id: None,
            carried_from_board_title: None,
            comments: vec![Comment {
                id: "c1".into(),
                content: "I agree".into(),
                author_id: "other".into(),
                author_name: "Sam".into(),
                created_at: Utc::now(),
                gif: None,
            }],
            gif: None,
            rock_status: None,
            done_at: None,
        }
    }

    fn board_view(is_blurred: bool) -> BoardView {
        BoardView {
            id: "b1".into(),
            title: "Retro".into(),
            columns: vec![
                Column {
                    id: "col-prev".into(),
                    name: "Previous Actions".into(),
                    role: Some(ROLE_PREVIOUS_ACTIONS.into()),
                    tickets: vec![ticket("t-carried", "Book the room", "someone")],
                },
                Column {
                    id: "col1".into(),
                    name: "Went well".into(),
                    role: None,
                    tickets: vec![
                        ticket("t-mine", "My own card", "me"),
                        ticket("t-theirs", "The deploy broke", "someone"),
                    ],
                },
            ],
            is_blurred,
            is_anonymous: false,
            hide_votes: false,
            created_at: Utc::now(),
            participant_count: 2,
            vote_limit_per_column: None,
            timer_end: None,
            editors: Vec::new(),
            editor_requests: Vec::new(),
            labels: Vec::new(),
            template_id: None,
            scorecard: Vec::new(),
            meeting_ratings: Vec::new(),
            has_password: false,
        }
    }

    fn find<'a>(view: &'a BoardView, ticket_id: &str) -> &'a Ticket {
        view.columns
            .iter()
            .flat_map(|c| c.tickets.iter())
            .find(|t| t.id == ticket_id)
            .expect("ticket")
    }

    #[test]
    fn no_password_leaves_the_board_open() {
        assert_eq!(read_password(None), Ok(None));
        assert_eq!(read_password(Some("")), Ok(None));
        assert_eq!(read_password(Some("   ")), Ok(None));
    }

    #[test]
    fn a_password_loses_the_space_at_its_ends_and_keeps_the_rest() {
        assert_eq!(
            read_password(Some("  let me in  ")),
            Ok(Some("let me in".to_string()))
        );
    }

    #[test]
    fn a_short_password_is_refused() {
        assert!(read_password(Some("abc")).is_err());
        assert!(read_password(Some(&"x".repeat(MAX_BOARD_PASSWORD_LENGTH + 1))).is_err());
    }

    #[test]
    fn mask_keeps_the_shape_and_drops_the_words() {
        let masked = mask_text("Deploy broke\ntwice");
        assert_eq!(masked.chars().count(), "Deploy broke\ntwice".chars().count());
        assert_eq!(masked.find(' '), Some(6));
        assert!(masked.contains('\n'));
        assert!(!masked.contains("Deploy"));
    }

    #[test]
    fn a_blurred_card_of_another_reader_loses_its_words() {
        let mut view = board_view(true);
        view.redact_hidden_for("me", false);

        let theirs = find(&view, "t-theirs");
        assert_ne!(theirs.content, "The deploy broke");
        assert_eq!(theirs.content.chars().count(), "The deploy broke".chars().count());
        assert_ne!(theirs.author_name, "Rita");
        assert_ne!(theirs.comments[0].content, "I agree");
        assert_eq!(theirs.comments.len(), 1);
    }

    #[test]
    fn a_reader_keeps_their_own_cards_and_the_carried_actions() {
        let mut view = board_view(true);
        view.redact_hidden_for("me", false);

        assert_eq!(find(&view, "t-mine").content, "My own card");
        assert_eq!(find(&view, "t-carried").content, "Book the room");
    }

    #[test]
    fn an_open_board_keeps_every_word() {
        let mut view = board_view(false);
        view.redact_hidden_for("me", false);
        assert_eq!(find(&view, "t-theirs").content, "The deploy broke");
    }

    #[test]
    fn the_facilitator_and_the_editors_read_a_blurred_board() {
        let mut view = board_view(true);
        view.redact_hidden_for("me", true);
        assert_eq!(find(&view, "t-theirs").content, "The deploy broke");

        let mut view = board_view(true);
        view.editors.push(EditorView {
            participant_id: "me".into(),
            participant_name: "Me".into(),
        });
        view.redact_hidden_for("me", false);
        assert_eq!(find(&view, "t-theirs").content, "The deploy broke");
    }
}
