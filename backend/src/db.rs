use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::HashSet;

use crate::models::{Board, Column, Ticket};

// --- Board ---

pub async fn create_board(
    pool: &PgPool,
    id: &str,
    title: &str,
    facilitator_token: &str,
    facilitator_id: &str,
    columns: &[(String, String)], // (id, name)
    created_at: DateTime<Utc>,
    is_anonymous: bool,
) -> Result<Board, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO boards (id, title, facilitator_token, facilitator_id, is_blurred, is_anonymous, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(title)
    .bind(facilitator_token)
    .bind(facilitator_id)
    .bind(true)
    .bind(is_anonymous)
    .bind(created_at)
    .execute(&mut *tx)
    .await?;

    let mut cols = Vec::new();
    for (pos, (col_id, col_name)) in columns.iter().enumerate() {
        sqlx::query(
            "INSERT INTO columns (id, board_id, name, position) VALUES ($1, $2, $3, $4)",
        )
        .bind(col_id)
        .bind(id)
        .bind(col_name)
        .bind(pos as i32)
        .execute(&mut *tx)
        .await?;

        cols.push(Column {
            id: col_id.clone(),
            name: col_name.clone(),
            tickets: Vec::new(),
        });
    }

    tx.commit().await?;

    Ok(Board {
        id: id.to_string(),
        title: title.to_string(),
        columns: cols,
        is_blurred: true,
        is_anonymous,
        created_at,
        facilitator_token: facilitator_token.to_string(),
        facilitator_id: Some(facilitator_id.to_string()),
        participants: Vec::new(),
    })
}

pub async fn get_board(pool: &PgPool, board_id: &str) -> Result<Option<Board>, sqlx::Error> {
    let row = sqlx::query_as::<_, BoardRow>(
        "SELECT id, title, is_blurred, is_anonymous, facilitator_token, facilitator_id, created_at FROM boards WHERE id = $1",
    )
    .bind(board_id)
    .fetch_optional(pool)
    .await?;

    let Some(board_row) = row else {
        return Ok(None);
    };

    let col_rows = sqlx::query_as::<_, ColumnRow>(
        "SELECT id, name, position FROM columns WHERE board_id = $1 ORDER BY position",
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
            "SELECT id, column_id, content, author_id, author_name, created_at FROM tickets WHERE column_id = ANY($1) ORDER BY created_at",
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

    // Group votes by ticket_id
    let mut votes_map: std::collections::HashMap<String, HashSet<String>> =
        std::collections::HashMap::new();
    for v in vote_rows {
        votes_map
            .entry(v.ticket_id)
            .or_default()
            .insert(v.participant_id);
    }

    // Group tickets by column_id
    let mut tickets_map: std::collections::HashMap<String, Vec<Ticket>> =
        std::collections::HashMap::new();
    for t in ticket_rows {
        let votes = votes_map.remove(&t.id).unwrap_or_default();
        tickets_map.entry(t.column_id.clone()).or_default().push(Ticket {
            id: t.id,
            content: t.content,
            author_id: t.author_id,
            author_name: t.author_name,
            votes,
            created_at: t.created_at,
        });
    }

    let columns = col_rows
        .into_iter()
        .map(|c| {
            let tickets = tickets_map.remove(&c.id).unwrap_or_default();
            Column {
                id: c.id,
                name: c.name,
                tickets,
            }
        })
        .collect();

    Ok(Some(Board {
        id: board_row.id,
        title: board_row.title,
        columns,
        is_blurred: board_row.is_blurred,
        is_anonymous: board_row.is_anonymous,
        created_at: board_row.created_at,
        facilitator_token: board_row.facilitator_token,
        facilitator_id: board_row.facilitator_id,
        participants: Vec::new(),
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
            (SELECT COUNT(*) FROM tickets t JOIN columns c ON t.column_id = c.id WHERE c.board_id = b.id) AS ticket_count
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
        })
        .collect())
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
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO tickets (id, column_id, content, author_id, author_name, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(ticket_id)
    .bind(column_id)
    .bind(content)
    .bind(author_id)
    .bind(author_name)
    .bind(created_at)
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
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE tickets SET content = $1 WHERE id = $2")
        .bind(content)
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

// --- Row types for query_as ---

#[derive(sqlx::FromRow)]
struct BoardRow {
    id: String,
    title: String,
    is_blurred: bool,
    is_anonymous: bool,
    facilitator_token: String,
    facilitator_id: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct ColumnRow {
    id: String,
    name: String,
    #[allow(dead_code)]
    position: i32,
}

#[derive(sqlx::FromRow)]
struct TicketRow {
    id: String,
    column_id: String,
    content: String,
    author_id: String,
    author_name: String,
    created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct VoteRow {
    ticket_id: String,
    participant_id: String,
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
}

#[derive(sqlx::FromRow)]
struct CountRow {
    count: i64,
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
