-- Sticky notes and text frames live in the same table as screens so arrows
-- can point at any of them. Image columns stay empty for text items.
-- kind: screen | sticky | frame

alter table screens add column if not exists kind text not null default 'screen';
alter table screens add column if not exists body text not null default '';
alter table screens add column if not exists fill text;

alter table screens drop constraint if exists screens_kind_check;
alter table screens add constraint screens_kind_check
  check (kind in ('screen', 'sticky', 'frame'));
