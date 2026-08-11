use chrono::{DateTime, Utc};
use nanoid::nanoid;
use sqlx::PgPool;
use std::collections::HashSet;

use crate::models::{
    ActionSourceBoard, Board, Column, Comment, EditorRequestView, EditorView, Gif, ImportResult,
    LabelCount, MeetingRatingView, ScorecardMetric, Ticket, DONE_COLUMN_ROLES, ROLE_ACTIONS,
    ROLE_PREVIOUS_ACTIONS, ROLE_ROCKS, TEMPLATE_LEVEL10,
};
use crate::state::MergeSnapshot;

/// The columns that every read of a card asks for, in one place so that a new column
/// reaches every query at once.
const TICKET_COLUMNS: &str = "id, column_id, content, author_id, author_name, created_at, \
     carried_from_board_id, carried_from_board_title, \
     gif_id, gif_url, gif_still_url, gif_width, gif_height, gif_title, rock_status, done_at";

/// The same list for a comment.
const COMMENT_COLUMNS: &str = "id, ticket_id, content, author_id, author_name, created_at, \
     gif_id, gif_url, gif_still_url, gif_width, gif_height, gif_title";

// --- Board ---

pub async fn create_board(
    pool: &PgPool,
    id: &str,
    title: &str,
    facilitator_token: &str,
    facilitator_id: &str,
    columns: &[(String, String, Option<&str>)], // (id, name, role)
    created_at: DateTime<Utc>,
    is_anonymous: bool,
    labels: &[String],
    template_id: Option<&str>,
) -> Result<Board, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO boards (id, title, facilitator_token, facilitator_id, is_blurred, is_anonymous, created_at, template_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(id)
    .bind(title)
    .bind(facilitator_token)
    .bind(facilitator_id)
    .bind(true)
    .bind(is_anonymous)
    .bind(created_at)
    .bind(template_id)
    .execute(&mut *tx)
    .await?;

    let mut cols = Vec::new();
    for (pos, (col_id, col_name, role)) in columns.iter().enumerate() {
        sqlx::query(
            "INSERT INTO columns (id, board_id, name, position, role) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(col_id)
        .bind(id)
        .bind(col_name)
        .bind(pos as i32)
        .bind(*role)
        .execute(&mut *tx)
        .await?;

        cols.push(Column {
            id: col_id.clone(),
            name: col_name.clone(),
            role: role.map(|r| r.to_string()),
            tickets: Vec::new(),
        });
    }

    for label in labels {
        sqlx::query("INSERT INTO board_labels (board_id, label) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(id)
            .bind(label)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    Ok(Board {
        id: id.to_string(),
        title: title.to_string(),
        columns: cols,
        is_blurred: true,
        is_anonymous,
        hide_votes: false,
        created_at,
        facilitator_token: facilitator_token.to_string(),
        facilitator_id: Some(facilitator_id.to_string()),
        participants: Vec::new(),
        vote_limit_per_column: None,
        timer_end: None,
        labels: labels.to_vec(),
        template_id: template_id.map(|t| t.to_string()),
        scorecard: Vec::new(),
        meeting_ratings: Vec::new(),
    })
}

pub async fn get_board(pool: &PgPool, board_id: &str) -> Result<Option<Board>, sqlx::Error> {
    let row = sqlx::query_as::<_, BoardRow>(
        "SELECT id, title, is_blurred, is_anonymous, hide_votes, facilitator_token, facilitator_id, created_at, vote_limit_per_column, timer_end, template_id FROM boards WHERE id = $1",
    )
    .bind(board_id)
    .fetch_optional(pool)
    .await?;

    let Some(board_row) = row else {
        return Ok(None);
    };

    let col_rows = sqlx::query_as::<_, ColumnRow>(
        "SELECT id, name, position, role FROM columns WHERE board_id = $1 ORDER BY position",
    )
    .bind(board_id)
    .fetch_all(pool)
    .await?;

    let col_ids: Vec<&str> = col_rows.iter().map(|c| c.id.as_str()).collect();

    // Fetch all tickets for all columns in one query
    let ticket_rows = if col_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, TicketRow>(
            &format!("SELECT {TICKET_COLUMNS} FROM tickets WHERE column_id = ANY($1) ORDER BY created_at"),
        )
        .bind(&col_ids)
        .fetch_all(pool)
        .await?
    };

    // Fetch all votes for all tickets in one query
    let ticket_ids: Vec<&str> = ticket_rows.iter().map(|t| t.id.as_str()).collect();
    let vote_rows = if ticket_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, VoteRow>(
            "SELECT ticket_id, participant_id FROM votes WHERE ticket_id = ANY($1)",
        )
        .bind(&ticket_ids)
        .fetch_all(pool)
        .await?
    };

    // Fetch all comments for all tickets in one query
    let comment_rows = if ticket_ids.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, CommentRow>(
            &format!("SELECT {COMMENT_COLUMNS} FROM ticket_comments WHERE ticket_id = ANY($1) ORDER BY created_at"),
        )
        .bind(&ticket_ids)
        .fetch_all(pool)
        .await?
    };

    // Group votes by ticket_id
    let mut votes_map: std::collections::HashMap<String, HashSet<String>> =
        std::collections::HashMap::new();
    for v in vote_rows {
        votes_map
            .entry(v.ticket_id)
            .or_default()
            .insert(v.participant_id);
    }

    // Group comments by ticket_id. They keep the order of the query: oldest first.
    let mut comments_map: std::collections::HashMap<String, Vec<Comment>> =
        std::collections::HashMap::new();
    for mut c in comment_rows {
        let gif = c.take_gif();
        comments_map.entry(c.ticket_id).or_default().push(Comment {
            id: c.id,
            content: c.content,
            author_id: c.author_id,
            author_name: c.author_name,
            created_at: c.created_at,
            gif,
        });
    }

    // Group tickets by column_id
    let mut tickets_map: std::collections::HashMap<String, Vec<Ticket>> =
        std::collections::HashMap::new();
    for mut t in ticket_rows {
        let votes = votes_map.remove(&t.id).unwrap_or_default();
        let comments = comments_map.remove(&t.id).unwrap_or_default();
        let gif = t.take_gif();
        tickets_map.entry(t.column_id.clone()).or_default().push(Ticket {
            id: t.id,
            content: t.content,
            author_id: t.author_id,
            author_name: t.author_name,
            votes,
            created_at: t.created_at,
            carried_from_board_id: t.carried_from_board_id,
            carried_from_board_title: t.carried_from_board_title,
            comments,
            gif,
            rock_status: t.rock_status,
            done_at: t.done_at,
        });
    }

    let columns = col_rows
        .into_iter()
        .map(|c| {
            let tickets = tickets_map.remove(&c.id).unwrap_or_default();
            Column {
                id: c.id,
                name: c.name,
                role: c.role,
                tickets,
            }
        })
        .collect();

    let labels = get_board_labels(pool, board_id).await?;

    // The scorecard and the ratings belong to a Level 10 board alone. Every other board would
    // pay for two more queries on each broadcast and read two empty lists.
    let is_level10 = board_row.template_id.as_deref() == Some(TEMPLATE_LEVEL10);
    let (scorecard, meeting_ratings) = if is_level10 {
        (
            get_scorecard(pool, board_id).await?,
            get_meeting_ratings(pool, board_id).await?,
        )
    } else {
        (Vec::new(), Vec::new())
    };

    Ok(Some(Board {
        id: board_row.id,
        title: board_row.title,
        columns,
        is_blurred: board_row.is_blurred,
        is_anonymous: board_row.is_anonymous,
        hide_votes: board_row.hide_votes,
        created_at: board_row.created_at,
        facilitator_token: board_row.facilitator_token,
        facilitator_id: board_row.facilitator_id,
        participants: Vec::new(),
        vote_limit_per_column: board_row.vote_limit_per_column,
        timer_end: board_row.timer_end,
        labels,
        template_id: board_row.template_id,
        scorecard,
        meeting_ratings,
    }))
}

pub async fn get_board_facilitator_token(
    pool: &PgPool,
    board_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_as::<_, FacilitatorTokenRow>(
        "SELECT facilitator_token FROM boards WHERE id = $1",
    )
    .bind(board_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| r.facilitator_token))
}

pub async fn get_board_anonymous(
    pool: &PgPool,
    board_id: &str,
) -> Result<Option<bool>, sqlx::Error> {
    let row = sqlx::query_as::<_, AnonymousRow>(
        "SELECT is_anonymous FROM boards WHERE id = $1",
    )
    .bind(board_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.is_anonymous))
}

pub async fn get_board_facilitator_id(
    pool: &PgPool,
    board_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_as::<_, FacilitatorIdRow>(
        "SELECT facilitator_id FROM boards WHERE id = $1",
    )
    .bind(board_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|r| r.facilitator_id))
}

pub async fn get_boards_by_facilitator_id(
    pool: &PgPool,
    facilitator_id: &str,
) -> Result<Vec<crate::models::MyBoardSummary>, sqlx::Error> {
    let rows = sqlx::query_as::<_, MyBoardRow>(
        r#"
        SELECT
            b.id,
            b.title,
            b.created_at,
            b.is_anonymous,
            (SELECT COUNT(*) FROM columns c WHERE c.board_id = b.id) AS column_count,
            (SELECT COUNT(*) FROM tickets t JOIN columns c ON t.column_id = c.id WHERE c.board_id = b.id) AS ticket_count,
            COALESCE((SELECT array_agg(l.label ORDER BY l.label) FROM board_labels l WHERE l.board_id = b.id), '{}'::text[]) AS labels
        FROM boards b
        WHERE b.facilitator_id = $1
        ORDER BY b.created_at DESC
        "#,
    )
    .bind(facilitator_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| crate::models::MyBoardSummary {
            id: r.id,
            title: r.title,
            created_at: r.created_at,
            column_count: r.column_count,
            ticket_count: r.ticket_count,
            is_anonymous: r.is_anonymous,
            labels: r.labels,
        })
        .collect())
}

// --- Templates ---

pub async fn list_templates(pool: &PgPool) -> Result<Vec<crate::models::Template>, sqlx::Error> {
    let rows = sqlx::query_as::<_, TemplateRow>(
        "SELECT id, name, description, columns FROM templates ORDER BY position",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| crate::models::Template {
            id: r.id,
            name: r.name,
            description: r.description,
            columns: r.columns,
        })
        .collect())
}

/// Tells whether a template of this id is on file. A board keeps the id it was made from,
/// so the id is checked once here and then never again.
pub async fn template_exists(pool: &PgPool, template_id: &str) -> Result<bool, sqlx::Error> {
    let row = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM templates WHERE id = $1",
    )
    .bind(template_id)
    .fetch_one(pool)
    .await?;
    Ok(row.count > 0)
}

pub async fn create_template(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: &str,
    columns: &[String],
    position: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO templates (id, name, description, columns, position) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(columns)
    .bind(position)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_template(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: &str,
    columns: &[String],
    position: i32,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE templates SET name = $1, description = $2, columns = $3, position = $4 WHERE id = $5",
    )
    .bind(name)
    .bind(description)
    .bind(columns)
    .bind(position)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_template(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM templates WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// --- Tickets ---

pub async fn add_ticket(
    pool: &PgPool,
    ticket_id: &str,
    column_id: &str,
    content: &str,
    author_id: &str,
    author_name: &str,
    created_at: DateTime<Utc>,
    gif: Option<&Gif>,
) -> Result<(), sqlx::Error> {
    let (gid, gurl, gstill, gw, gh, gtitle) = gif_binds(gif);
    sqlx::query(
        "INSERT INTO tickets (id, column_id, content, author_id, author_name, created_at, \
         gif_id, gif_url, gif_still_url, gif_width, gif_height, gif_title) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(ticket_id)
    .bind(column_id)
    .bind(content)
    .bind(author_id)
    .bind(author_name)
    .bind(created_at)
    .bind(gid)
    .bind(gurl)
    .bind(gstill)
    .bind(gw)
    .bind(gh)
    .bind(gtitle)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_ticket(pool: &PgPool, ticket_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM tickets WHERE id = $1")
        .bind(ticket_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn edit_ticket(
    pool: &PgPool,
    ticket_id: &str,
    content: &str,
    gif: Option<&Gif>,
) -> Result<(), sqlx::Error> {
    let (gid, gurl, gstill, gw, gh, gtitle) = gif_binds(gif);
    sqlx::query(
        "UPDATE tickets SET content = $1, gif_id = $2, gif_url = $3, gif_still_url = $4, \
         gif_width = $5, gif_height = $6, gif_title = $7 WHERE id = $8",
    )
    .bind(content)
    .bind(gid)
    .bind(gurl)
    .bind(gstill)
    .bind(gw)
    .bind(gh)
    .bind(gtitle)
    .bind(ticket_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Puts a card into a different column of the same board. The votes stay with the card.
pub async fn move_ticket(
    pool: &PgPool,
    ticket_id: &str,
    column_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE tickets SET column_id = $1 WHERE id = $2")
        .bind(column_id)
        .bind(ticket_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_ticket_author(
    pool: &PgPool,
    ticket_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row =
        sqlx::query_as::<_, AuthorRow>("SELECT author_id FROM tickets WHERE id = $1")
            .bind(ticket_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.author_id))
}

/// Tells whether a card sits on one of the columns of this board.
pub async fn ticket_belongs_to_board(
    pool: &PgPool,
    ticket_id: &str,
    board_id: &str,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM tickets t JOIN columns c ON c.id = t.column_id WHERE t.id = $1 AND c.board_id = $2",
    )
    .bind(ticket_id)
    .bind(board_id)
    .fetch_one(pool)
    .await?;
    Ok(row.count > 0)
}

// --- Comments ---

pub async fn add_comment(
    pool: &PgPool,
    comment_id: &str,
    ticket_id: &str,
    content: &str,
    author_id: &str,
    author_name: &str,
    created_at: DateTime<Utc>,
    gif: Option<&Gif>,
) -> Result<(), sqlx::Error> {
    let (gid, gurl, gstill, gw, gh, gtitle) = gif_binds(gif);
    sqlx::query(
        "INSERT INTO ticket_comments (id, ticket_id, content, author_id, author_name, created_at, \
         gif_id, gif_url, gif_still_url, gif_width, gif_height, gif_title) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(comment_id)
    .bind(ticket_id)
    .bind(content)
    .bind(author_id)
    .bind(author_name)
    .bind(created_at)
    .bind(gid)
    .bind(gurl)
    .bind(gstill)
    .bind(gw)
    .bind(gh)
    .bind(gtitle)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn edit_comment(
    pool: &PgPool,
    comment_id: &str,
    content: &str,
    gif: Option<&Gif>,
) -> Result<(), sqlx::Error> {
    let (gid, gurl, gstill, gw, gh, gtitle) = gif_binds(gif);
    sqlx::query(
        "UPDATE ticket_comments SET content = $1, gif_id = $2, gif_url = $3, gif_still_url = $4, \
         gif_width = $5, gif_height = $6, gif_title = $7 WHERE id = $8",
    )
    .bind(content)
    .bind(gid)
    .bind(gurl)
    .bind(gstill)
    .bind(gw)
    .bind(gh)
    .bind(gtitle)
    .bind(comment_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_comment(pool: &PgPool, comment_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM ticket_comments WHERE id = $1")
        .bind(comment_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Gives the author of a comment, but only if the comment is on a card of this board.
/// A caller from a different board gets None, and with it no permission to act.
pub async fn get_comment_author_on_board(
    pool: &PgPool,
    comment_id: &str,
    board_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_as::<_, AuthorRow>(
        "SELECT cm.author_id FROM ticket_comments cm \
         JOIN tickets t ON t.id = cm.ticket_id \
         JOIN columns c ON c.id = t.column_id \
         WHERE cm.id = $1 AND c.board_id = $2",
    )
    .bind(comment_id)
    .bind(board_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.author_id))
}

// --- Votes ---

pub async fn toggle_vote(
    pool: &PgPool,
    ticket_id: &str,
    participant_id: &str,
) -> Result<(), sqlx::Error> {
    let deleted = sqlx::query(
        "DELETE FROM votes WHERE ticket_id = $1 AND participant_id = $2",
    )
    .bind(ticket_id)
    .bind(participant_id)
    .execute(pool)
    .await?;

    if deleted.rows_affected() == 0 {
        sqlx::query("INSERT INTO votes (ticket_id, participant_id) VALUES ($1, $2)")
            .bind(ticket_id)
            .bind(participant_id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

// --- Merge ---

pub async fn merge_tickets(
    pool: &PgPool,
    source_id: &str,
    target_id: &str,
) -> Result<Option<MergeSnapshot>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Fetch both tickets
    let source = sqlx::query_as::<_, TicketRow>(
        &format!("SELECT {TICKET_COLUMNS} FROM tickets WHERE id = $1"),
    )
    .bind(source_id)
    .fetch_optional(&mut *tx)
    .await?;

    let target = sqlx::query_as::<_, TicketRow>(
        &format!("SELECT {TICKET_COLUMNS} FROM tickets WHERE id = $1"),
    )
    .bind(target_id)
    .fetch_optional(&mut *tx)
    .await?;

    let (mut source, mut target) = match (source, target) {
        (Some(s), Some(t)) => (s, t),
        _ => return Ok(None),
    };
    let source_gif = source.take_gif();
    let target_gif = target.take_gif();

    // Fetch source votes
    let source_votes: Vec<VoteRow> =
        sqlx::query_as::<_, VoteRow>("SELECT ticket_id, participant_id FROM votes WHERE ticket_id = $1")
            .bind(source_id)
            .fetch_all(&mut *tx)
            .await?;
    let source_vote_ids: Vec<String> = source_votes.iter().map(|v| v.participant_id.clone()).collect();

    // The comments of the source card follow their text onto the target card.
    let source_comments = sqlx::query_as::<_, CommentIdRow>(
        "SELECT id FROM ticket_comments WHERE ticket_id = $1",
    )
    .bind(source_id)
    .fetch_all(&mut *tx)
    .await?;
    let source_comment_ids: Vec<String> = source_comments.into_iter().map(|r| r.id).collect();

    // Combined content
    let combined = format!("{}\n---\n{}", target.content, source.content);

    // A card holds one GIF. The target keeps its own; an empty target takes the one from the
    // source, so that the picture is not lost with the card it came on.
    let merged_gif = target_gif.clone().or_else(|| source_gif.clone());

    // Update target content
    let (gid, gurl, gstill, gw, gh, gtitle) = gif_binds(merged_gif.as_ref());
    sqlx::query(
        "UPDATE tickets SET content = $1, gif_id = $2, gif_url = $3, gif_still_url = $4, \
         gif_width = $5, gif_height = $6, gif_title = $7 WHERE id = $8",
    )
    .bind(&combined)
    .bind(gid)
    .bind(gurl)
    .bind(gstill)
    .bind(gw)
    .bind(gh)
    .bind(gtitle)
    .bind(target_id)
    .execute(&mut *tx)
    .await?;

    // Copy source votes to target (union — skip duplicates)
    for voter_id in &source_vote_ids {
        sqlx::query("INSERT INTO votes (ticket_id, participant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(target_id)
            .bind(voter_id)
            .execute(&mut *tx)
            .await?;
    }

    // Move the comments across before the delete, or the cascade removes them with the card
    if !source_comment_ids.is_empty() {
        sqlx::query("UPDATE ticket_comments SET ticket_id = $1 WHERE ticket_id = $2")
            .bind(target_id)
            .bind(source_id)
            .execute(&mut *tx)
            .await?;
    }

    // Delete source ticket (cascade deletes its votes)
    sqlx::query("DELETE FROM tickets WHERE id = $1")
        .bind(source_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Some(MergeSnapshot {
        source_id: source.id,
        source_column_id: source.column_id,
        source_content: source.content,
        source_author_id: source.author_id,
        source_author_name: source.author_name,
        source_created_at: source.created_at,
        source_votes: source_vote_ids,
        source_carried_from_board_id: source.carried_from_board_id,
        source_carried_from_board_title: source.carried_from_board_title,
        source_comment_ids,
        source_gif,
        // The target keeps its own mark. The one from the source card waits here for the undo.
        source_rock_status: source.rock_status,
        source_done_at: source.done_at,
        target_id: target.id,
        target_original_content: target.content,
        target_original_gif: target_gif,
    }))
}

pub async fn undo_merge(pool: &PgPool, snapshot: &MergeSnapshot) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Restore target's original content, and with it the GIF the target had before the merge
    let (gid, gurl, gstill, gw, gh, gtitle) = gif_binds(snapshot.target_original_gif.as_ref());
    sqlx::query(
        "UPDATE tickets SET content = $1, gif_id = $2, gif_url = $3, gif_still_url = $4, \
         gif_width = $5, gif_height = $6, gif_title = $7 WHERE id = $8",
    )
    .bind(&snapshot.target_original_content)
    .bind(gid)
    .bind(gurl)
    .bind(gstill)
    .bind(gw)
    .bind(gh)
    .bind(gtitle)
    .bind(&snapshot.target_id)
    .execute(&mut *tx)
    .await?;

    // Re-create source ticket, GIF, rock status, done mark and all
    let (gid, gurl, gstill, gw, gh, gtitle) = gif_binds(snapshot.source_gif.as_ref());
    sqlx::query(
        "INSERT INTO tickets (id, column_id, content, author_id, author_name, created_at, \
         carried_from_board_id, carried_from_board_title, \
         gif_id, gif_url, gif_still_url, gif_width, gif_height, gif_title, rock_status, done_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    )
    .bind(&snapshot.source_id)
    .bind(&snapshot.source_column_id)
    .bind(&snapshot.source_content)
    .bind(&snapshot.source_author_id)
    .bind(&snapshot.source_author_name)
    .bind(snapshot.source_created_at)
    .bind(&snapshot.source_carried_from_board_id)
    .bind(&snapshot.source_carried_from_board_title)
    .bind(gid)
    .bind(gurl)
    .bind(gstill)
    .bind(gw)
    .bind(gh)
    .bind(gtitle)
    .bind(&snapshot.source_rock_status)
    .bind(snapshot.source_done_at)
    .execute(&mut *tx)
    .await?;

    // Re-create source votes
    for voter_id in &snapshot.source_votes {
        sqlx::query("INSERT INTO votes (ticket_id, participant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(&snapshot.source_id)
            .bind(voter_id)
            .execute(&mut *tx)
            .await?;
    }

    // Send the comments of the source card back to it. The card exists again by now.
    if !snapshot.source_comment_ids.is_empty() {
        sqlx::query("UPDATE ticket_comments SET ticket_id = $1 WHERE id = ANY($2)")
            .bind(&snapshot.source_id)
            .bind(&snapshot.source_comment_ids)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

// --- Split ---

pub async fn split_ticket(
    pool: &PgPool,
    ticket_id: &str,
    segment_index: usize,
    new_ticket_id: &str,
    participant_id: &str,
    participant_name: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let ticket = sqlx::query_as::<_, TicketRow>(
        &format!("SELECT {TICKET_COLUMNS} FROM tickets WHERE id = $1"),
    )
    .bind(ticket_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(ticket) = ticket else {
        return Ok(false);
    };

    let segments: Vec<&str> = ticket.content.split("\n---\n").collect();
    if segments.len() < 2 || segment_index >= segments.len() {
        return Ok(false);
    }

    let extracted = segments[segment_index].to_string();
    let remaining: Vec<&str> = segments
        .into_iter()
        .enumerate()
        .filter(|(i, _)| *i != segment_index)
        .map(|(_, s)| s)
        .collect();
    let updated_content = remaining.join("\n---\n");

    // Update original ticket
    sqlx::query("UPDATE tickets SET content = $1 WHERE id = $2")
        .bind(&updated_content)
        .bind(ticket_id)
        .execute(&mut *tx)
        .await?;

    // Insert new ticket with the extracted segment. It keeps the source board of the original.
    sqlx::query(
        "INSERT INTO tickets (id, column_id, content, author_id, author_name, created_at, carried_from_board_id, carried_from_board_title) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(new_ticket_id)
    .bind(&ticket.column_id)
    .bind(&extracted)
    .bind(participant_id)
    .bind(participant_name)
    .bind(Utc::now())
    .bind(&ticket.carried_from_board_id)
    .bind(&ticket.carried_from_board_title)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(true)
}

// --- Hide votes ---

pub async fn get_hide_votes(
    pool: &PgPool,
    board_id: &str,
) -> Result<Option<bool>, sqlx::Error> {
    let row = sqlx::query_as::<_, HideVotesRow>("SELECT hide_votes FROM boards WHERE id = $1")
        .bind(board_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.hide_votes))
}

pub async fn set_hide_votes(
    pool: &PgPool,
    board_id: &str,
    hide_votes: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE boards SET hide_votes = $1 WHERE id = $2")
        .bind(hide_votes)
        .bind(board_id)
        .execute(pool)
        .await?;
    Ok(())
}

// --- Blur ---

pub async fn set_blur(
    pool: &PgPool,
    board_id: &str,
    is_blurred: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE boards SET is_blurred = $1 WHERE id = $2")
        .bind(is_blurred)
        .bind(board_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_blur_state(
    pool: &PgPool,
    board_id: &str,
) -> Result<Option<bool>, sqlx::Error> {
    let row = sqlx::query_as::<_, BlurRow>("SELECT is_blurred FROM boards WHERE id = $1")
        .bind(board_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.is_blurred))
}

// --- Validation ---

pub async fn column_belongs_to_board(
    pool: &PgPool,
    column_id: &str,
    board_id: &str,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM columns WHERE id = $1 AND board_id = $2",
    )
    .bind(column_id)
    .bind(board_id)
    .fetch_one(pool)
    .await?;
    Ok(row.count > 0)
}

// --- Admin ---

pub async fn admin_global_stats(pool: &PgPool) -> Result<AdminStatsRow, sqlx::Error> {
    sqlx::query_as::<_, AdminStatsRow>(
        r#"
        SELECT
            (SELECT COUNT(*) FROM boards) AS board_count,
            (SELECT COUNT(*) FROM tickets) AS ticket_count,
            (SELECT COUNT(*) FROM votes) AS vote_count
        "#,
    )
    .fetch_one(pool)
    .await
}

pub async fn admin_list_boards(pool: &PgPool) -> Result<Vec<AdminBoardRow>, sqlx::Error> {
    sqlx::query_as::<_, AdminBoardRow>(
        r#"
        SELECT
            b.id,
            b.title,
            b.is_blurred,
            b.created_at,
            (SELECT COUNT(*) FROM columns c WHERE c.board_id = b.id) AS column_count,
            (SELECT COUNT(*) FROM tickets t JOIN columns c ON t.column_id = c.id WHERE c.board_id = b.id) AS ticket_count,
            (SELECT COUNT(*) FROM votes v JOIN tickets t ON v.ticket_id = t.id JOIN columns c ON t.column_id = c.id WHERE c.board_id = b.id) AS vote_count
        FROM boards b
        ORDER BY b.created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn admin_delete_board(pool: &PgPool, board_id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM boards WHERE id = $1")
        .bind(board_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// --- Vote Limit ---

pub async fn set_vote_limit(
    pool: &PgPool,
    board_id: &str,
    limit: Option<i32>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE boards SET vote_limit_per_column = $1 WHERE id = $2")
        .bind(limit)
        .bind(board_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_vote_limit(
    pool: &PgPool,
    board_id: &str,
) -> Result<Option<i32>, sqlx::Error> {
    let row = sqlx::query_as::<_, VoteLimitRow>(
        "SELECT vote_limit_per_column FROM boards WHERE id = $1",
    )
    .bind(board_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|r| r.vote_limit_per_column))
}

pub async fn has_vote(
    pool: &PgPool,
    ticket_id: &str,
    participant_id: &str,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM votes WHERE ticket_id = $1 AND participant_id = $2",
    )
    .bind(ticket_id)
    .bind(participant_id)
    .fetch_one(pool)
    .await?;
    Ok(row.count > 0)
}

pub async fn get_ticket_column_id(
    pool: &PgPool,
    ticket_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_as::<_, TicketColumnRow>(
        "SELECT column_id FROM tickets WHERE id = $1",
    )
    .bind(ticket_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.column_id))
}

pub async fn count_votes_in_column(
    pool: &PgPool,
    column_id: &str,
    participant_id: &str,
) -> Result<i64, sqlx::Error> {
    let row = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM votes v JOIN tickets t ON v.ticket_id = t.id WHERE t.column_id = $1 AND v.participant_id = $2",
    )
    .bind(column_id)
    .bind(participant_id)
    .fetch_one(pool)
    .await?;
    Ok(row.count)
}

// --- Timer ---

pub async fn set_timer_end(
    pool: &PgPool,
    board_id: &str,
    timer_end: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE boards SET timer_end = $1 WHERE id = $2")
        .bind(timer_end)
        .bind(board_id)
        .execute(pool)
        .await?;
    Ok(())
}

// --- Editor Requests & Board Editors ---

pub async fn get_board_editors(
    pool: &PgPool,
    board_id: &str,
) -> Result<Vec<EditorView>, sqlx::Error> {
    let rows = sqlx::query_as::<_, EditorRow>(
        "SELECT participant_id, participant_name FROM board_editors WHERE board_id = $1",
    )
    .bind(board_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| EditorView {
            participant_id: r.participant_id,
            participant_name: r.participant_name,
        })
        .collect())
}

pub async fn get_editor_requests(
    pool: &PgPool,
    board_id: &str,
) -> Result<Vec<EditorRequestView>, sqlx::Error> {
    let rows = sqlx::query_as::<_, EditorRequestRow>(
        "SELECT participant_id, participant_name FROM editor_requests WHERE board_id = $1 ORDER BY created_at",
    )
    .bind(board_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| EditorRequestView {
            participant_id: r.participant_id,
            participant_name: r.participant_name,
        })
        .collect())
}

pub async fn is_editor(
    pool: &PgPool,
    board_id: &str,
    participant_id: &str,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM board_editors WHERE board_id = $1 AND participant_id = $2",
    )
    .bind(board_id)
    .bind(participant_id)
    .fetch_one(pool)
    .await?;
    Ok(row.count > 0)
}

pub async fn create_editor_request(
    pool: &PgPool,
    board_id: &str,
    participant_id: &str,
    participant_name: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO editor_requests (board_id, participant_id, participant_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(board_id)
    .bind(participant_id)
    .bind(participant_name)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn approve_editor(
    pool: &PgPool,
    board_id: &str,
    participant_id: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Fetch the request to get the name before deleting
    let request = sqlx::query_as::<_, EditorRequestRow>(
        "SELECT participant_id, participant_name FROM editor_requests WHERE board_id = $1 AND participant_id = $2",
    )
    .bind(board_id)
    .bind(participant_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(request) = request else {
        return Ok(false);
    };

    sqlx::query(
        "DELETE FROM editor_requests WHERE board_id = $1 AND participant_id = $2",
    )
    .bind(board_id)
    .bind(participant_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO board_editors (board_id, participant_id, participant_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(board_id)
    .bind(participant_id)
    .bind(&request.participant_name)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(true)
}

pub async fn decline_editor(
    pool: &PgPool,
    board_id: &str,
    participant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM editor_requests WHERE board_id = $1 AND participant_id = $2",
    )
    .bind(board_id)
    .bind(participant_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn remove_editor(
    pool: &PgPool,
    board_id: &str,
    participant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM board_editors WHERE board_id = $1 AND participant_id = $2",
    )
    .bind(board_id)
    .bind(participant_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

// --- Teams ---

pub async fn list_teams(pool: &PgPool) -> Result<Vec<crate::models::Team>, sqlx::Error> {
    let team_rows = sqlx::query_as::<_, TeamRow>("SELECT id, name FROM teams ORDER BY name")
        .fetch_all(pool)
        .await?;

    let member_rows = sqlx::query_as::<_, TeamMemberRow>(
        "SELECT id, team_id, name FROM team_members ORDER BY position",
    )
    .fetch_all(pool)
    .await?;

    let mut teams: Vec<crate::models::Team> = team_rows
        .into_iter()
        .map(|t| crate::models::Team {
            id: t.id,
            name: t.name,
            members: Vec::new(),
        })
        .collect();

    for m in member_rows {
        if let Some(team) = teams.iter_mut().find(|t| t.id == m.team_id) {
            team.members.push(crate::models::TeamMember {
                id: m.id,
                name: m.name,
            });
        }
    }

    Ok(teams)
}

pub async fn create_team(
    pool: &PgPool,
    id: &str,
    name: &str,
    members: &[(String, String)], // (id, name)
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query("INSERT INTO teams (id, name) VALUES ($1, $2)")
        .bind(id)
        .bind(name)
        .execute(&mut *tx)
        .await?;

    for (pos, (member_id, member_name)) in members.iter().enumerate() {
        sqlx::query(
            "INSERT INTO team_members (id, team_id, name, position) VALUES ($1, $2, $3, $4)",
        )
        .bind(member_id)
        .bind(id)
        .bind(member_name)
        .bind(pos as i32)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

pub async fn update_team(
    pool: &PgPool,
    id: &str,
    name: &str,
    members: &[(String, String)],
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let result = sqlx::query("UPDATE teams SET name = $1 WHERE id = $2")
        .bind(name)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    if result.rows_affected() == 0 {
        return Ok(false);
    }

    sqlx::query("DELETE FROM team_members WHERE team_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    for (pos, (member_id, member_name)) in members.iter().enumerate() {
        sqlx::query(
            "INSERT INTO team_members (id, team_id, name, position) VALUES ($1, $2, $3, $4)",
        )
        .bind(member_id)
        .bind(id)
        .bind(member_name)
        .bind(pos as i32)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(true)
}

pub async fn delete_team(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM teams WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// --- Actions carry-over ---

/// Lists the boards that hold at least one action card, newest first.
/// `labels` matches a board that carries any one of them.
pub async fn list_action_sources(
    pool: &PgPool,
    exclude_board_id: &str,
    search: &str,
    labels: &[String],
    limit: i64,
) -> Result<Vec<ActionSourceBoard>, sqlx::Error> {
    let rows = sqlx::query_as::<_, ActionSourceRow>(
        r#"
        SELECT
            b.id,
            b.title,
            b.created_at,
            (SELECT COUNT(*) FROM tickets t JOIN columns c ON t.column_id = c.id
              WHERE c.board_id = b.id AND c.role = 'actions') AS action_count,
            COALESCE((SELECT array_agg(l.label ORDER BY l.label) FROM board_labels l WHERE l.board_id = b.id), '{}'::text[]) AS labels
        FROM boards b
        WHERE b.id <> $1
          AND ($2 = '' OR b.title ILIKE '%' || $2 || '%')
          AND (cardinality($3::text[]) = 0
               OR EXISTS (SELECT 1 FROM board_labels l WHERE l.board_id = b.id AND l.label = ANY($3)))
          AND EXISTS (SELECT 1 FROM tickets t JOIN columns c ON t.column_id = c.id
                       WHERE c.board_id = b.id AND c.role = 'actions')
        ORDER BY b.created_at DESC
        LIMIT $4
        "#,
    )
    .bind(exclude_board_id)
    .bind(search)
    .bind(labels)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| ActionSourceBoard {
            id: r.id,
            title: r.title,
            created_at: r.created_at,
            action_count: r.action_count,
            labels: r.labels,
        })
        .collect())
}

/// Copies the action cards of the source board into the Previous Actions column of the target
/// board. A card whose text is already there is skipped, so a second copy adds nothing. Votes do
/// not move. Returns `None` when a board or one of the two columns does not exist.
pub async fn copy_actions(
    pool: &PgPool,
    source_board_id: &str,
    target_board_id: &str,
) -> Result<Option<ImportResult>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let source_column = sqlx::query_as::<_, ColumnIdRow>(
        "SELECT id FROM columns WHERE board_id = $1 AND role = $2",
    )
    .bind(source_board_id)
    .bind(ROLE_ACTIONS)
    .fetch_optional(&mut *tx)
    .await?;

    let target_column = sqlx::query_as::<_, ColumnIdRow>(
        "SELECT id FROM columns WHERE board_id = $1 AND role = $2",
    )
    .bind(target_board_id)
    .bind(ROLE_PREVIOUS_ACTIONS)
    .fetch_optional(&mut *tx)
    .await?;

    let source_title = sqlx::query_as::<_, TitleRow>("SELECT title FROM boards WHERE id = $1")
        .bind(source_board_id)
        .fetch_optional(&mut *tx)
        .await?;

    let (Some(source_column), Some(target_column), Some(source_title)) =
        (source_column, target_column, source_title)
    else {
        return Ok(None);
    };

    let target_anonymous = sqlx::query_as::<_, AnonymousRow>(
        "SELECT is_anonymous FROM boards WHERE id = $1",
    )
    .bind(target_board_id)
    .fetch_optional(&mut *tx)
    .await?
    .map(|r| r.is_anonymous)
    .unwrap_or(false);

    let source_tickets = sqlx::query_as::<_, TicketRow>(
        &format!("SELECT {TICKET_COLUMNS} FROM tickets WHERE column_id = $1 ORDER BY created_at"),
    )
    .bind(&source_column.id)
    .fetch_all(&mut *tx)
    .await?;

    let existing = sqlx::query_as::<_, ContentRow>("SELECT content FROM tickets WHERE column_id = $1")
        .bind(&target_column.id)
        .fetch_all(&mut *tx)
        .await?;
    let mut existing: HashSet<String> = existing
        .into_iter()
        .map(|r| r.content.trim().to_string())
        .collect();

    let mut imported = 0usize;
    let mut skipped = 0usize;

    for mut ticket in source_tickets {
        if !existing.insert(ticket.content.trim().to_string()) {
            skipped += 1;
            continue;
        }

        // The GIF comes across with the action, so the record of the last retro reads the same way.
        let gif = ticket.take_gif();
        let author_name = if target_anonymous {
            String::new()
        } else {
            ticket.author_name
        };

        // A done action comes across done. Previous Actions is the record of the last retro, and
        // the record has to say which of the actions the team closed.
        let (gid, gurl, gstill, gw, gh, gtitle) = gif_binds(gif.as_ref());
        sqlx::query(
            "INSERT INTO tickets (id, column_id, content, author_id, author_name, created_at, \
             carried_from_board_id, carried_from_board_title, \
             gif_id, gif_url, gif_still_url, gif_width, gif_height, gif_title, done_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        )
        .bind(nanoid!(8))
        .bind(&target_column.id)
        .bind(&ticket.content)
        .bind(&ticket.author_id)
        .bind(&author_name)
        .bind(Utc::now())
        .bind(source_board_id)
        .bind(&source_title.title)
        .bind(gid)
        .bind(gurl)
        .bind(gstill)
        .bind(gw)
        .bind(gh)
        .bind(gtitle)
        .bind(ticket.done_at)
        .execute(&mut *tx)
        .await?;

        imported += 1;
    }

    tx.commit().await?;

    Ok(Some(ImportResult { imported, skipped }))
}

// --- Labels ---

pub async fn get_board_labels(pool: &PgPool, board_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query_as::<_, LabelNameRow>(
        "SELECT label FROM board_labels WHERE board_id = $1 ORDER BY label",
    )
    .bind(board_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.label).collect())
}

pub async fn set_board_labels(
    pool: &PgPool,
    board_id: &str,
    labels: &[String],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query("DELETE FROM board_labels WHERE board_id = $1")
        .bind(board_id)
        .execute(&mut *tx)
        .await?;

    for label in labels {
        sqlx::query("INSERT INTO board_labels (board_id, label) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(board_id)
            .bind(label)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

pub async fn list_labels(pool: &PgPool) -> Result<Vec<LabelCount>, sqlx::Error> {
    let rows = sqlx::query_as::<_, LabelRow>(
        "SELECT label, COUNT(*) AS board_count FROM board_labels GROUP BY label ORDER BY board_count DESC, label",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| LabelCount {
            label: r.label,
            board_count: r.board_count,
        })
        .collect())
}

// --- Level 10 ---

/// The template a board was made from, or None for a custom board or a board that is not there.
pub async fn get_board_template_id(
    pool: &PgPool,
    board_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_as::<_, TemplateIdRow>("SELECT template_id FROM boards WHERE id = $1")
        .bind(board_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.and_then(|r| r.template_id))
}

/// Tells whether a card sits in the Rocks column of this board. Only a Level 10 board has such a
/// column, so this one check keeps the rock status on the boards that want it.
pub async fn ticket_in_rocks_column(
    pool: &PgPool,
    ticket_id: &str,
    board_id: &str,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM tickets t JOIN columns c ON c.id = t.column_id \
         WHERE t.id = $1 AND c.board_id = $2 AND c.role = $3",
    )
    .bind(ticket_id)
    .bind(board_id)
    .bind(ROLE_ROCKS)
    .fetch_one(pool)
    .await?;
    Ok(row.count > 0)
}

/// Tells whether a card sits in one of the two action columns of this board. An action is the
/// only card that can be finished, so this one check keeps the done mark where it belongs.
pub async fn ticket_in_action_column(
    pool: &PgPool,
    ticket_id: &str,
    board_id: &str,
) -> Result<bool, sqlx::Error> {
    let row = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) as count FROM tickets t JOIN columns c ON c.id = t.column_id \
         WHERE t.id = $1 AND c.board_id = $2 AND c.role = ANY($3)",
    )
    .bind(ticket_id)
    .bind(board_id)
    .bind(&DONE_COLUMN_ROLES[..])
    .fetch_one(pool)
    .await?;
    Ok(row.count > 0)
}

/// Closes an action at the given time, or opens it again with None.
pub async fn set_ticket_done(
    pool: &PgPool,
    ticket_id: &str,
    done_at: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE tickets SET done_at = $1 WHERE id = $2")
        .bind(done_at)
        .bind(ticket_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Marks a rock on track or off track. None takes the mark off again.
pub async fn set_rock_status(
    pool: &PgPool,
    ticket_id: &str,
    status: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE tickets SET rock_status = $1 WHERE id = $2")
        .bind(status)
        .bind(ticket_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Records what one participant thinks of the meeting. A second mark replaces the first.
pub async fn upsert_meeting_rating(
    pool: &PgPool,
    board_id: &str,
    participant_id: &str,
    rating: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO meeting_ratings (board_id, participant_id, rating) VALUES ($1, $2, $3) \
         ON CONFLICT (board_id, participant_id) DO UPDATE SET rating = EXCLUDED.rating",
    )
    .bind(board_id)
    .bind(participant_id)
    .bind(rating)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_meeting_ratings(
    pool: &PgPool,
    board_id: &str,
) -> Result<Vec<MeetingRatingView>, sqlx::Error> {
    let rows = sqlx::query_as::<_, MeetingRatingRow>(
        "SELECT participant_id, rating FROM meeting_ratings WHERE board_id = $1",
    )
    .bind(board_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| MeetingRatingView {
            participant_id: r.participant_id,
            rating: r.rating,
        })
        .collect())
}

pub async fn get_scorecard(
    pool: &PgPool,
    board_id: &str,
) -> Result<Vec<ScorecardMetric>, sqlx::Error> {
    let rows = sqlx::query_as::<_, ScorecardRow>(
        "SELECT id, name, goal, actual, on_track, position FROM scorecard_metrics \
         WHERE board_id = $1 ORDER BY position, id",
    )
    .bind(board_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| ScorecardMetric {
            id: r.id,
            name: r.name,
            goal: r.goal,
            actual: r.actual,
            on_track: r.on_track,
        })
        .collect())
}

/// Adds a line at the foot of the scorecard.
pub async fn add_scorecard_metric(
    pool: &PgPool,
    metric_id: &str,
    board_id: &str,
    name: &str,
    goal: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO scorecard_metrics (id, board_id, name, goal, position) \
         SELECT $1, $2, $3, $4, COALESCE(MAX(position) + 1, 0) \
         FROM scorecard_metrics WHERE board_id = $2",
    )
    .bind(metric_id)
    .bind(board_id)
    .bind(name)
    .bind(goal)
    .execute(pool)
    .await?;
    Ok(())
}

/// Writes a whole scorecard line. The board is part of the WHERE, so a caller cannot reach
/// a line of another board with an id they guessed. False means nothing changed.
pub async fn update_scorecard_metric(
    pool: &PgPool,
    metric_id: &str,
    board_id: &str,
    name: &str,
    goal: &str,
    actual: &str,
    on_track: Option<bool>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE scorecard_metrics SET name = $1, goal = $2, actual = $3, on_track = $4 \
         WHERE id = $5 AND board_id = $6",
    )
    .bind(name)
    .bind(goal)
    .bind(actual)
    .bind(on_track)
    .bind(metric_id)
    .bind(board_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn remove_scorecard_metric(
    pool: &PgPool,
    metric_id: &str,
    board_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM scorecard_metrics WHERE id = $1 AND board_id = $2")
        .bind(metric_id)
        .bind(board_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// --- Authorization ---

/// Tells if the caller can change this board: the facilitator token, the facilitator cookie, or a
/// place in the editor list. This is the rule that the WebSocket handler also applies.
pub async fn is_board_privileged(
    pool: &PgPool,
    board_id: &str,
    facilitator_token: Option<&str>,
    facilitator_id_cookie: Option<&str>,
    participant_id: Option<&str>,
) -> Result<bool, sqlx::Error> {
    if let Some(token) = facilitator_token {
        if let Some(board_token) = get_board_facilitator_token(pool, board_id).await? {
            if board_token == token {
                return Ok(true);
            }
        }
    }

    if let Some(cookie) = facilitator_id_cookie {
        if let Some(board_facilitator) = get_board_facilitator_id(pool, board_id).await? {
            if board_facilitator == cookie {
                return Ok(true);
            }
        }
    }

    if let Some(participant_id) = participant_id {
        if is_editor(pool, board_id, participant_id).await? {
            return Ok(true);
        }
    }

    Ok(false)
}

// --- Row types for query_as ---

#[derive(sqlx::FromRow)]
struct BoardRow {
    id: String,
    title: String,
    is_blurred: bool,
    is_anonymous: bool,
    hide_votes: bool,
    facilitator_token: String,
    facilitator_id: Option<String>,
    created_at: DateTime<Utc>,
    vote_limit_per_column: Option<i32>,
    timer_end: Option<DateTime<Utc>>,
    template_id: Option<String>,
}

#[derive(sqlx::FromRow)]
struct HideVotesRow {
    hide_votes: bool,
}

#[derive(sqlx::FromRow)]
struct ColumnRow {
    id: String,
    name: String,
    #[allow(dead_code)]
    position: i32,
    role: Option<String>,
}

#[derive(sqlx::FromRow)]
struct TicketRow {
    id: String,
    column_id: String,
    content: String,
    author_id: String,
    author_name: String,
    created_at: DateTime<Utc>,
    carried_from_board_id: Option<String>,
    carried_from_board_title: Option<String>,
    gif_id: Option<String>,
    gif_url: Option<String>,
    gif_still_url: Option<String>,
    gif_width: Option<i32>,
    gif_height: Option<i32>,
    gif_title: Option<String>,
    rock_status: Option<String>,
    done_at: Option<DateTime<Utc>>,
}

impl TicketRow {
    fn take_gif(&mut self) -> Option<Gif> {
        row_gif(
            self.gif_id.take(),
            self.gif_url.take(),
            self.gif_still_url.take(),
            self.gif_width.take(),
            self.gif_height.take(),
            self.gif_title.take(),
        )
    }
}

impl CommentRow {
    fn take_gif(&mut self) -> Option<Gif> {
        row_gif(
            self.gif_id.take(),
            self.gif_url.take(),
            self.gif_still_url.take(),
            self.gif_width.take(),
            self.gif_height.take(),
            self.gif_title.take(),
        )
    }
}

/// Puts the six GIF columns of a row back together. A row that holds only part of a GIF
/// gives None, so a half-written picture never reaches the board.
fn row_gif(
    id: Option<String>,
    url: Option<String>,
    still_url: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
    title: Option<String>,
) -> Option<Gif> {
    Some(Gif {
        id: id?,
        url: url?,
        still_url: still_url?,
        width: width?,
        height: height?,
        title: title?,
    })
}

/// Spreads a GIF into the six values that the INSERT and UPDATE statements bind,
/// so that a card with no GIF binds six nulls.
fn gif_binds(
    gif: Option<&Gif>,
) -> (
    Option<&str>,
    Option<&str>,
    Option<&str>,
    Option<i32>,
    Option<i32>,
    Option<&str>,
) {
    match gif {
        Some(g) => (
            Some(g.id.as_str()),
            Some(g.url.as_str()),
            Some(g.still_url.as_str()),
            Some(g.width),
            Some(g.height),
            Some(g.title.as_str()),
        ),
        None => (None, None, None, None, None, None),
    }
}

#[derive(sqlx::FromRow)]
struct VoteRow {
    ticket_id: String,
    participant_id: String,
}

#[derive(sqlx::FromRow)]
struct CommentRow {
    id: String,
    ticket_id: String,
    content: String,
    author_id: String,
    author_name: String,
    created_at: DateTime<Utc>,
    gif_id: Option<String>,
    gif_url: Option<String>,
    gif_still_url: Option<String>,
    gif_width: Option<i32>,
    gif_height: Option<i32>,
    gif_title: Option<String>,
}

#[derive(sqlx::FromRow)]
struct CommentIdRow {
    id: String,
}

#[derive(sqlx::FromRow)]
struct FacilitatorTokenRow {
    facilitator_token: String,
}

#[derive(sqlx::FromRow)]
struct AuthorRow {
    author_id: String,
}

#[derive(sqlx::FromRow)]
struct BlurRow {
    is_blurred: bool,
}

#[derive(sqlx::FromRow)]
struct AnonymousRow {
    is_anonymous: bool,
}

#[derive(sqlx::FromRow)]
struct FacilitatorIdRow {
    facilitator_id: Option<String>,
}

#[derive(sqlx::FromRow)]
struct MyBoardRow {
    id: String,
    title: String,
    created_at: DateTime<Utc>,
    is_anonymous: bool,
    column_count: i64,
    ticket_count: i64,
    labels: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct ActionSourceRow {
    id: String,
    title: String,
    created_at: DateTime<Utc>,
    action_count: i64,
    labels: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct LabelRow {
    label: String,
    board_count: i64,
}

#[derive(sqlx::FromRow)]
struct LabelNameRow {
    label: String,
}

#[derive(sqlx::FromRow)]
struct ColumnIdRow {
    id: String,
}

#[derive(sqlx::FromRow)]
struct ContentRow {
    content: String,
}

#[derive(sqlx::FromRow)]
struct TitleRow {
    title: String,
}

#[derive(sqlx::FromRow)]
struct TemplateRow {
    id: String,
    name: String,
    description: String,
    columns: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct CountRow {
    count: i64,
}

#[derive(sqlx::FromRow)]
struct TemplateIdRow {
    template_id: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ScorecardRow {
    id: String,
    name: String,
    goal: String,
    actual: String,
    on_track: Option<bool>,
    #[allow(dead_code)]
    position: i32,
}

#[derive(sqlx::FromRow)]
struct MeetingRatingRow {
    participant_id: String,
    rating: i32,
}

#[derive(sqlx::FromRow)]
struct VoteLimitRow {
    vote_limit_per_column: Option<i32>,
}

#[derive(sqlx::FromRow)]
struct TicketColumnRow {
    column_id: String,
}

#[derive(sqlx::FromRow, Debug)]
pub struct AdminStatsRow {
    pub board_count: i64,
    pub ticket_count: i64,
    pub vote_count: i64,
}

#[derive(sqlx::FromRow, Debug)]
pub struct AdminBoardRow {
    pub id: String,
    pub title: String,
    pub is_blurred: bool,
    pub created_at: DateTime<Utc>,
    pub column_count: i64,
    pub ticket_count: i64,
    pub vote_count: i64,
}

#[derive(sqlx::FromRow)]
struct EditorRow {
    participant_id: String,
    participant_name: String,
}

#[derive(sqlx::FromRow)]
struct EditorRequestRow {
    participant_id: String,
    participant_name: String,
}

#[derive(sqlx::FromRow)]
struct TeamRow {
    id: String,
    name: String,
}

#[derive(sqlx::FromRow)]
struct TeamMemberRow {
    id: String,
    team_id: String,
    name: String,
}
