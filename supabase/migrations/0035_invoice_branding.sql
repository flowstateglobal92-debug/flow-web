-- ============================================================================
-- 0035 · Invoice branding
-- How documents look: your own logo (or the Flow State mark, or just the
-- name), an accent colour, one of three layouts, and a footer line.
--   logo_data — a small PNG, JPEG or WebP as a data: URL (about 300 KB at
--     most). Kept on the settings row, so it prints, makes PDFs and syncs to
--     the desktop with no storage bucket in between.
--   logo_mode — brand (the Flow State mark, as today) | custom | none.
--   document_layout — classic (today's) | modern (a colour band) | compact.
-- Admins change them, like the rest of the invoice settings.
-- Requires: 0034. Idempotent.
-- ============================================================================

alter table public.invoice_settings add column if not exists logo_mode text not null default 'brand';
alter table public.invoice_settings add column if not exists logo_data text;
alter table public.invoice_settings add column if not exists accent_color text not null default '#C65D3B';
alter table public.invoice_settings add column if not exists document_layout text not null default 'classic';
alter table public.invoice_settings add column if not exists footer_text text;

comment on column public.invoice_settings.logo_data is
  'Custom logo as a data: URL (PNG/JPEG/WebP, ~300 KB max). Used when logo_mode = custom.';

alter table public.invoice_settings drop constraint if exists invoice_settings_branding_check;
alter table public.invoice_settings
  add constraint invoice_settings_branding_check check (
    logo_mode in ('brand', 'custom', 'none')
    and (logo_data is null
         or (logo_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' and char_length(logo_data) <= 420000))
    and (logo_mode <> 'custom' or logo_data is not null)
    and accent_color ~ '^#[0-9A-Fa-f]{6}$'
    and document_layout in ('classic', 'modern', 'compact')
    and (footer_text is null or char_length(footer_text) <= 500)
  );

-- The logo is a long string: the audit line says it changed, not what to.
drop trigger if exists invoice_settings_activity on public.invoice_settings;
create trigger invoice_settings_activity
  after update on public.invoice_settings
  for each row execute function private.log_activity(
    'invoice settings', 'business_name', '{next_invoice_number,next_quote_number,next_credit_note_number,logo_data}'
  );
