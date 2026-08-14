-- The first column of a Level 10 board is where the team puts what it has closed, so it reads
-- "Solved". Only the template row changes here, because a board is a copy of the template and
-- not a view of it: the boards already made keep the columns they were made with, and an admin
-- brings the new name across with "Apply to boards".
--
-- array_replace leaves a template that already says "Solved" alone, so this runs twice safely.
UPDATE templates
SET columns = array_replace(columns, 'Segue', 'Solved')
WHERE id = 'level10';
