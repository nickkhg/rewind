-- A Level 10 meeting reads its carried items after the headlines, not before the segue, so the
-- template now names 'Previous Actions' directly after 'Headlines'. Naming the column is what
-- places it: create_board and the apply pass match it by role and never make a second one.
--
-- The guard leaves a template that already names 'Previous Actions' alone, so this runs twice
-- safely. A template with no 'Headlines' column is left alone too: there is no place to put it.
UPDATE templates
SET columns = columns[1:array_position(columns, 'Headlines')]
    || 'Previous Actions'::text
    || columns[array_position(columns, 'Headlines') + 1:]
WHERE id = 'level10'
  AND 'Headlines' = ANY(columns)
  AND NOT ('Previous Actions' = ANY(columns));

-- The boards already made from the template follow, because a board is a copy of its template
-- and the copy holds the old order. Each Level 10 board moves its previous_actions column to
-- sit directly after the column named 'Headlines', and the positions are renumbered dense.
-- A board with no 'Headlines' column is left untouched: it was reshaped by hand, and there is
-- no place the move could mean.
--
-- The sort gives the previous_actions column the position of 'Headlines' and a tie-break that
-- puts it second: Headlines first, the carried items right behind it, everything else by the
-- position it already holds. Running it again finds that order in place and changes nothing.
WITH level10_boards AS (
    SELECT b.id
    FROM boards b
    WHERE b.template_id = 'level10'
      AND EXISTS (
          SELECT 1 FROM columns h WHERE h.board_id = b.id AND h.name = 'Headlines'
      )
),
reordered AS (
    SELECT c.id,
           row_number() OVER (
               PARTITION BY c.board_id
               ORDER BY
                   CASE WHEN c.role = 'previous_actions'
                        THEN (SELECT min(h.position) FROM columns h
                              WHERE h.board_id = c.board_id AND h.name = 'Headlines')
                        ELSE c.position END,
                   CASE WHEN c.role = 'previous_actions' THEN 1 ELSE 0 END,
                   c.position
           ) - 1 AS new_position
    FROM columns c
    JOIN level10_boards lb ON lb.id = c.board_id
)
UPDATE columns
SET position = reordered.new_position
FROM reordered
WHERE columns.id = reordered.id
  AND columns.position <> reordered.new_position;
