-- Admin panel product media: production-capable RPCs over the existing
-- public.product_media table and the private 'attires-product-drafts'
-- bucket (created by 20261030000400_private_product_gallery.sql).
--
-- Production-capable by design: SECURITY DEFINER + private.require_admin
-- (permission + MFA AAL2), NO staging checks and NO staging-URL checks.
-- Unlike the older admin_edit_product_gallery, these RPCs work for
-- published/archived products too: the new panel manages real catalogue
-- images, not draft-only galleries. Nothing here changes the existing
-- table, its policies or the older RPC.
--
-- STORAGE ORDERING CONTRACT (the action layer must follow it exactly):
-- Restrictive storage policies block deleting or overwriting bytes while a
-- product_media row references them. So:
-- * ADD: upload bytes FIRST, then call admin_add_product_media. If the RPC
--   fails, the action removes the orphan bytes.
-- * REMOVE: call admin_remove_product_media FIRST (it deletes the row and
--   returns the storage path), then remove the bytes.
-- * REPLACE: upload the new bytes, remove the old row, add the new row at
--   the same position, then remove the old bytes.
begin;

-- Add one already-uploaded image. p_position is 0-based; null appends at
-- the end. An explicit position shifts later images up by one (the
-- deferrable unique(product_id, position) constraint makes the shift safe
-- inside this transaction). p_storage_object_id may be null, in which case
-- the object is resolved from storage.objects by path.
create function public.admin_add_product_media(
  p_product_id uuid, p_storage_path text, p_storage_object_id uuid,
  p_alt_text text, p_position integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  product_row public.products;
  object_id uuid;
  media_id uuid := gen_random_uuid();
  media_count integer;
  target_position integer;
  alt_value text;
begin
  perform private.require_admin('catalogue.manage');
  alt_value := coalesce(p_alt_text, '');
  if p_product_id is null or p_storage_path is null
     or p_storage_path !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
     or length(alt_value) > 300
     or (p_position is not null and p_position not between 0 and 19) then
    raise exception 'Invalid product image reference' using errcode = '22023';
  end if;
  select * into product_row from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found' using errcode = '22023'; end if;
  -- Lock the object row as well, so attachment cannot race Storage deletion.
  select id into object_id from storage.objects
   where bucket_id = 'attires-product-drafts' and name = p_storage_path
     and metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
   for update;
  if not found then raise exception 'Uploaded image not found' using errcode = '22023'; end if;
  if p_storage_object_id is not null and p_storage_object_id <> object_id then
    raise exception 'Image reference does not match the uploaded file' using errcode = '22023';
  end if;
  if exists (select 1 from public.product_media
              where product_id = p_product_id and storage_path = p_storage_path) then
    raise exception 'This image is already attached to the product' using errcode = '22023';
  end if;
  select count(*) into media_count from public.product_media where product_id = p_product_id;
  if media_count >= 20 then
    raise exception 'Maximum 20 images per product' using errcode = '22023';
  end if;
  target_position := coalesce(p_position, media_count);
  if target_position < media_count then
    update public.product_media set position = position + 1
     where product_id = p_product_id and position >= target_position;
  end if;
  insert into public.product_media
    (id, product_id, storage_object_id, storage_path, alt_text, position, created_by)
  values
    (media_id, p_product_id, object_id, p_storage_path, alt_value, target_position, auth.uid());
  -- Gallery changes bump the product version so an open edit form reloads
  -- instead of overwriting with a stale expected_updated_at.
  update public.products set updated_at = clock_timestamp() where id = p_product_id;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.media_added', p_product_id,
          jsonb_build_object('media_id', media_id, 'position', target_position,
                             'storage_path', p_storage_path));
  return media_id;
end $$;
revoke all on function public.admin_add_product_media(uuid, text, uuid, text, integer) from public, anon;
grant execute on function public.admin_add_product_media(uuid, text, uuid, text, integer) to authenticated;

-- Reorder the whole gallery in one transaction (deferrable constraint).
create function public.admin_reorder_product_media(p_product_id uuid, ordered_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare media_count integer;
begin
  perform private.require_admin('catalogue.manage');
  if p_product_id is null or ordered_ids is null then
    raise exception 'Invalid gallery order' using errcode = '22023';
  end if;
  perform 1 from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found' using errcode = '22023'; end if;
  select count(*) into media_count from public.product_media where product_id = p_product_id;
  if coalesce(cardinality(ordered_ids), 0) <> media_count
     or (select count(distinct x) from unnest(ordered_ids) x) <> media_count
     or exists (select 1 from unnest(ordered_ids) x
                 where not exists (select 1 from public.product_media
                                    where id = x and product_id = p_product_id)) then
    raise exception 'Order must contain every gallery image exactly once' using errcode = '22023';
  end if;
  update public.product_media set position = array_position(ordered_ids, id) - 1
   where product_id = p_product_id;
  update public.products set updated_at = clock_timestamp() where id = p_product_id;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.media_reordered', p_product_id,
          jsonb_build_object('ordered_ids', to_jsonb(ordered_ids)));
end $$;
revoke all on function public.admin_reorder_product_media(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_product_media(uuid, uuid[]) to authenticated;

-- Delete the row and renumber the survivors. Returns the storage path so
-- the action layer can remove the bytes AFTERWARDS (see header contract).
create function public.admin_remove_product_media(p_media_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  media_row public.product_media;
  removed_path text;
begin
  perform private.require_admin('catalogue.manage');
  select * into media_row from public.product_media where id = p_media_id for update;
  if not found then raise exception 'Gallery image not found' using errcode = '22023'; end if;
  removed_path := media_row.storage_path;
  delete from public.product_media where id = p_media_id;
  with numbered as (
    select id, row_number() over (order by position) - 1 as n
      from public.product_media where product_id = media_row.product_id
  )
  update public.product_media m set position = numbered.n
    from numbered where m.id = numbered.id;
  update public.products set updated_at = clock_timestamp()
   where id = media_row.product_id;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.media_removed', media_row.product_id,
          jsonb_build_object('media_id', p_media_id, 'storage_path', removed_path));
  return removed_path;
end $$;
revoke all on function public.admin_remove_product_media(uuid) from public, anon;
grant execute on function public.admin_remove_product_media(uuid) to authenticated;

-- Alt text is media metadata: it does not bump the product version.
create function public.admin_update_product_media(p_media_id uuid, p_alt_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare media_row public.product_media;
begin
  perform private.require_admin('catalogue.manage');
  if p_alt_text is null or length(p_alt_text) > 300 then
    raise exception 'Invalid alt text' using errcode = '22023';
  end if;
  select * into media_row from public.product_media where id = p_media_id for update;
  if not found then raise exception 'Gallery image not found' using errcode = '22023'; end if;
  update public.product_media set alt_text = p_alt_text where id = p_media_id;
  insert into public.admin_audit_logs (actor_id, action, target_id, changes)
  values (auth.uid(), 'product.media_alt_updated', media_row.product_id,
          jsonb_build_object('media_id', p_media_id, 'alt_text', p_alt_text));
end $$;
revoke all on function public.admin_update_product_media(uuid, text) from public, anon;
grant execute on function public.admin_update_product_media(uuid, text) to authenticated;

commit;
