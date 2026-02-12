CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    columns TEXT[] NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

INSERT INTO templates (id, name, description, columns, position) VALUES
  ('classic', 'Classic', 'The tried-and-true format', '{"Went Well","To Improve","Action Items"}', 0),
  ('start-stop-continue', 'Start Stop Continue', 'Focus on behavioral changes', '{"Start","Stop","Continue"}', 1),
  ('4ls', '4Ls', 'Reflect on the full experience', '{"Liked","Learned","Lacked","Longed For"}', 2),
  ('mad-sad-glad', 'Mad Sad Glad', 'Emotions-first retrospective', '{"Mad","Sad","Glad"}', 3),
  ('sailboat', 'Sailboat', 'Navigate with a nautical metaphor', '{"Wind","Anchors","Rocks","Island"}', 4),
  ('daki', 'DAKI', 'Prioritize concrete actions', '{"Drop","Add","Keep","Improve"}', 5);
